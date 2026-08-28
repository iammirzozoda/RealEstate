"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import { Accordion } from "@/components/Accordion";
import { CloseIcon } from "@/components/icons";

type Audience = "all" | "building" | "debtors";
type Recipient = { client_id: string; name: string; phone: string | null; phone2: string | null };

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]";

// GSM/Cyrillic SMS math: a Cyrillic message is sent UCS-2 (Latin GSM-7
// doesn't cover it), where a single segment holds 70 characters, and a
// message that needs MORE than one segment drops to 67 per segment (a UDH
// concatenation header eats the rest). Written out here rather than left
// implicit -- the number an admin sees ("2 SMS" instead of "1") is the
// one thing that stops a long, well-meaning message from silently costing
// three times what they expected.
function smsSegments(len: number): number {
  if (len === 0) return 0;
  if (len <= 70) return 1;
  return Math.ceil(len / 67);
}

// "Своя рассылка" -- a custom SMS to a chosen audience, not one of the
// two fixed payment-reminder templates. Lives behind one compact row in
// Settings → SMS (see settings/page.tsx) so the section itself doesn't
// grow; everything -- audience, recipients, text, sending -- happens here.
export function CustomSmsModal({
  onClose,
  onResult,
}: {
  onClose: () => void;
  onResult: (message: string, ok: boolean) => void;
}) {
  const { t } = useLocale();
  const confirm = useConfirm();

  const [audience, setAudience] = useState<Audience>("all");
  const [buildings, setBuildings] = useState<Array<{ id: string; name: string }>>([]);
  const [buildingId, setBuildingId] = useState<string>("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    createClient()
      .schema("crm")
      .from("buildings")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        const rows = (data ?? []) as Array<{ id: string; name: string }>;
        setBuildings(rows);
        // A building must be selected for that audience to mean anything --
        // default to the first one so switching to "По зданию" never shows
        // "0 получателей" from an empty selection nobody made yet.
        if (rows.length > 0) setBuildingId((v) => v || rows[0].id);
      });
  }, []);

  // Re-fetched on every audience/building change rather than filtered
  // client-side from one big list: crm.sms_broadcast_recipients already
  // knows what "a live contract" and "overdue" mean (same definitions
  // overdue_contracts()/dashboard_summary() use), so the three audiences
  // can't quietly drift out of sync with those.
  useEffect(() => {
    if (audience === "building" && !buildingId) {
      setRecipients([]);
      setLoadingRecipients(false);
      return;
    }
    let cancelled = false;
    setLoadingRecipients(true);
    createClient()
      .schema("crm")
      .rpc("sms_broadcast_recipients", {
        p_audience: audience,
        p_building_id: audience === "building" ? buildingId : null,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("sms_broadcast_recipients failed:", error.message);
        setRecipients((data ?? []) as Recipient[]);
        setLoadingRecipients(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audience, buildingId]);

  const segments = useMemo(() => smsSegments(text.trim().length), [text]);

  const insertClientName = () => {
    setText((v) => `${v}{{client_name}}`);
  };

  const handleSend = async () => {
    if (!text.trim() || recipients.length === 0) return;
    const ok = await confirm(
      t.settings.sms.broadcast.confirm.replace("{n}", String(recipients.length)),
      { confirmLabel: t.settings.sms.broadcast.send.replace("{n}", String(recipients.length)) }
    );
    if (!ok) return;
    setSending(true);
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    try {
      const res = await fetch("/api/sms/broadcast", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ audience, buildingId: audience === "building" ? buildingId : undefined, text }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; summary?: string };
      if (!res.ok || json.error) {
        onResult(json.error || t.common.error, false);
      } else {
        onResult(json.summary || t.settings.sms.broadcast.sent, json.ok !== false);
        onClose();
      }
    } catch {
      onResult(t.common.error, false);
    }
    setSending(false);
  };

  return (
    <div
      className="animate-modal-backdrop fixed inset-0 z-[100] flex items-center justify-center bg-[var(--modal-scrim)] p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-[var(--surface-1)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-c)] px-5 py-4">
          <h3 className="text-base font-semibold text-[var(--ink-1)]">{t.settings.sms.broadcast.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-4)] transition-colors hover:bg-[var(--hover-c2)]"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-[var(--ink-3)]">
              {t.settings.sms.broadcast.audienceLabel}
            </span>
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--border-strong-c)] bg-[var(--surface-1)] p-0.5">
              {(
                [
                  ["all", t.settings.sms.broadcast.audienceAll],
                  ["building", t.settings.sms.broadcast.audienceBuilding],
                  ["debtors", t.settings.sms.broadcast.audienceDebtors],
                ] as Array<[Audience, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setAudience(key)}
                  className={`h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-all active:scale-[0.97] ${
                    audience === key
                      ? "bg-brand font-semibold text-[var(--on-brand)] shadow-sm"
                      : "text-[var(--ink-3)] hover:bg-[var(--hover-c2)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {audience === "building" && (
              <select
                value={buildingId}
                onChange={(e) => setBuildingId(e.target.value)}
                className={`${FIELD_CLASS} mt-2`}
              >
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}

            <div className="mt-2 flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-3)]">
              <span>
                {t.settings.sms.broadcast.recipients}:{" "}
                <b className="text-[var(--ink-1)]">
                  {loadingRecipients ? "…" : recipients.length}
                </b>
              </span>
            </div>

            {/* Собственно "выпадающий/аккордеон вместо длинного списка": имена
                скрыты по умолчанию за тем же Accordion, что и весь блок SMS
                настроек, и даже открытые ограничены по высоте своей
                прокруткой -- у здания на 300 квартир список не растягивает
                модалку до бесконечности. */}
            {!loadingRecipients && recipients.length > 0 && (
              <div className="mt-2">
                <Accordion title={t.settings.sms.broadcast.showList.replace("{n}", String(recipients.length))}>
                  <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-xs text-[var(--ink-3)]">
                    {recipients.map((r) => (
                      <li key={r.client_id} className="flex items-center justify-between gap-2 py-0.5">
                        <span className="truncate text-[var(--ink-2)]">{r.name}</span>
                        {!r.phone && !r.phone2 && (
                          <span className="shrink-0 text-[var(--wash-amber-ink)]">
                            {t.settings.sms.broadcast.noPhone}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </Accordion>
              </div>
            )}
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-semibold text-[var(--ink-3)]">
              {t.settings.sms.broadcast.textLabel}
            </span>
            <div className="overflow-hidden rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] transition-colors focus-within:border-[var(--field-focus-border)] focus-within:ring-2 focus-within:ring-[var(--field-focus-ring)]">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder={t.settings.sms.broadcast.textPlaceholder}
                className="w-full resize-y border-0 bg-transparent px-3 py-2.5 text-sm text-[var(--ink-1)] outline-none"
              />
              <div className="flex items-center justify-between border-t border-[var(--border-c2)] bg-[var(--surface-2)] px-3 py-1.5">
                <button
                  type="button"
                  onClick={insertClientName}
                  className="rounded-full bg-[var(--wash-emerald)] px-2 py-0.5 font-mono text-[11px] text-[var(--wash-emerald-ink)] transition-transform active:scale-95"
                >
                  {"{{client_name}}"}
                </button>
                <span
                  className={`font-mono text-[11px] tabular-nums ${
                    segments > 1 ? "font-semibold text-[var(--wash-amber-ink)]" : "text-[var(--ink-5)]"
                  }`}
                >
                  {text.trim().length} · {segments || 0} SMS
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[var(--border-c)] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-[var(--border-strong-c)] px-3.5 text-sm font-medium text-[var(--ink-2)] transition-all hover:bg-[var(--hover-c)] active:scale-[0.98]"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !text.trim() || recipients.length === 0}
            className="h-9 rounded-lg bg-brand px-3.5 text-sm font-semibold text-[var(--on-brand)] shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {sending
              ? t.settings.sms.broadcast.sending
              : t.settings.sms.broadcast.send.replace("{n}", String(recipients.length))}
          </button>
        </div>
      </div>
    </div>
  );
}
