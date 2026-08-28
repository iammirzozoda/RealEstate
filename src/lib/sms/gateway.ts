// The one place that actually talks to the Payom.tj gateway -- was
// duplicated (sendPaymentReminders.ts had its own copy, /api/sms/test its
// own inline fetch), so a change to the request shape or error handling
// had to be made twice or drifted. Now it's made once and reused by the
// reminder cron, the settings test-send button, and the custom broadcast.

export const SMS_GATEWAY_URL = "https://gateway.payom.tj/api/message";

// Returns why it failed, not just that it did -- a wrong API key, a
// blocked sender name and a bad number all used to collapse into the same
// unhelpful "не доставлено".
export async function sendSms(
  apiKey: string,
  senderName: string,
  phone: string,
  text: string
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(SMS_GATEWAY_URL, {
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
