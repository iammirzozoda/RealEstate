"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatCurrency } from "@/lib/currency";
import { formatArea } from "@/lib/objects/format";
import { STATUS_HUES } from "@/components/charts/palette";
import { OBJECT_TYPES, type ObjectType, type PropertyObject } from "@/lib/objects/types";
import type { UnitContractInfo } from "@/components/ShakhmatkaGrid";

// A separate section from the shakhmatka, after it on the same page --
// units meant to be rented out (a warehouse, storage) rather than sold.
// Kept deliberately simple: a plain list, not a spatial grid, since a row
// of storage units doesn't have the floor/position layout an apartment
// grid is drawn from. Each unit's own lease (term, monthly rate) is set
// per contract via the same ContractBookingModal the shakhmatka uses --
// nothing here assumes every unit shares the same term.
export function RentalUnitsSection({
  buildingId,
  units,
  contractsByUnit,
  canEdit,
  onBookUnit,
  onAdded,
  onDeleted,
}: {
  buildingId: string;
  units: PropertyObject[];
  contractsByUnit: Record<string, UnitContractInfo>;
  canEdit: boolean;
  onBookUnit: (unit: PropertyObject) => void;
  onAdded: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const pathname = usePathname();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [type, setType] = useState<ObjectType>("commercial");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cashDesk = (contractId: string) =>
    `/contracts/${contractId}/payments?from=${encodeURIComponent(pathname)}`;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.schema("crm").from("objects").insert({
      name: name.trim(),
      type,
      status: "available",
      listing_type: "rent",
      area: area ? Number(area) : null,
      building_id: buildingId,
      span: 1,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    setArea("");
    setAdding(false);
    onAdded();
  };

  const handleDelete = async (unit: PropertyObject) => {
    const ok = await confirm(t.buildings.rental.deleteConfirm, { danger: true });
    if (!ok) return;
    const supabase = createClient();
    await supabase.schema("crm").from("objects").delete().eq("id", unit.id);
    onDeleted();
  };

  if (units.length === 0 && !canEdit) return null;

  return (
    <div className="mt-2 flex flex-col gap-3 border-t border-[var(--border-c2)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink-1)]">
            {t.buildings.rental.title}
          </h2>
          <p className="text-xs text-[var(--ink-4)]">{t.buildings.rental.subtitle}</p>
        </div>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-fit rounded-lg border border-[var(--field-border)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--hover-c)]"
          >
            {t.buildings.rental.add}
          </button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-c)] bg-[var(--surface-2)] p-3"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-[var(--ink-3)]">{t.buildings.rental.name}</span>
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.buildings.rental.namePlaceholder}
              className="h-9 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-[var(--ink-3)]">{t.buildings.rental.area}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="h-9 w-28 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-[var(--ink-3)]">{t.buildings.rental.type}</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ObjectType)}
              className="h-9 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            >
              {OBJECT_TYPES.map((ot) => (
                <option key={ot} value={ot}>
                  {t.objects.types[ot]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="h-9 rounded-lg bg-brand px-3.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {t.buildings.rental.save}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-9 rounded-lg border border-[var(--field-border)] px-3.5 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--hover-c)]"
            >
              {t.buildings.rental.cancel}
            </button>
          </div>
          {error && <p className="w-full text-xs text-[var(--wash-rose-ink)]">{error}</p>}
        </form>
      )}

      {units.length === 0 ? (
        <p className="text-sm text-[var(--ink-5)]">{t.buildings.rental.empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {units.map((unit) => {
            const contractInfo = contractsByUnit[unit.id];
            return (
              <div
                key={unit.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: STATUS_HUES[unit.status].solid }}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--ink-1)]">{unit.name}</p>
                    <p className="text-xs text-[var(--ink-4)]">
                      {[
                        t.objects.types[unit.type],
                        unit.area != null ? formatArea(unit.area) : null,
                        t.objects.statuses[unit.status],
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>

                {contractInfo ? (
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-[var(--ink-5)]">{t.buildings.rental.tenant}</p>
                      <p className="text-sm font-medium text-[var(--ink-2)]">
                        {contractInfo.clientName}
                      </p>
                    </div>
                    {contractInfo.remaining > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-[var(--ink-5)]">{t.buildings.hover.remaining}</p>
                        <p className="text-sm font-semibold text-[var(--wash-rose-ink)]">
                          {formatCurrency(contractInfo.remaining, contractInfo.currency)}
                        </p>
                      </div>
                    )}
                    <Link
                      href={cashDesk(contractInfo.id)}
                      className="shrink-0 rounded-lg border border-[var(--field-border)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--hover-c)]"
                    >
                      {t.buildings.rental.paymentsAction}
                    </Link>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDelete(unit)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--wash-rose-ink)] transition-colors hover:bg-[var(--wash-rose)]"
                      >
                        {t.common.confirmDeleteBtn}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onBookUnit(unit)}
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98]"
                    >
                      {t.buildings.rental.bookAction}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
