import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { renderContractTemplate } from "@/lib/contracts/renderTemplate";
import { smsGatewayPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const DEFAULT_TASK_TEMPLATE = '{{assignee}}, напоминаем: задача "{{title}}" — срок {{due_date}}.';

type DueTask = {
  id: string;
  title: string;
  due_date: string;
  assignee: string | null;
  assignee_phone: string | null;
};

export async function GET(request: Request) {
  // Fail closed: if CRON_SECRET isn't configured, reject every request
  // instead of skipping the check -- see send-payment-reminders for why.
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    db: { schema: "crm" },
  });

  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  if (!settings?.sms_enabled) {
    return NextResponse.json({ message: "SMS mailout is stopped, skipping" });
  }
  if (!settings?.sms_api_key || !settings?.sms_sender_name) {
    return NextResponse.json({ message: "SMS not configured, skipping" });
  }

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + (settings.sms_reminder_days ?? 3));
  const targetDateStr = targetDate.toISOString().slice(0, 10);

  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("id, title, due_date, assignee, assignee_phone")
    .neq("status", "done")
    .is("reminder_sent_at", null)
    .not("assignee_phone", "is", null)
    .not("due_date", "is", null)
    .lte("due_date", targetDateStr);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A row this loop decides not to send for is otherwise invisible in
  // Журнал событий: the generic audit trigger only sees a row change, and
  // neither a malformed phone nor a gateway rejection touches the task row
  // at all. Written straight to audit_log (this route runs on the service
  // role, same as the payment-reminder cron -- see its own note on this).
  const logIssue = (task: DueTask, reason: "no_phone" | "gateway_error", detail?: string) =>
    supabase.from("audit_log").insert({
      actor_id: null,
      action: reason === "no_phone" ? "sms_skipped" : "sms_failed",
      entity_type: "task",
      entity_id: task.id,
      details: {
        reason,
        title: task.title,
        assignee: task.assignee ?? undefined,
        ...(detail ? { detail } : {}),
      },
    });

  const dueList = (tasks ?? []) as DueTask[];
  let sent = 0;
  let failed = 0;

  for (const task of dueList) {
    const phone = smsGatewayPhone(task.assignee_phone);
    if (!phone) {
      await logIssue(task, "no_phone");
      continue;
    }

    const text = renderContractTemplate(settings.sms_task_template || DEFAULT_TASK_TEMPLATE, {
      assignee: task.assignee ?? "",
      title: task.title,
      due_date: task.due_date,
    });

    try {
      const res = await fetch("https://gateway.payom.tj/api/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${settings.sms_api_key}`,
        },
        body: JSON.stringify({
          telephone: phone,
          text,
          senderName: settings.sms_sender_name,
          type: "SMS",
        }),
      });
      if (res.ok || [200, 201, 202].includes(res.status)) {
        await supabase
          .from("tasks")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", task.id);
        sent++;
      } else {
        failed++;
        const body = await res.text().catch(() => "");
        await logIssue(task, "gateway_error", `${res.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
      }
    } catch (err) {
      failed++;
      await logIssue(
        task,
        "gateway_error",
        err instanceof Error ? err.message : "сеть недоступна"
      );
    }
  }

  return NextResponse.json({ checked: dueList.length, sent, failed });
}
