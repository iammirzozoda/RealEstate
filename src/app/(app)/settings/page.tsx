"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { SetupNotice } from "@/components/SetupNotice";
import { FileUploadField } from "@/components/FileUploadField";
import { Accordion } from "@/components/Accordion";
import { SmsScheduler } from "@/components/SmsScheduler";
import { CustomSmsModal } from "@/components/CustomSmsModal";
import { Toast, type ToastType } from "@/components/Toast";
import { HERO_THEMES, HERO_PATTERNS } from "@/components/HeroThemeSwitcher";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { useRole } from "@/lib/auth/useRole";
import { ChangePasswordCard } from "@/components/ChangePasswordCard";
import { CalendarIcon, DocumentIcon, TaskIcon, WarningIcon } from "@/components/icons";
import type { SettingsInput } from "@/lib/settings/types";

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]";

const PAYMENT_SMS_PLACEHOLDERS = [
  "client_name",
  "amount",
  "currency",
  "contract_number",
  "due_date",
];

const TASK_SMS_PLACEHOLDERS = ["assignee", "title", "due_date"];

// A small caption above a group of fields, matching the "ТЕМА"/"НАҚШ"
// labels the Appearance card already uses further down this same page --
// one visual language for "here starts a new group" everywhere on Settings.
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 mt-1 text-xs font-medium uppercase tracking-wide text-[var(--ink-5)]">
      {children}
    </p>
  );
}

// The three SMS templates used to be three identical grey boxes told apart
// only by the label text above them -- easy to edit the wrong one at a
// glance. Each now gets its own icon and tone (calendar/sky for the advance
// reminder, warning/amber for the day it's actually due, task/violet for
// staff reminders), so which message this is is visible before reading a
// word of it.
const TEMPLATE_TONES = {
  sky: {
    chip: "bg-[var(--wash-sky)] text-[var(--wash-sky-ink)]",
    ring: "focus:border-[var(--wash-sky-ink)] focus:ring-[var(--wash-sky)]",
  },
  amber: {
    chip: "bg-[var(--wash-amber)] text-[var(--wash-amber-ink)]",
    ring: "focus:border-[var(--wash-amber-ink)] focus:ring-[var(--wash-amber)]",
  },
  violet: {
    chip: "bg-[var(--wash-violet)] text-[var(--wash-violet-ink)]",
    ring: "focus:border-[var(--wash-violet-ink)] focus:ring-[var(--wash-violet)]",
  },
} as const;

