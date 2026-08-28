import { NextResponse } from "next/server";
import { adminErrorMessage, checkAdmin, getServiceClient } from "@/lib/supabase/serviceClient";
import { smsGatewayPhone } from "@/lib/phone";
import { sendSms } from "@/lib/sms/gateway";
import { renderContractTemplate } from "@/lib/contracts/renderTemplate";

export const dynamic = "force-dynamic";

const AUDIENCES = ["all", "building", "debtors"] as const;
type Audience = (typeof AUDIENCES)[number];

type Recipient = { client_id: string; name: string; phone: string | null; phone2: string | null };

// "Своя рассылка": an admin's own text, not one of the two fixed
// payment-reminder templates, sent to a chosen audience (see
// crm.sms_broadcast_recipients -- everyone, one building's clients, or
// everyone currently overdue). Same gateway call as the reminder cron and
// the settings test-send button (lib/sms/gateway.ts); the new part here is
// resolving WHO, and one summary line in the audit log so the campaign
// leaves a record even though there's no payment row to stamp a
// reminder_sent_at onto.
export async function POST(request: Request) {
  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const admin = await checkAdmin(supabase, request);
  if (!admin.ok) return NextResponse.json({ error: adminErrorMessage(admin) }, { status: 403 });

  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  if (!settings?.sms_api_key || !settings?.sms_sender_name) {
    return NextResponse.json(
      { error: "Сначала укажите API-ключ и имя отправителя в настройках SMS." },
      { status: 400 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    audience?: string;
    buildingId?: string;
    text?: string;
  };
  const audience = body.audience as Audience;
  if (!AUDIENCES.includes(audience)) {
    return NextResponse.json({ error: "Не указана аудитория рассылки." }, { status: 400 });
  }
  if (audience === "building" && !body.buildingId) {
    return NextResponse.json({ error: "Выберите здание." }, { status: 400 });
  }
  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ error: "Введите текст сообщения." }, { status: 400 });
  }

  const { data: recipientsData, error: recipientsError } = await supabase.rpc(
    "sms_broadcast_recipients",
    { p_audience: audience, p_building_id: audience === "building" ? body.buildingId : null }
  );
  if (recipientsError) {
    return NextResponse.json(
      { error: `Не удалось получить список получателей: ${recipientsError.message}` },
      { status: 500 }
    );
  }
  const recipients = (recipientsData ?? []) as Recipient[];
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Получателей с таким выбором не нашлось." }, { status: 400 });
  }

  let buildingName: string | null = null;
  if (audience === "building" && body.buildingId) {
    const { data: b } = await supabase
      .from("buildings")
      .select("name")
      .eq("id", body.buildingId)
      .maybeSingle();
    buildingName = (b?.name as string | undefined) ?? null;
  }

  const apiKey = settings.sms_api_key as string;
  const senderName = settings.sms_sender_name as string;

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let firstError: string | undefined;

  for (const r of recipients) {
    const phone = smsGatewayPhone(r.phone) || smsGatewayPhone(r.phone2);
    if (!phone) {
      skipped++;
      continue;
    }
    const rendered = renderContractTemplate(text, { client_name: r.name });
    const result = await sendSms(apiKey, senderName, phone, rendered);
    if (result.ok) {
      sent++;
    } else {
      failed++;
      if (!firstError && result.detail) firstError = result.detail;
    }
  }

  const audienceLabel =
    audience === "all" ? "Все клиенты" : audience === "debtors" ? "Должники" : buildingName ?? "Здание";

  // One row for the whole campaign, not one per recipient -- a broadcast is
  // one action, and a hundred+ identical rows would drown the journal for
  // anyone reading it afterwards. fieldLines (audit-log/page.tsx) renders
  // every key here automatically once it has a label in the dictionary.
  await supabase.from("audit_log").insert({
    actor_id: admin.user.id,
    action: "sms_broadcast",
    entity_type: "sms_broadcast",
    entity_id: null,
    details: {
      audience: audienceLabel,
      message: text,
      recipients: recipients.length,
      sent,
      failed,
      skipped,
    },
  });

  const summary =
    `Отправлено: ${sent} из ${recipients.length}` +
    (failed ? `, не доставлено: ${failed}${firstError ? ` (${firstError})` : ""}` : "") +
    (skipped ? `, пропущено (нет номера): ${skipped}` : "");

  return NextResponse.json({ ok: failed === 0, summary, sent, failed, skipped, total: recipients.length });
}
