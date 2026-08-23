"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { createClient } from "@/lib/supabase/client";
import { DATE_BOUNDS, isDateInRange } from "@/lib/dates";
import { PassportScanner } from "@/components/PassportScanner";
import type { ClientInput } from "@/lib/clients/types";
import type { PropertyObject } from "@/lib/objects/types";

const FIELD_CLASS =
  "h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]";
const TEXTAREA_CLASS =
  "rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]";

const emptyInput: ClientInput = {
  name: "",
  phone: "",
  phone2: "",
  email: "",
  passport: "",
  passport_issued_by: "",
  birth_date: "",
  address: "",
  source: "",
  interested_object_id: "",
  notes: "",
};

export function ClientForm({
  initial,
  submitting,
  onSubmit,
  onDelete,
}: {
  initial?: Partial<ClientInput>;
  submitting: boolean;
  onSubmit: (values: ClientInput) => void;
  onDelete?: () => void;
}) {
  const { t } = useLocale();
  const [values, setValues] = useState<ClientInput>({ ...emptyInput, ...initial });
  const [objects, setObjects] = useState<PropertyObject[]>([]);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("crm")
      .from("objects")
      .select("*")
      .order("name")
      .then(({ data }) => setObjects((data ?? []) as PropertyObject[]));
  }, []);

  const update = <K extends keyof ClientInput>(key: K, value: ClientInput[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // Checked here as well as through min/max: the attributes only guide the
  // picker, and a value can still be typed or pasted straight past them.
  const birthBounds = DATE_BOUNDS.birth();
  const birthInvalid = !isDateInRange(values.birth_date, birthBounds.min, birthBounds.max);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // An implausible date is unrecoverable once stored -- it sorts and
        // filters wrongly from then on. Refuse it instead of cleaning up later.
        if (birthInvalid) return;
        onSubmit(values);
      }}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface-1)] p-5 shadow-sm"
    >
      <PassportScanner
        onExtract={(fields) => {
          // Only the fields the scan actually found -- never blanks out
          // something already typed just because that one field didn't
          // recognise this time.
          setValues((v) => ({
            ...v,
            ...(fields.name ? { name: fields.name } : {}),
            ...(fields.passport ? { passport: fields.passport } : {}),
            ...(fields.passport_issued_by
              ? { passport_issued_by: fields.passport_issued_by }
              : {}),
            ...(fields.birth_date ? { birth_date: fields.birth_date } : {}),
            ...(fields.address ? { address: fields.address } : {}),
          }));
        }}
      />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.clients.form.name}</span>
        <input
          required
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          className={FIELD_CLASS}
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.clients.form.phone}</span>
          <input
            value={values.phone}
            onChange={(e) => update("phone", e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        {/* A second number is common (work + personal, or a relative who
            actually picks up). It used to end up in the notes field, where
            search can't find it and nothing can dial it. */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.clients.form.phone2}</span>
          <input
            value={values.phone2}
            onChange={(e) => update("phone2", e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.clients.form.email}</span>
          <input
            type="email"
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.clients.form.passport}</span>
          <input
            value={values.passport}
            onChange={(e) => update("passport", e.target.value)}
            placeholder={t.clients.form.passportPlaceholder}
            className={FIELD_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">
            {t.clients.form.passportIssuedBy}
          </span>
          <input
            value={values.passport_issued_by}
            onChange={(e) => update("passport_issued_by", e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.clients.form.birthDate}</span>
          <input
            type="date"
            value={values.birth_date}
            min={birthBounds.min}
            max={birthBounds.max}
            onChange={(e) => update("birth_date", e.target.value)}
            className={`${FIELD_CLASS} ${birthInvalid ? "border-[var(--wash-rose-ink)]" : ""}`}
          />
          {birthInvalid && (
            <span className="text-xs font-medium text-[var(--wash-rose-ink)]">
              {t.clients.form.birthDateRange
                .replace("{min}", birthBounds.min)
                .replace("{max}", birthBounds.max)}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.clients.form.address}</span>
          <input
            value={values.address}
            onChange={(e) => update("address", e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">
          {t.clients.form.interestedObject}
        </span>
        <select
          value={values.interested_object_id}
          onChange={(e) => update("interested_object_id", e.target.value)}
          className={FIELD_CLASS}
        >
          <option value="">{t.clients.form.noneOption}</option>
          {objects.map((obj) => (
            <option key={obj.id} value={obj.id}>
              {obj.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.clients.form.notes}</span>
        <textarea
          value={values.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={4}
          className={TEXTAREA_CLASS}
        />
      </label>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || birthInvalid}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
        >
          {t.clients.form.save}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-[var(--wash-rose-border)] px-4 py-2.5 text-sm font-medium text-[var(--wash-rose-ink)] transition-all hover:border-[var(--wash-rose-ink)] hover:bg-[var(--wash-rose)] active:scale-[0.98]"
          >
            {t.clients.form.delete}
          </button>
        )}
      </div>
    </form>
  );
}
