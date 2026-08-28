import { NextResponse } from "next/server";
import { adminErrorMessage, checkAdmin, getServiceClient } from "@/lib/supabase/serviceClient";
import { smsGatewayPhone } from "@/lib/phone";
import { sendSms } from "@/lib/sms/gateway";

export const dynamic = "force-dynamic";

// Lets an admin fire one real SMS through the configured Payom.tj gateway
// straight from the settings page, instead of saving the API key/sender/
// templates and only finding out days later (when the payment-reminder
// cron happens to run) whether any of it actually works.
export async function POST(request: Request) {
  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }
  // Says WHICH of the four things failed. "Unauthorized" alone covered an
  // expired session, a service key from the wrong Supabase project, a missing
  // profile row and a non-admin role -- four problems fixed four different
  // ways, and no way to tell them apart from the screen.
  const admin = await checkAdmin(supabase, request);
  if (!admin.ok) return NextResponse.json({ error: adminErrorMessage(admin) }, { status: 403 });

  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  if (!settings?.sms_api_key || !settings?.sms_sender_name) {
    return NextResponse.json(
      { error: "Сначала укажите API-ключ и имя отправителя, затем сохраните." },
      { status: 400 }
    );
  }

  const { phone: rawPhone } = (await request.json().catch(() => ({}))) as { phone?: string };
  const phone = smsGatewayPhone(rawPhone);
  if (!phone) {
    return NextResponse.json({ error: "Укажите номер телефона." }, { status: 400 });
  }

  // Goes to a real phone, so it names the company that is sending it --
  // "ZAKI CRM" was a leftover product name that means nothing to whoever
  // receives the message.
  const text = `Тест: настройки SMS работают. ${settings.company_name ?? settings.sms_sender_name}`;
  const sent = await sendSms(settings.sms_api_key, settings.sms_sender_name, phone, text);
  if (sent.ok) return NextResponse.json({ ok: true });
  return NextResponse.json(
    { error: `Шлюз ответил ошибкой${sent.detail ? `: ${sent.detail}` : ""}` },
    { status: 502 }
  );
}
