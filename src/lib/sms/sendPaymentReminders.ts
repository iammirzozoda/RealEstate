import type { ServiceClient } from "@/lib/supabase/serviceClient";
import { renderContractTemplate } from "@/lib/contracts/renderTemplate";
import { smsGatewayPhone } from "@/lib/phone";

// The reminder run, in one place, so the nightly cron and the "Отправить
// сейчас" button in Settings do exactly the same thing -- an admin can prove
// the whole chain works right now instead of waiting until 05:00 to find out.

const DEFAULT_PAYMENT_TEMPLATE =
  "{{client_name}}, напоминаем: оплата {{amount}} {{currency}} по договору №{{contract_number}} до {{due_date}}.";

// The day-of message used to reuse the advance template verbatim -- the
// only thing that differed was {{due_date}} resolving to today's own date,
// so "напоминаем: оплата ... до 21.08.2026" is what went out ON 21.08.2026,
// technically correct but never actually saying "today". Its own template
// (migration 058), so an admin can word it as "сегодня срок оплаты..."
// instead of a repeated date the client can already see on their phone.
const DEFAULT_DUE_TODAY_TEMPLATE =
  "{{client_name}}, напоминаем: сегодня срок оплаты {{amount}} {{currency}} по договору №{{contract_number}}.";

const GATEWAY_URL = "https://gateway.payom.tj/api/message";

type DuePayment = {
  id: string;
  due_date: string;
  amount: number;
  contract: {
    number: string | null;
    currency: string;
    status: string;
    client: { name: string; phone: string | null; phone2: string | null } | null;
  } | null;
};

