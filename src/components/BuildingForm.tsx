"use client";

import { useLocale } from "@/lib/i18n/LocaleProvider";
import { FileUploadField } from "@/components/FileUploadField";
import { CONSTRUCTION_STATUSES, type BuildingInput } from "@/lib/buildings/types";

const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]";

export function BuildingForm({
  values,
  onChange,
  submitting,
  onSubmit,
  onDelete,
  hideUnitsPerFloor,
  hideFloorsCount,
  children,
}: {
  values: BuildingInput;
  onChange: (values: BuildingInput) => void;
  submitting: boolean;
  onSubmit: () => void;
  onDelete?: () => void;
  hideUnitsPerFloor?: boolean;
  hideFloorsCount?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useLocale();

  const update = <K extends keyof BuildingInput>(key: K, value: BuildingInput[K]) =>
    onChange({ ...values, [key]: value });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex max-w-3xl flex-col gap-4"
    >
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.buildings.form.name}</span>
        <input
          required
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.buildings.form.address}</span>
        <input
          value={values.address}
          onChange={(e) => update("address", e.target.value)}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">
          {t.buildings.form.constructionStatus}
        </span>
        <select
          value={values.construction_status}
          onChange={(e) =>
            update("construction_status", e.target.value as BuildingInput["construction_status"])
          }
          className={FIELD_CLASS}
        >
          {CONSTRUCTION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.buildings.constructionStatuses[s]}
            </option>
          ))}
        </select>
      </label>

      {(!hideFloorsCount || !hideUnitsPerFloor) && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!hideFloorsCount && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[var(--ink-2)]">
                {t.buildings.form.floorsCount}
              </span>
              <input
                type="number"
                min="1"
                value={values.floors_count}
                onChange={(e) => update("floors_count", e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
          )}
          {!hideUnitsPerFloor && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-[var(--ink-2)]">
                {t.buildings.form.unitsPerFloor}
              </span>
              <input
                type="number"
                min="1"
                value={values.units_per_floor}
                onChange={(e) => update("units_per_floor", e.target.value)}
                className={FIELD_CLASS}
              />
            </label>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-[var(--ink-2)]">{t.buildings.form.pricePerSqm}</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={values.price_per_sqm}
          onChange={(e) => update("price_per_sqm", e.target.value)}
          className={FIELD_CLASS}
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <FileUploadField
          label={t.buildings.form.facade}
          value={values.facade_url}
          onChange={(url) => update("facade_url", url)}
          folder="building-facades"
          uploadLabel={t.buildings.form.upload}
          uploadingLabel={t.buildings.form.uploading}
        />
        <FileUploadField
          label={t.buildings.form.plan}
          value={values.plan_url}
          onChange={(url) => update("plan_url", url)}
          folder="building-plans"
          uploadLabel={t.buildings.form.upload}
          uploadingLabel={t.buildings.form.uploading}
        />
      </div>

      {children}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
        >
          {t.buildings.form.save}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-[var(--wash-rose-border)] px-4 py-2.5 text-sm font-medium text-[var(--wash-rose-ink)] transition-all hover:border-[var(--wash-rose-ink)] hover:bg-[var(--wash-rose)] active:scale-[0.98]"
          >
            {t.buildings.form.delete}
          </button>
        )}
      </div>
    </form>
  );
}
