"use client";

import { useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { createClient } from "@/lib/supabase/client";
import { OBJECT_TYPES, type ObjectType } from "@/lib/objects/types";
import { buildUnitsFromRows, type StructureRow } from "@/lib/buildings/generateUnits";
import { formatCurrency } from "@/lib/currency";
import type { PropertyObject } from "@/lib/objects/types";
import { AddButton } from "@/components/AddButton";

// Atlas accents, same as the hero and the contract.
const PLUM = "#5b3468";

// Preview badge colour per unit type, so a shop/office floor is visibly
// different from a residential one at a glance.
const TYPE_TINT: Record<string, string> = {
  apartment: "bg-[var(--wash-emerald)] text-[var(--wash-emerald-ink)]",
  house: "bg-[var(--wash-emerald)] text-[var(--wash-emerald-ink)]",
  commercial: "bg-[var(--wash-amber)] text-[var(--wash-amber-ink)]",
  office: "bg-[var(--wash-sky)] text-[var(--wash-sky-ink)]",
  parking: "bg-[var(--wash-slate)] text-[var(--wash-slate-ink)]",
  land: "bg-[var(--wash-emerald)] text-[var(--wash-emerald-ink)]",
  construction_site: "bg-[var(--wash-amber)] text-[var(--wash-amber-ink)]",
};

const FIELD =
  "h-9 rounded-lg border border-[var(--field-border)] px-2.5 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]";

// One stretch of identical floors inside a block: "floors 2..9, four
// 2-room apartments of 53.5 m² each". A block is described by a few of
// these instead of one hand-typed row per floor.
type FloorRange = {
  from: string;
  to: string;
  count: string;
  rooms: string;
  type: ObjectType;
  area: string;
};

type BlockDraft = {
  name: string;
  ranges: FloorRange[];
};

const emptyRange = (): FloorRange => ({
  from: "",
  to: "",
  count: "",
  rooms: "",
  type: "apartment",
  area: "",
});

const emptyBlock = (): BlockDraft => ({ name: "", ranges: [emptyRange()] });

// Expand block cards into the flat per-floor rows the existing generator
// understands -- it already knows how to continue positions next to
// whatever units the building has.
function expandBlocks(blocks: BlockDraft[]): StructureRow[] {
  const rows: StructureRow[] = [];
  for (const b of blocks) {
    for (const r of b.ranges) {
      const from = Number(r.from);
      const to = r.to === "" ? from : Number(r.to);
      if (r.from === "" || Number.isNaN(from) || Number.isNaN(to) || !Number(r.count))
        continue;
      const step = to >= from ? 1 : -1;
      for (let f = from; step > 0 ? f <= to : f >= to; f += step) {
        rows.push({
          block: b.name.trim(),
          floor: String(f),
          rooms: r.rooms,
          type: r.type,
          count: r.count,
          area: r.area,
        });
      }
    }
  }
  return rows;
}

export function FloorUnitsBuilder({
  buildingId,
  pricePerSqm,
  existingUnits,
  onGenerated,
}: {
  buildingId: string;
  pricePerSqm: number | null;
  existingUnits: PropertyObject[];
  onGenerated: () => Promise<void> | void;
}) {
  const { t } = useLocale();
  const [blocks, setBlocks] = useState<BlockDraft[]>([emptyBlock()]);
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);

  // What the building looks like right now, grouped by block -- so whoever
  // is editing sees what's already there before adding to it, and so a new
  // block's name can be checked against existing ones.
  const existingBlocks = useMemo(() => {
    const map = new Map<string, { floors: Set<number>; count: number }>();
    for (const u of existingUnits) {
      const key = u.block?.trim() || "";
      const entry = map.get(key) ?? { floors: new Set<number>(), count: 0 };
      if (u.floor != null) entry.floors.add(u.floor);
      entry.count++;
      map.set(key, entry);
    }
    return [...map.entries()].map(([name, v]) => ({
      name,
      floors: v.floors.size,
      count: v.count,
    }));
  }, [existingUnits]);

  const existingNames = useMemo(
    () => new Set(existingBlocks.map((b) => b.name).filter(Boolean)),
    [existingBlocks]
  );

  const previewCount = useMemo(
    () => expandBlocks(blocks).reduce((sum, r) => sum + Number(r.count), 0),
    [blocks]
  );

  // Estimated value of the plan: floors x per-floor x area x price/m2 for
  // every range that has an area. Rough by design -- it exists so a typo
  // (extra zero in the count, wrong area) jumps out before generating.
  const previewPrice = useMemo(() => {
    if (!pricePerSqm) return 0;
    return expandBlocks(blocks).reduce((sum, r) => {
      const area = Number(r.area);
      if (!area) return sum;
      return sum + Number(r.count) * area * pricePerSqm;
    }, 0);
  }, [blocks, pricePerSqm]);

  // Live shakhmatka preview: existing structure in grey, planned additions
  // in green, per block per floor. What the plan LOOKS like, before it runs.
  const previewGrid = useMemo(() => {
    type Cell = { existing: number; added: number; addedType: ObjectType | null };
    const byBlock = new Map<string, Map<number, Cell>>();
    const cellFor = (block: string, floor: number) => {
      const floors = byBlock.get(block) ?? new Map<number, Cell>();
      const cell = floors.get(floor) ?? { existing: 0, added: 0, addedType: null };
      floors.set(floor, cell);
      byBlock.set(block, floors);
      return cell;
    };
    for (const u of existingUnits) {
      if (u.floor != null) cellFor(u.block?.trim() || "", u.floor).existing += 1;
    }
    for (const r of expandBlocks(blocks)) {
      const cell = cellFor(r.block, Number(r.floor));
      cell.added += Number(r.count);
      cell.addedType = r.type; // one type per floor range; last wins
    }
    return [...byBlock.entries()].map(([name, floors]) => ({
      name,
      floors: [...floors.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([floor, cell]) => ({ floor, ...cell })),
    }));
  }, [existingUnits, blocks]);

  const patchBlock = (i: number, patch: Partial<BlockDraft>) =>
    setBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const patchRange = (i: number, k: number, patch: Partial<FloorRange>) =>
    setBlocks((bs) =>
      bs.map((b, j) =>
        j === i
          ? { ...b, ranges: b.ranges.map((r, m) => (m === k ? { ...r, ...patch } : r)) }
          : b
      )
    );

  const handleGenerate = async () => {
    const toCreate = buildUnitsFromRows(
      expandBlocks(blocks),
      buildingId,
      pricePerSqm,
      existingUnits
    );
    if (toCreate.length === 0) return;

    setGenerating(true);
    const supabase = createClient();
    const { error } = await supabase.schema("crm").from("objects").insert(toCreate);
    if (!error) {
      await onGenerated();
      setBlocks([emptyBlock()]);
      setDone(true);
      setTimeout(() => setDone(false), 4000);
    }
    setGenerating(false);
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface-1)] p-5 shadow-sm">
      <div>
        <p className="text-[15px] font-semibold text-[var(--ink-2)]">
          {t.buildings.floorBuilder.title}
        </p>
        <p className="mt-0.5 text-sm text-[var(--ink-4)]">{t.buildings.floorBuilder.hint}</p>
      </div>

      {existingBlocks.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-5)]">
            {t.buildings.floorBuilder.existing}
          </span>
          {existingBlocks.map((b) => (
            <span
              key={b.name || "__none"}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-c)] bg-[var(--surface-2)] px-3 py-1 text-xs text-[var(--ink-3)]"
            >
              <span className="font-semibold text-[var(--ink-2)]">
                {b.name || t.buildings.floorBuilder.noBlockName}
              </span>
              {b.floors} {t.buildings.floorBuilder.floorsShort} · {b.count}{" "}
              {t.buildings.floorBuilder.unitsShort}
            </span>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {blocks.map((block, i) => {
          const joinsExisting = existingNames.has(block.name.trim());
          return (
            <div
              key={i}
              style={{ borderColor: `${PLUM}55` }}
              className="flex flex-col gap-3 rounded-xl border bg-[var(--surface-2)]/60 p-4"
            >
              <div className="flex flex-wrap items-end justify-between gap-2">
                <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs">
                  <span style={{ color: PLUM }} className="font-semibold">
                    {t.buildings.floorBuilder.blockName}
                  </span>
                  <input
                    value={block.name}
                    onChange={(e) => patchBlock(i, { name: e.target.value })}
                    placeholder={t.buildings.floorBuilder.blockPlaceholder}
                    list="existing-blocks"
                    className={`${FIELD} bg-[var(--field-bg)] font-medium`}
                  />
                  {joinsExisting && (
                    <span className="text-[11px] text-[var(--wash-emerald-ink)]">
                      ✓ {t.buildings.floorBuilder.existingBlockHint}
                    </span>
                  )}
                </label>
                {blocks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setBlocks((bs) => bs.filter((_, j) => j !== i))}
                    className="rounded-lg border border-[var(--wash-rose-border)] px-2.5 py-1.5 text-xs text-[var(--wash-rose-ink)] transition-colors hover:bg-[var(--wash-rose)]"
                  >
                    {t.buildings.floorBuilder.removeBlock}
                  </button>
                )}
              </div>

              {/* Column labels once per block (desktop); on mobile each field
                  carries its own small label instead. */}
              <div
                className="hidden gap-2 px-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-5)] sm:grid sm:grid-cols-[70px_70px_1fr_0.9fr_1.4fr_1fr_34px]"
              >
                <span>{t.buildings.floorBuilder.floorsFrom}</span>
                <span>{t.buildings.floorBuilder.floorsTo}</span>
                <span>{t.buildings.floorBuilder.perFloor}</span>
                <span>{t.buildings.floorBuilder.rooms}</span>
                <span>{t.buildings.floorBuilder.type}</span>
                <span>{t.buildings.floorBuilder.area}</span>
                <span />
              </div>

              {block.ranges.map((r, k) => (
                <div key={k} className="grid grid-cols-2 gap-x-2 gap-y-1 sm:grid-cols-[70px_70px_1fr_0.9fr_1.4fr_1fr_34px] sm:items-center">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium text-[var(--ink-4)] sm:hidden">
                      {t.buildings.floorBuilder.floorsFrom}
                    </span>
                    <input
                      type="number"
                      value={r.from}
                      onChange={(e) => patchRange(i, k, { from: e.target.value })}
                      placeholder="1"
                      className={`${FIELD} w-full bg-[var(--field-bg)] text-center`}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium text-[var(--ink-4)] sm:hidden">
                      {t.buildings.floorBuilder.floorsTo}
                    </span>
                    <input
                      type="number"
                      value={r.to}
                      onChange={(e) => patchRange(i, k, { to: e.target.value })}
                      placeholder={r.from || "9"}
                      className={`${FIELD} w-full bg-[var(--field-bg)] text-center`}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium text-[var(--ink-4)] sm:hidden">
                      {t.buildings.floorBuilder.perFloor}
                    </span>
                    <input
                      type="number"
                      min="1"
                      value={r.count}
                      onChange={(e) => patchRange(i, k, { count: e.target.value })}
                      className={`${FIELD} w-full bg-[var(--field-bg)]`}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium text-[var(--ink-4)] sm:hidden">
                      {t.buildings.floorBuilder.rooms}
                    </span>
                    <input
                      type="number"
                      min="0"
                      value={r.rooms}
                      onChange={(e) => patchRange(i, k, { rooms: e.target.value })}
                      className={`${FIELD} w-full bg-[var(--field-bg)]`}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium text-[var(--ink-4)] sm:hidden">
                      {t.buildings.floorBuilder.type}
                    </span>
                    <select
                      value={r.type}
                      onChange={(e) => patchRange(i, k, { type: e.target.value as ObjectType })}
                      className={`${FIELD} w-full bg-[var(--field-bg)]`}
                    >
                      {OBJECT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t.objects.types[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] font-medium text-[var(--ink-4)] sm:hidden">
                      {t.buildings.floorBuilder.area}
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={r.area}
                      onChange={(e) => patchRange(i, k, { area: e.target.value })}
                      className={`${FIELD} w-full bg-[var(--field-bg)]`}
                    />
                  </label>
                  <div className="col-span-2 flex justify-end sm:col-span-1 sm:justify-center">
                    {block.ranges.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          patchBlock(i, { ranges: block.ranges.filter((_, m) => m !== k) })
                        }
                        title={t.buildings.floorBuilder.removeRange}
                        className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--wash-rose-border)] text-sm text-[var(--wash-rose-ink)] transition-colors hover:bg-[var(--wash-rose)]"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <AddButton
                size="sm"
                onClick={() => patchBlock(i, { ranges: [...block.ranges, emptyRange()] })}
              >
                {t.buildings.floorBuilder.addRange}
              </AddButton>
            </div>
          );
        })}
      </div>

      {/* Datalist backs the block-name input: picking an existing name adds
          floors to that block instead of creating a lookalike. */}
      <datalist id="existing-blocks">
        {[...existingNames].map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      {previewGrid.length > 0 && (
        <div className="rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)]/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-[var(--ink-2)]">
              {t.buildings.floorBuilder.preview}
            </p>
            <div className="flex items-center gap-3 text-[10.5px] text-[var(--ink-4)]">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-[var(--wash-emerald)]" />
                {t.buildings.floorBuilder.newMarker}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-[var(--track-c)]" />
                {t.buildings.floorBuilder.existingMarker}
              </span>
            </div>
          </div>

          <div className="mt-3 flex gap-5 overflow-x-auto pb-1">
            {previewGrid.map((b) => (
              <div key={b.name || "__none"} className="shrink-0">
                <p className="mb-1.5 text-[11px] font-semibold text-[var(--ink-3)]">
                  {b.name || t.buildings.floorBuilder.noBlockName}
                </p>
                <div className="flex flex-col gap-[3px]">
                  {b.floors.map((f) => (
                    <div key={f.floor} className="flex items-center gap-1.5">
                      <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-[var(--ink-5)]">
                        {f.floor}
                      </span>
                      {f.existing > 0 && (
                        <span className="flex h-5 min-w-10 items-center justify-center rounded bg-[var(--track-c)] px-1.5 text-[10px] font-semibold text-[var(--ink-3)]">
                          {f.existing}x
                        </span>
                      )}
                      {f.added > 0 && (
                        <span
                          className={`flex h-5 min-w-10 items-center justify-center rounded px-1.5 text-[10px] font-semibold ${
                            f.addedType ? TYPE_TINT[f.addedType] ?? "bg-[var(--wash-emerald)] text-[var(--wash-emerald-ink)]" : "bg-[var(--wash-emerald)] text-[var(--wash-emerald-ink)]"
                          }`}
                        >
                          +{f.added}
                        </span>
                      )}
                      {f.added > 0 &&
                        f.addedType &&
                        f.addedType !== "apartment" &&
                        f.addedType !== "house" && (
                          <span className="text-[9px] text-[var(--ink-5)]">
                            {t.objects.types[f.addedType]}
                          </span>
                        )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {previewCount > 0 && (
            <div className="mt-3 border-t border-[var(--border-c)] pt-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-5)]">
                {t.buildings.floorBuilder.estTitle}
              </p>
              <div className="mt-1 flex flex-col gap-0.5 text-[12.5px]">
                <p className="flex justify-between">
                  <span className="text-[var(--ink-4)]">
                    {t.buildings.floorBuilder.estUnits}
                  </span>
                  <span className="font-bold text-[var(--ink-2)]">{previewCount}</span>
                </p>
                {previewPrice > 0 && (
                  <p className="flex justify-between">
                    <span className="text-[var(--ink-4)]">
                      {t.buildings.floorBuilder.estPrice}
                    </span>
                    <span className="font-bold text-[var(--ink-2)]">
                      {formatCurrency(previewPrice, "TJS")}
                    </span>
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <AddButton onClick={() => setBlocks((bs) => [...bs, emptyBlock()])}>
          {t.buildings.floorBuilder.addBlock}
        </AddButton>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating || previewCount === 0}
          className="rounded-lg btn-brand px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-40"
        >
          {generating ? t.common.loading : t.buildings.floorBuilder.generate}
        </button>
        {previewCount > 0 && !done && (
          <span className="text-sm text-[var(--ink-4)]">
            {t.buildings.floorBuilder.willCreate}{" "}
            <span className="font-bold text-[var(--ink-2)]">{previewCount}</span>
          </span>
        )}
        {done && (
          <span className="text-sm font-medium text-[var(--wash-emerald-ink)]">
            ✓ {t.buildings.floorBuilder.created}
          </span>
        )}
      </div>
    </div>
  );
}