export type ReminderRun = {
  ok: boolean;
  /** Human-readable one-liner, stored on settings.sms_last_result. */
  summary: string;
  advanceSent: number;
  dueSent: number;
  failed: number;
  skipped: number;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Returns why it failed, not just that it did. The run used to report
// "не доставлено: 3" and throw the gateway's answer away, which left nobody
// any way to tell a wrong API key from a blocked sender name from a bad
// number.
async function sendOne(
  apiKey: string,
  senderName: string,
  phone: string,
  text: string
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ telephone: phone, text, senderName, type: "SMS" }),
    });
    if (res.ok || [200, 201, 202].includes(res.status)) return { ok: true };
    const body = await res.text().catch(() => "");
    return { ok: false, detail: `${res.status}${body ? `: ${body.slice(0, 160)}` : ""}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "сеть недоступна" };
  }
}

/**
 * Two reminders per installment:
 *   - "advance": N days before the due date (settings.sms_reminder_days),
 *   - "due":     on the due date itself.
 *
 * Each has its own sent-marker column, so neither can fire twice and turning
 * the feature on does not re-send anything already sent.
 *
 * Deliberately NEVER looks at due_date in the past. The previous version
 * selected everything up to today+N, which included every overdue installment
 * ever recorded -- switching the feature on would have dumped hundreds of
 * messages onto clients in one go. Missing a run is recoverable; a mass-send
 * to real phone numbers is not.
 */
export async function sendPaymentReminders(
  // Must be a service-role client bound to the crm schema.
  supabase: ServiceClient
): Promise<ReminderRun> {
  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();

  if (!settings?.sms_enabled) {
    return { ok: true, summary: "Рассылка выключена", advanceSent: 0, dueSent: 0, failed: 0, skipped: 0 };
  }
  if (!settings.sms_api_key || !settings.sms_sender_name) {
    return {
      ok: false,
      summary: "Не заданы API-ключ или имя отправителя",
      advanceSent: 0,
      dueSent: 0,
      failed: 0,
      skipped: 0,
    };
  }

  const apiKey = settings.sms_api_key as string;
  const senderName = settings.sms_sender_name as string;
  const template = (settings.sms_payment_template as string) || DEFAULT_PAYMENT_TEMPLATE;
  const dueTodayTemplate =
    (settings.sms_due_today_template as string) || DEFAULT_DUE_TODAY_TEMPLATE;
  const days = (settings.sms_reminder_days as number) ?? 3;
  const todayStr = today();

  const select =
    "id, due_date, amount, contract:contracts(number, currency, status, client:clients(name, phone, phone2))";

  // Advance reminder: strictly AFTER today, up to N days out. Strictly after,
  // so a payment due today gets the day-of message below and not both at once.
  const advanceQuery = supabase
    .from("contract_payments")
    .select(select)
    .eq("paid", false)
    .is("reminder_sent_at", null)
    .gt("due_date", todayStr)
    .lte("due_date", plusDays(days));

  // Day-of reminder: due exactly today.
  const dueQuery = supabase
    .from("contract_payments")
    .select(select)
    .eq("paid", false)
    .is("due_reminder_sent_at", null)
    .eq("due_date", todayStr);

  const [advanceRes, dueRes] = await Promise.all([advanceQuery, dueQuery]);
  if (advanceRes.error || dueRes.error) {
    return {
      ok: false,
      summary: `Ошибка чтения графика: ${(advanceRes.error ?? dueRes.error)!.message}`,
      advanceSent: 0,
      dueSent: 0,
      failed: 0,
      skipped: 0,
    };
  }

  let advanceSent = 0;
  let dueSent = 0;
  let failed = 0;
  let skipped = 0;
  // First gateway refusal, kept verbatim for the summary.
  let firstError: string | undefined;

  const stages: Array<{
    rows: DuePayment[];
    marker: "reminder_sent_at" | "due_reminder_sent_at";
    template: string;
  }> = [
    {
      rows: (advanceRes.data ?? []) as unknown as DuePayment[],
      marker: "reminder_sent_at",
      template,
    },
    {
      rows: (dueRes.data ?? []) as unknown as DuePayment[],
      marker: "due_reminder_sent_at",
      // Own wording, not the advance template with today's own date
      // substituted into {{due_date}} -- see DEFAULT_DUE_TODAY_TEMPLATE.
      template: dueTodayTemplate,
    },
  ];

  for (const stage of stages) {
    for (const payment of stage.rows) {
      // A cancelled contract's leftover schedule is not a debt, and its client
      // must not be chased for it.
      if (!payment.contract || payment.contract.status === "cancelled") {
        skipped++;
        continue;
      }
      // Fall back to the second number: a client whose main line is blank
      // (or was only ever recorded as the spare) should still be reminded.
      const phone =
        smsGatewayPhone(payment.contract.client?.phone) ||
        smsGatewayPhone(payment.contract.client?.phone2);
      if (!phone) {
        skipped++;
        await logReminderIssue(supabase, payment.id, "no_phone", {
          client_name: payment.contract.client?.name,
          contract_number: payment.contract.number,
          currency: payment.contract.currency,
        });
        continue;
      }

      const text = renderContractTemplate(stage.template, {
        client_name: payment.contract.client?.name ?? "",
        amount: new Intl.NumberFormat("ru-RU").format(payment.amount),
        currency: payment.contract.currency ?? "TJS",
        contract_number: payment.contract.number ?? "",
        due_date: payment.due_date,
      });

      const sent = await sendOne(apiKey, senderName, phone, text);
      if (!sent.ok) {
        failed++;
        if (!firstError && sent.detail) firstError = sent.detail;
        await logReminderIssue(
          supabase,
          payment.id,
          "gateway_error",
          {
            client_name: payment.contract.client?.name,
            contract_number: payment.contract.number,
            currency: payment.contract.currency,
          },
          sent.detail
        );
        continue;
      }
      await supabase
        .from("contract_payments")
        .update({ [stage.marker]: new Date().toISOString() })
        .eq("id", payment.id);
      if (stage.marker === "reminder_sent_at") advanceSent++;
      else dueSent++;
    }
  }

  const summary =
    `Отправлено: ${advanceSent} за ${days} дн. + ${dueSent} в день платежа` +
    (failed ? `, не доставлено: ${failed}${firstError ? ` (${firstError})` : ""}` : "") +
    (skipped ? `, пропущено: ${skipped}` : "");

  return { ok: failed === 0, summary, advanceSent, dueSent, failed, skipped };
}

// A row the reminder loop below decided NOT to send is otherwise invisible
// in the journal: the generic audit trigger only ever sees a row change,
// and neither a missing phone nor a gateway rejection touches the payment
// row at all -- skipped++/failed++ counted it for the run summary, but an
// admin looking at Журнал событий for "why didn't Х get reminded" found
// nothing. Written straight to audit_log (the cron runs on the service
// role, which bypasses RLS same as every other write here) with the same
// entity_type the real payment updates use, so it sorts into the journal
// next to them instead of needing a separate place to look.
async function logReminderIssue(
  supabase: ServiceClient,
  paymentId: string,
  reason: "no_phone" | "gateway_error",
  context: { client_name?: string; contract_number?: string | null; currency?: string },
  detail?: string
) {
  await supabase.from("audit_log").insert({
    actor_id: null,
    action: reason === "no_phone" ? "sms_skipped" : "sms_failed",
    entity_type: "contract_payment",
    entity_id: paymentId,
    details: {
      _context: {
        client_name: context.client_name,
        contract_number: context.contract_number ?? undefined,
        currency: context.currency,
      },
      reason,
      ...(detail ? { detail } : {}),
    },
  });
}

/** Stamps the run onto settings so the UI can show that it is alive. */
export async function recordRun(supabase: ServiceClient, run: ReminderRun) {
  await supabase
    .from("settings")
    .update({ sms_last_run_at: new Date().toISOString(), sms_last_result: run.summary })
    .eq("id", true);
}
