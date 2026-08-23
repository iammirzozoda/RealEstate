"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { Modal } from "@/components/Modal";
import { OBJECT_TYPES, type ObjectType, type PropertyObject } from "@/lib/objects/types";
import { CURRENCIES, type Currency } from "@/lib/currency";

// Fills a single gap in the shakhmatka -- a unit that was deleted, or one
// that was simply never created for this slot. Pre-fills from whatever
// unit already sits at the same position on another floor (the same spot
// in the layout is usually the same kind of apartment floor to floor), so
// restoring one is normally just "confirm" rather than filling in every
// field from scratch.
export function QuickAddUnitModal({
  buildingId,
  floor,
  block,
  position,
  siblingUnit,
  onClose,
  onAdded,
}: {
  buildingId: string;
  floor: number;
  block: string;
  position: number;
  siblingUnit: PropertyObject | undefined;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useLocale();
  const [type, setType] = useState<ObjectType>(siblingUnit?.type ?? "apartment");
  const [rooms, setRooms] = useState(siblingUnit?.rooms?.toString() ?? "");
  const [area, setArea] = useState(siblingUnit?.area?.toString() ?? "");
  const [price, setPrice] = useState(siblingUnit?.price?.toString() ?? "");
  const [currency, setCurrency] = useState<Currency>(siblingUnit?.currency ?? "TJS");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = `${block ? `${block} ` : ""}№${floor}-${position}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase
      .schema("crm")
      .from("objects")
      .insert({
        name,
        type,
        status: "available",
        area: area ? Number(area) : null,
        price: price ? Number(price) : null,
        currency,
        rooms: rooms ? Number(rooms) : null,
        building_id: buildingId,
        block: block || null,
        floor,
        position_in_floor: position,
        span: 1,
      });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    onAdded();
    onClose();
  };

  return (
    <Modal title={`${t.buildings.addUnitHere} — ${name}`} onClose={onClose} guardClose>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {siblingUnit && (
          <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink-4)]">
            {t.buildings.addUnitPrefilled}
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.objects.form.type}</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ObjectType)}
              className="h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            >
              {OBJECT_TYPES.map((t2) => (
                <option key={t2} value={t2}>
                  {t.objects.types[t2]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.objects.form.rooms}</span>
            <input
              type="number"
              min="0"
              value={rooms}
              onChange={(e) => setRooms(e.target.value)}
              className="h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.objects.form.area}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.objects.form.price}</span>
            <input
              type="number"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-[var(--ink-2)]">{t.contracts.form.currency}</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="h-10 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md active:scale-[0.98] disabled:opacity-50"
        >
          {submitting ? t.common.loading : t.buildings.addUnitHere}
        </button>
        {error && <p className="text-sm text-[var(--wash-rose-ink)]">{error}</p>}
      </form>
    </Modal>
  );
}
