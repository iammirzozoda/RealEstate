"use client";

import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { FileUploadField } from "@/components/FileUploadField";
import { CURRENCIES } from "@/lib/currency";
import { STATUS_COLORS } from "@/lib/objects/format";
import { STATUS_HUES } from "@/components/charts/palette";
import { OBJECT_TYPES, type PropertyObjectInput } from "@/lib/objects/types";

const emptyInput: PropertyObjectInput = {
  name: "",
  address: "",
  type: "apartment",
  status: "available",
  area: "",
  price: "",
  currency: "TJS",
  description: "",
  plan_url: "",
  rooms: "",
};

export function ObjectForm({
  initial,
  submitting,
  onSubmit,
  onDelete,
  readOnly = false,
}: {
  initial?: Partial<PropertyObjectInput>;
  submitting: boolean;
  onSubmit: (values: PropertyObjectInput) => void;
  onDelete?: () => void;
  // View-only for non-admins: inputs are disabled and there's no Save button,
  // so managers/directors can look at a unit but never create or edit it.
  readOnly?: boolean;
}) {
  const { t } = useLocale();
  const [values, setValues] = useState<PropertyObjectInput>({
    ...emptyInput,
    ...initial,
  });

  const update = <K extends keyof PropertyObjectInput>(
    key: K,
    value: PropertyObjectInput[K]
  ) => setValues((v) => ({ ...v, [key]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
      className="flex max-w-xl flex-col gap-4"
    >
      <fieldset disabled={readOnly} className="m-0 flex flex-col gap-4 border-0 p-0">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.objects.form.name}</span>
        <input
          required
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.objects.form.address}</span>
        <input
          value={values.address}
          onChange={(e) => update("address", e.target.value)}
          className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
        />
      </label>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.objects.form.type}</span>
          <select
            value={values.type}
            onChange={(e) =>
              update("type", e.target.value as PropertyObjectInput["type"])
            }
            className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          >
            {OBJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.objects.types[type]}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.objects.form.status}</span>
          <div className="flex items-center gap-2 rounded-md border border-[var(--border-c)] bg-[var(--surface-2)] px-3 py-2 text-[var(--ink-3)]">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: STATUS_HUES[values.status].solid }}
            />
            {t.objects.statuses[values.status]}
          </div>
          <span className="text-xs text-[var(--ink-5)]">{t.objects.form.statusAutoHint}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.objects.form.rooms}</span>
          <input
            type="number"
            min="0"
            value={values.rooms}
            onChange={(e) => update("rooms", e.target.value)}
            className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.objects.form.area}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={values.area}
            onChange={(e) => update("area", e.target.value)}
            className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-[var(--ink-2)]">{t.objects.form.price}</span>
          <div className="flex gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              value={values.price}
              onChange={(e) => update("price", e.target.value)}
              className="w-full rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
            <select
              value={values.currency}
              onChange={(e) =>
                update("currency", e.target.value as PropertyObjectInput["currency"])
              }
              className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-2 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.objects.form.description}</span>
        <textarea
          value={values.description}
          onChange={(e) => update("description", e.target.value)}
          rows={4}
          className="rounded-md border border-[var(--field-border)] bg-[var(--field-bg)] px-3 py-2 text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
        />
      </label>

      <FileUploadField
        label={t.objects.form.plan}
        value={values.plan_url}
        onChange={(url) => update("plan_url", url)}
        folder="unit-plans"
        uploadLabel={t.objects.form.upload}
        uploadingLabel={t.objects.form.uploading}
      />
      </fieldset>

      {!readOnly && (
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
          >
            {submitting ? t.objects.form.saving : t.objects.form.save}
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md border border-[var(--wash-rose-border)] px-4 py-2 text-sm font-medium text-[var(--wash-rose-ink)] hover:bg-[var(--wash-rose)]"
            >
              {t.objects.form.delete}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