function TemplateField({
  icon,
  tone,
  label,
  value,
  onChange,
  placeholders,
  rows = 3,
}: {
  icon: React.ReactNode;
  tone: keyof typeof TEMPLATE_TONES;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholders: string[];
  rows?: number;
}) {
  const c = TEMPLATE_TONES[tone];
  return (
    <div className="rounded-xl border border-[var(--border-c)] p-3">
      <div className="flex items-center gap-2">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${c.chip}`}>
          {icon}
        </span>
        <span className="text-sm font-medium text-[var(--ink-2)]">{label}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className={`mt-2 w-full rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 font-mono text-xs text-[var(--ink-1)] transition-colors focus:outline-none focus:ring-2 ${c.ring}`}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {placeholders.map((p) => (
          <code key={p} className="rounded bg-[var(--track-c)] px-1.5 py-0.5 text-xs text-[var(--ink-3)]">
            {`{{${p}}}`}
          </code>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useLocale();
  const configured = isSupabaseConfigured();
  const { refresh } = useSettings();
  const { role, loading: roleLoading } = useRole();

  const [values, setValues] = useState<SettingsInput>({
    sms_provider: "",
    sms_api_key: "",
    sms_sender_name: "",
    sms_reminder_days: "",
    sms_payment_template: "",
    sms_due_today_template: "",
    sms_task_template: "",
    company_name: "",
    company_director: "",
    company_address: "",
    company_bank_details: "",
    company_logo_url: "",
    hero_theme: "atlas",
    hero_pattern: "none",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  // Buildings for the "documentation PDF" picker.
  const [buildings, setBuildings] = useState<Array<{ id: string; name: string }>>([]);
  const [reportBuilding, setReportBuilding] = useState("");

  useEffect(() => {
    if (role !== "admin" || !configured) return;
    const supabase = createClient();
    supabase
      .schema("crm")
      .from("buildings")
      .select("id, name")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const rows = (data ?? []) as Array<{ id: string; name: string }>;
        setBuildings(rows);
        setReportBuilding((prev) => prev || rows[0]?.id || "");
      });
  }, [role, configured]);

  // Loaded separately from the app-wide SettingsProvider, which deliberately
  // never fetches sms_api_key (it's mounted for every signed-in user
  // regardless of role) -- this page is the one place that needs the full
  // row, and it's only reachable by admins in the first place.
  useEffect(() => {
    if (role !== "admin" || !configured) return;
    const supabase = createClient();
    supabase
      .schema("crm")
      .from("settings")
      .select("*")
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        setValues({
          sms_provider: data.sms_provider ?? "Payom.tj",
          sms_api_key: data.sms_api_key ?? "",
          sms_sender_name: data.sms_sender_name ?? "",
          sms_reminder_days: data.sms_reminder_days.toString(),
          sms_payment_template: data.sms_payment_template ?? "",
          sms_due_today_template: data.sms_due_today_template ?? "",
          sms_task_template: data.sms_task_template ?? "",
          company_name: data.company_name ?? "",
          company_director: data.company_director ?? "",
          company_address: data.company_address ?? "",
          company_bank_details: data.company_bank_details ?? "",
          company_logo_url: data.company_logo_url ?? "",
          hero_theme: data.hero_theme ?? "atlas",
          hero_pattern: data.hero_pattern ?? "none",
        });
      });
  }, [role, configured]);

  const update = <K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };

  // Shared by the Save button and the SMS test-send button -- the test has
  // to hit the row that's actually stored (the API route reads it fresh via
  // the service client), so it saves first rather than testing whatever's
  // still sitting unsaved in the form.
  const saveSettings = async (): Promise<boolean> => {
    const supabase = createClient();
    const { error, data } = await supabase
      .schema("crm")
      .from("settings")
      .update({
        sms_provider: values.sms_provider || "Payom.tj",
        sms_api_key: values.sms_api_key || null,
        sms_sender_name: values.sms_sender_name || null,
        sms_reminder_days: values.sms_reminder_days ? Number(values.sms_reminder_days) : 3,
        sms_payment_template: values.sms_payment_template || null,
        sms_due_today_template: values.sms_due_today_template || null,
        sms_task_template: values.sms_task_template || null,
        company_name: values.company_name || null,
        company_director: values.company_director || null,
        company_address: values.company_address || null,
        company_bank_details: values.company_bank_details || null,
        company_logo_url: values.company_logo_url || null,
        hero_theme: values.hero_theme || null,
        hero_pattern: values.hero_pattern || null,
      })
      .eq("id", true)
      .select("id");
    if (error) {
      setToast({ message: error.message, type: "error" });
      return false;
    }
    if (!data || data.length === 0) {
      setToast({ message: t.settings.saveBlocked, type: "error" });
      return false;
    }
    await refresh();
    return true;
  };

  const handleSave = async () => {
    setSaving(true);
    const ok = await saveSettings();
    setSaving(false);
    if (ok) setToast({ message: t.settings.saved, type: "success" });
  };

  const handleTestSend = async () => {
    if (!testPhone.trim()) {
      setToast({ message: t.settings.sms.testNoPhone, type: "error" });
      return;
    }
    setTestSending(true);
    const ok = await saveSettings();
    if (!ok) {
      setTestSending(false);
      return;
    }
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    try {
      const res = await fetch("/api/sms/test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ phone: testPhone }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setToast({ message: json.error || t.common.error, type: "error" });
      } else {
        setToast({ message: t.settings.sms.testSuccess, type: "success" });
      }
    } catch {
      setToast({ message: t.common.error, type: "error" });
    }
    setTestSending(false);
  };

  if (roleLoading) return <p className="text-[var(--ink-5)]">{t.common.loading}</p>;
  if (role !== "admin") {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{t.settings.title}</h1>
        <p className="text-[var(--ink-4)]">{t.users.accessDenied}</p>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t.settings.title}</h1>

      {role === "admin" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Link
            href="/settings/users"
            className="group flex items-center gap-3 rounded-2xl border border-[var(--border-c)] bg-[var(--surface-1)] p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5"/><circle cx="17.5" cy="9.5" r="2.5"/><path d="M16 15.2c2.6.3 4.6 1.8 5.5 4.3"/></svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-[var(--ink-2)]">{t.settings.usersLink}</span>
              <span className="block text-xs text-[var(--ink-5)]">{t.settings.usersHint}</span>
            </span>
            <span className="text-[var(--ink-5)] transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
          <Link
            href="/settings/audit-log"
            className="group flex items-center gap-3 rounded-2xl border border-[var(--border-c)] bg-[var(--surface-1)] p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--wash-amber)] text-[var(--wash-amber-ink)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M4 5h16M4 12h16M4 19h10"/><circle cx="19" cy="19" r="2"/></svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-[var(--ink-2)]">{t.settings.auditLogLink}</span>
              <span className="block text-xs text-[var(--ink-5)]">{t.settings.auditHint}</span>
            </span>
            <span className="text-[var(--ink-5)] transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
        </div>
      )}

      {!configured && <SetupNotice />}

      {configured && <ChangePasswordCard />}

      <div className="flex flex-col gap-3">
        <Accordion
          title={t.settings.company.title}
          defaultOpen
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" />
              <path d="M14 9h5a1 1 0 0 1 1 1v11" />
              <path d="M2 21h20" />
              <path d="M7 8h2M7 12h2M7 16h2M17 13h1M17 17h1" />
            </svg>
          }
        >
          <span className="-mt-2 text-xs text-[var(--ink-5)]">{t.settings.company.hint}</span>
          <FileUploadField
            label={t.settings.company.logo}
            value={values.company_logo_url}
            onChange={(url) => update("company_logo_url", url)}
            folder="company-logo"
            uploadLabel={t.objects.form.upload}
            uploadingLabel={t.objects.form.uploading}
          />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.settings.company.name}</span>
            <input
              value={values.company_name}
              onChange={(e) => update("company_name", e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.settings.company.director}</span>
            <input
              value={values.company_director}
              onChange={(e) => update("company_director", e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.settings.company.address}</span>
            <input
              value={values.company_address}
              onChange={(e) => update("company_address", e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">
              {t.settings.company.bankDetails}
            </span>
            <textarea
              value={values.company_bank_details}
              onChange={(e) => update("company_bank_details", e.target.value)}
              placeholder={t.settings.company.bankDetailsPlaceholder}
              rows={3}
              className="rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
        </Accordion>

        <Accordion
          title={t.settings.sms.title}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m4 6.5 8 6 8-6" />
            </svg>
          }
        >
          <span className="-mt-2 text-xs text-[var(--ink-5)]">{t.settings.sms.hint}</span>

          <SectionLabel>{t.settings.sms.connectionSection}</SectionLabel>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[var(--ink-2)]">{t.settings.sms.provider}</span>
              <input
                value={values.sms_provider}
                onChange={(e) => update("sms_provider", e.target.value)}
                placeholder="Payom.tj"
                className={FIELD_CLASS}
              />
              {/* Честно, а не мелким шрифтом: переименование не переключает
                  шлюз. Запрос всегда уходит на gateway.payom.tj в его формате
                  (sendPaymentReminders.ts) -- это поле только для памяти
                  администратора, если ключ выдал именно этот провайдер. */}
              <span className="text-xs text-[var(--ink-5)]">{t.settings.sms.providerHint}</span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[var(--ink-2)]">{t.settings.sms.apiKey}</span>
              <input
                type="password"
                value={values.sms_api_key}
                onChange={(e) => update("sms_api_key", e.target.value)}
                className={`${FIELD_CLASS} font-mono`}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[var(--ink-2)]">{t.settings.sms.senderName}</span>
              <input
                value={values.sms_sender_name}
                onChange={(e) => update("sms_sender_name", e.target.value)}
                placeholder={t.settings.sms.senderNamePlaceholder}
                className={FIELD_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[var(--ink-2)]">{t.settings.sms.reminderDays}</span>
              <input
                type="number"
                min="0"
                value={values.sms_reminder_days}
                onChange={(e) => update("sms_reminder_days", e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
          </div>

          <SectionLabel>{t.settings.sms.templatesSection}</SectionLabel>
          <div className="flex flex-col gap-3">
            <TemplateField
              icon={<CalendarIcon className="h-4 w-4" />}
              tone="sky"
              label={t.settings.sms.paymentTemplateShort}
              value={values.sms_payment_template}
              onChange={(v) => update("sms_payment_template", v)}
              placeholders={PAYMENT_SMS_PLACEHOLDERS}
            />
            {/* A separate message for the due date itself -- the rassylka
                used to reuse the template above verbatim for both stages, so
                the day-of SMS read "оплата ... до {{сегодняшняя дата}}"
                instead of actually saying "сегодня". Amber, not sky: this
                one goes out ON the due date, the more pressing of the two. */}
            <TemplateField
              icon={<WarningIcon className="h-4 w-4" />}
              tone="amber"
              label={t.settings.sms.dueTodayTemplateShort}
              value={values.sms_due_today_template}
              onChange={(v) => update("sms_due_today_template", v)}
              placeholders={PAYMENT_SMS_PLACEHOLDERS}
            />
            <TemplateField
              icon={<TaskIcon className="h-4 w-4" />}
              tone="violet"
              label={t.settings.sms.taskTemplateShort}
              value={values.sms_task_template}
              onChange={(v) => update("sms_task_template", v)}
              placeholders={TASK_SMS_PLACEHOLDERS}
              rows={2}
            />
          </div>

          {/* One compact row, not a fourth full TemplateField -- the whole
              point is that this is free text, chosen fresh each time, not
              something worth a permanent textarea taking up room in a
              section people mostly leave collapsed. Everything else
              (audience, recipients, the text itself) lives in the modal it
              opens, so the section here never grows past this one line. */}
          <div className="flex items-center gap-3 border-t border-[var(--border-c2)] pt-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--wash-sky)] text-[var(--wash-sky-ink)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                <path d="M4 5.5h16M4 12h16M4 18.5h9" strokeLinecap="round" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--ink-2)]">{t.settings.sms.broadcastRow}</p>
              <p className="truncate text-xs text-[var(--ink-5)]">{t.settings.sms.broadcastRowHint}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowBroadcast(true)}
              className="h-9 shrink-0 rounded-lg border border-[var(--border-strong-c)] px-3.5 text-sm font-medium text-[var(--ink-2)] transition-all hover:bg-[var(--hover-c)] active:scale-[0.98]"
            >
              {t.settings.sms.broadcastOpen}
            </button>
          </div>

          {/* Compact inline test-send: one row, phone + button, no separate
              card -- saves the form first so the API key/sender it tests is
              exactly what's on screen, then fires one real SMS through the
              gateway so a broken key/sender surfaces immediately instead of
              days later when the reminder cron happens to run. */}
          <div className="flex items-end gap-2 border-t border-[var(--border-c2)] pt-3">
            <label className="flex flex-1 flex-col gap-1 text-sm">
              <span className="font-medium text-[var(--ink-2)]">{t.settings.sms.testTitle}</span>
              <input
                type="tel"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder={t.settings.sms.testPhonePlaceholder}
                className={`${FIELD_CLASS} h-9`}
              />
            </label>
            <button
              type="button"
              onClick={handleTestSend}
              disabled={testSending}
              className="h-9 shrink-0 rounded-lg bg-brand px-3.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
            >
              {testSending ? t.settings.sms.testSending : t.settings.sms.testSend}
            </button>
          </div>

          {/* Start/Stop for the automatic run, plus why it can or can't go
              out. Kept below the test-send: you prove one message works,
              then switch the schedule on. */}
          <SmsScheduler
            onMessage={(text, ok) => setToast({ message: text, type: ok ? "success" : "error" })}
          />
        </Accordion>
      </div>

      {/* Company-wide dashboard look. Applies to everyone who hasn't set a
          personal override from the dashboard swatches. */}
      <div className="rounded-2xl border border-[var(--border-c)] bg-[var(--surface-1)] p-5 shadow-sm">
        <p className="text-sm font-semibold text-[var(--ink-2)]">{t.settings.appearance.title}</p>
        <p className="mt-0.5 text-xs text-[var(--ink-5)]">{t.settings.appearance.hint}</p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-5)]">
              {t.settings.appearance.theme}
            </p>
            <div className="flex flex-wrap gap-2.5">
              {HERO_THEMES.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => update("hero_theme", th.id)}
                  title={th.label}
                  className={`flex items-center gap-2 rounded-full border px-2 py-1 pr-3 text-xs font-medium transition-all ${
                    values.hero_theme === th.id
                      ? "border-[var(--ink-1)] text-[var(--ink-1)]"
                      : "border-[var(--border-c)] text-[var(--ink-4)] hover:border-[var(--border-strong-c)]"
                  }`}
                >
                  <span
                    className="h-5 w-5 rounded-full"
                    style={{
                      // Лимӯ is flat now, not a blend -- a real gradient
                      // swatch here would misrepresent it. Hard colour
                      // stops (no space between them) give two solid
                      // bands instead: a thin lemon rule over graphite,
                      // the same shape the real surfaces use.
                      background:
                        th.id === "lemon"
                          ? `linear-gradient(180deg, ${th.swatch[2]} 0%, ${th.swatch[2]} 15%, ${th.swatch[0]} 15%, ${th.swatch[0]} 100%)`
                          : `linear-gradient(120deg, ${th.swatch[0]}, ${th.swatch[1]} 55%, ${th.swatch[2]})`,
                    }}
                  />
                  {th.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-5)]">
              {t.settings.appearance.pattern}
            </p>
            <div className="flex flex-wrap gap-2.5">
              {HERO_PATTERNS.map((pt) => (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => update("hero_pattern", pt.id)}
                  title={pt.label}
                  className={`flex items-center gap-2 rounded-full border px-2 py-1 pr-3 text-xs font-medium transition-all ${
                    values.hero_pattern === pt.id
                      ? "border-[var(--ink-1)] text-[var(--ink-1)]"
                      : "border-[var(--border-c)] text-[var(--ink-4)] hover:border-[var(--border-strong-c)]"
                  }`}
                >
                  <span
                    className="h-5 w-5 rounded-md border border-[var(--border-c)] bg-[var(--ink-4)]"
                    style={pt.css ? { backgroundImage: pt.css } : undefined}
                  />
                  {pt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Documentation PDF: pick a ЖК and open its full report (shakhmatka +
          sales + clients), printable / savable as PDF. */}
      <div className="rounded-2xl border border-[var(--border-c)] bg-[var(--surface-1)] p-5 shadow-sm">
        <p className="text-sm font-semibold text-[var(--ink-2)]">{t.settings.backup.title}</p>
        <p className="mt-0.5 text-xs text-[var(--ink-5)]">{t.settings.backup.hint}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={reportBuilding}
            onChange={(e) => setReportBuilding(e.target.value)}
            className={FIELD_CLASS + " max-w-xs flex-1"}
          >
            {buildings.length === 0 && <option value="">—</option>}
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <Link
            href={reportBuilding ? `/buildings/${reportBuilding}/report` : "#"}
            aria-disabled={!reportBuilding}
            className={`btn-brand inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98] ${
              reportBuilding ? "" : "pointer-events-none opacity-40"
            }`}
          >
<DocumentIcon className="h-4 w-4" /> {t.settings.backup.open}
          </Link>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="w-fit rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
      >
        {saving ? t.common.loading : t.settings.save}
      </button>

      <Toast
        message={toast?.message ?? null}
        type={toast?.type ?? "success"}
        onDismiss={() => setToast(null)}
      />

      {showBroadcast && (
        <CustomSmsModal
          onClose={() => setShowBroadcast(false)}
          onResult={(message, ok) => setToast({ message, type: ok ? "success" : "error" })}
        />
      )}
    </div>
  );
}
