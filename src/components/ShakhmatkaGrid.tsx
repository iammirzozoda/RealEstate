"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { CELL_COLORS, STATUS_COLORS, STATUS_PROGRESS_COLORS, formatArea } from "@/lib/objects/format";
import { STATUS_HUES } from "@/components/charts/palette";
import { formatCurrency, type Currency } from "@/lib/currency";
import { computeApartmentNumbers } from "@/lib/buildings/apartmentNumbers";
import { ControlGroup, GroupDivider, PillButton } from "@/components/ActionBar";
import type { ObjectStatus, PropertyObject } from "@/lib/objects/types";

export type UnitContractInfo = {
  id: string;
  clientName: string;
  clientPhone: string | null;
  amount: number;
  paid: number;
  remaining: number;
  currency: Currency;
  paymentsCount: number;
  isQuickBooking: boolean;
};

const CELL = 64;
const GAP = 8;

// Apartments and houses are the "main" shakhmatka. Everything else (shops,
// offices, parking, land, construction) is non-residential and lives in its
// own section below -- so a basement full of parking bays, or a strip of
// shops, can never stretch the apartment grid or shove entrances apart.
const RESIDENTIAL_TYPES = new Set(["apartment", "house"]);
function isResidential(u: PropertyObject): boolean {
  return RESIDENTIAL_TYPES.has(u.type ?? "apartment");
}
// Order non-residential groups predictably.
const NON_RES_ORDER = ["commercial", "office", "parking", "land", "construction_site"];

// Non-residential units are marked visually distinct from flats: a coloured
// ring, a slight separation, and a purpose prefix on the number so a
// ground-floor shop reads "М1", a parking bay "П1", an office "О1" -- never
// confused with apartment "1". Apartments/houses have no prefix or ring.
const TYPE_META: Record<string, { prefix: string; ring: string }> = {
  commercial: { prefix: "М", ring: "ring-2 ring-amber-400" },
  office: { prefix: "О", ring: "ring-2 ring-sky-400" },
  parking: { prefix: "П", ring: "ring-2 ring-slate-400" },
  land: { prefix: "З", ring: "ring-2 ring-lime-400" },
  construction_site: { prefix: "С", ring: "ring-2 ring-orange-400" },
};


// A flat that cannot be sold as it stands. These are the ones the dashboard
// reports as "без цены — в сумму не вошли": the potential is a sum of stored
// prices, so a flat with no price adds nothing to it, and a flat with no area
// can never be given one -- площадь × ставка has nothing to multiply. Sold
// flats are excluded: their price is settled and not part of any potential.
export type GapFilter = "no_price" | "no_area" | null;

export function hasGap(unit: PropertyObject, gap: Exclude<GapFilter, null>): boolean {
  if (unit.status === "sold") return false;
  if (gap === "no_area") return !(unit.area != null && unit.area > 0);
  return !(unit.price != null && unit.price > 0);
}

function UnitCell({
  unit,
  apartmentNumber,
  floorUnits,
  contractInfo,
  onBookUnit,
  onQuickBook,
  onCancelQuickBook,
  isPending,
  onMergeUnits,
  onSplitUnit,
  onDeleteUnit,
  canEditSold,
  readOnly,
  onViewUnit,
  statusFilter,
  roomsFilter,
  gapFilter,
  editMode,
  openUpward = false,
}: {
  unit: PropertyObject;
  apartmentNumber: number | undefined;
  floorUnits: PropertyObject[];
  contractInfo: UnitContractInfo | undefined;
  onBookUnit: (unit: PropertyObject) => void;
  onQuickBook: (unit: PropertyObject) => void;
  onCancelQuickBook: (unit: PropertyObject, contractId: string) => void;
  isPending: boolean;
  onMergeUnits: (unitA: PropertyObject, unitB: PropertyObject) => void;
  onSplitUnit: (unit: PropertyObject) => void;
  onDeleteUnit: (unit: PropertyObject) => void;
  canEditSold: boolean;
  readOnly: boolean;
  onViewUnit: (unit: PropertyObject) => void;
  statusFilter: ObjectStatus | null;
  roomsFilter: number | null;
  gapFilter: GapFilter;
  editMode: boolean;
  // Near the bottom of the grid there aren't enough rows left below for the
  // hover card to open into -- it used to be kept clear of the container's
  // bottom edge with a permanent ~288px of blank padding under the whole
  // grid instead, which read as a big dead gap even when nobody was
  // hovering anything. Opening upward for the last few rows means that
  // padding is no longer load-bearing and can shrink back down to nothing.
  openUpward?: boolean;
}) {
  const { t } = useLocale();
  const router = useRouter();
  // Where "back" should return to. Opening a sold flat lands on the buyer's
  // card, which otherwise offers "back to the client list" -- a place the
  // user was never at. Carrying the origin through keeps the way out
  // pointing at the shakhmatka they came from.
  const pathname = usePathname();
  const cashDesk = (contractId: string) =>
    `/contracts/${contractId}/payments?from=${encodeURIComponent(pathname)}`;

  const span = unit.span || 1;
  const width = span * CELL + (span - 1) * GAP;
  const nextUnit = floorUnits.find(
    (u) => u.position_in_floor === (unit.position_in_floor ?? 0) + span
  );
  // Merging is a structural edit -- admins only (canEditSold gates that).
  const canMerge =
    canEditSold && unit.status === "available" && nextUnit && nextUnit.status === "available";
  // Both filters narrow together, and a cell that fails either one is
  // dimmed rather than removed: dropping cells would collapse the floors and
  // the grid would stop being a shakhmatka -- the point of it is that every
  // flat keeps its place whether or not it matches what you asked for.
  const dimmed =
    (statusFilter !== null && unit.status !== statusFilter) ||
    (roomsFilter !== null && unit.rooms !== roomsFilter) ||
    (gapFilter !== null && !hasGap(unit, gapFilter));
  const typeMeta = TYPE_META[unit.type ?? "apartment"];

  // Payment standing of this cell. Only meaningful where there IS a contract:
  // a free flat owes nothing and must not look like a fully paid one.
  // `settled` uses remaining rather than a percentage so a few cents of
  // rounding on the last installment still counts as done.
  const payProgress =
    contractInfo && contractInfo.amount > 0
      ? {
          pct: Math.max(0, Math.min(100, (contractInfo.paid / contractInfo.amount) * 100)),
          settled: contractInfo.remaining <= 0.005,
        }
      : null;

  // Left click: available -> open the full contract-drafting dialog.
  // Already booked/sold -> a client paying their installment is routine
  // front-desk work, not admin-only, so anyone jumps straight to that
  // unit's payments/receipt screen if a contract exists; only the
  // fallback (a unit marked busy with no contract at all) is gated to
  // admins, since that means editing the raw unit record.
  const handlePrimaryAction = () => {
    if (isPending) return;
    // Edit mode: any cell opens its editor (rooms/area/price), never books.
    if (editMode) {
      onViewUnit(unit);
      return;
    }
    if (readOnly) {
      // Director: everything opens as a view -- the cash desk page is
      // already read-only for this role, unit cells never open write forms.
      if (contractInfo) router.push(cashDesk(contractInfo.id));
      else onViewUnit(unit);
      return;
    }
    if (unit.status === "available") {
      onBookUnit(unit);
    } else if (contractInfo) {
      router.push(cashDesk(contractInfo.id));
    } else if (unit.manual_reserved) {
      // Hand-reserved, no contract yet: the natural next step is drafting
      // the real contract for whoever the unit was held for.
      onBookUnit(unit);
    } else if (canEditSold) {
      router.push(`/objects/${unit.id}`);
    } else {
      onViewUnit(unit);
    }
  };

  return (
    <div className="group relative shrink-0" style={{ width }}>
      <button
        type="button"
        onClick={handlePrimaryAction}
        onContextMenu={(e) => {
          e.preventDefault();
          if (isPending || readOnly) return;
          // Right click toggles a quick booking. Decide by whether the
          // unit's contract is an untouched placeholder booking -- NOT by
          // the unit's status color: if the status-sync DB trigger is
          // missing or lagging, the cell can still read "available" while
          // its placeholder contract already exists (and vice versa), and
          // keying off status made the second right-click a silent no-op.
          if (contractInfo?.isQuickBooking) {
            onCancelQuickBook(unit, contractInfo.id);
          } else {
            // Real bookings (or no contract at all) go to the page handler,
            // which quick-books a free unit or explains why it can't.
            onQuickBook(unit);
          }
        }}
        disabled={isPending}
        style={{ width }}
        className={`relative flex h-14 flex-col items-center justify-center overflow-hidden rounded-md text-[11px] font-semibold leading-tight transition-all hover:scale-105 hover:ring-2 hover:ring-offset-1 hover:ring-[color-mix(in_srgb,var(--brand)_45%,transparent)] ${
          isPending ? "animate-pulse opacity-60" : ""
        } ${dimmed ? "opacity-20 saturate-0" : ""} ${
          typeMeta ? `${typeMeta.ring} ring-offset-1` : ""
        } ${CELL_COLORS[unit.status]}`}
      >
        <span>
          {typeMeta?.prefix}
          {apartmentNumber ?? "—"}
        </span>

        {/* How much of this flat is actually paid for, readable without
            hovering anything: a thin fill along the bottom edge while money is
            still owed, and a small tick once nothing is. The status colour
            alone can't say this -- "продано" is the same red whether the
            client has paid 5% or 95%.
            The fill is that cell's OWN hue, just stronger, so it reads as more
            of the cell rather than a second colour system laid on top. The
            tick stays green everywhere: "nothing left to pay" is the one
            meaning that shouldn't change shade with the status. */}
        {payProgress != null &&
          (payProgress.settled ? (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 text-emerald-600"
              title={t.buildings.hover.fullyPaid}
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12.5l5.5 5.5L20 6.5" />
              </svg>
            </span>
          ) : (
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 bottom-0 h-1.5 ${STATUS_PROGRESS_COLORS[unit.status].track}`}
            >
              <span
                className={`block h-full ${STATUS_PROGRESS_COLORS[unit.status].fill}`}
                style={{ width: `${payProgress.pct}%` }}
              />
            </span>
          ))}
      </button>

      {canMerge && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onMergeUnits(unit, nextUnit);
          }}
          title={t.buildings.merge}
          className="absolute -right-2 top-1/2 z-20 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-xs text-white group-hover:flex"
        >
          +
        </button>
      )}

      {/* Edit-mode cell tools (admin): split a merged cell back apart, or
          delete the cell. Shown on hover so they don't clutter the grid. */}
      {editMode && canEditSold && (
        <div className="absolute -top-2 right-1 z-30 hidden gap-1 group-hover:flex">
          {(unit.span || 1) > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSplitUnit(unit);
              }}
              title={t.buildings.cellActions.split}
              className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-[11px] text-white shadow hover:bg-brand"
            >
              ⤢
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteUnit(unit);
            }}
            title={t.buildings.cellActions.delete}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-[11px] font-bold text-white shadow hover:bg-rose-700"
          >
            ×
          </button>
        </div>
      )}

      {/* Hover card: everything the front desk asks about a unit at a
          glance -- price, how much is paid (with a progress bar), what's
          left, who the buyer is and their phone. */}
      {/* Anchored to the cell's LEFT edge, opening rightward -- so the card
          for a leftmost cell never extends left under the sidebar (where it
          used to get clipped and "disappear"). */}
      <div
        className={`pointer-events-none invisible absolute left-0 z-40 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[var(--border-c)] bg-[var(--surface-1)] text-xs shadow-xl group-hover:visible ${
          openUpward ? "bottom-full mb-2" : "top-full mt-2"
        }`}
      >
        <div className="flex items-start justify-between gap-2 px-3.5 pb-1.5 pt-3">
          <div>
            <p className="text-[15px] font-bold leading-tight text-[var(--ink-1)]">
              {apartmentNumber != null ? `№${apartmentNumber}` : unit.name}
            </p>
            <p className="mt-0.5 text-[10.5px] text-[var(--ink-4)]">
              {[
                unit.floor != null ? `${unit.floor} ${t.buildings.hover.floorShort}` : null,
                unit.block,
                unit.rooms != null ? `${unit.rooms} ${t.buildings.hover.roomsShort}` : null,
                unit.area != null ? formatArea(unit.area) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[unit.status]}`}
          >
            {t.objects.statuses[unit.status]}
          </span>
        </div>

        <div className="flex items-baseline justify-between border-t border-[var(--border-c2)] px-3.5 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-5)]">
            {t.buildings.hover.price}
          </span>
          <span className="text-[13px] font-bold text-[var(--ink-1)]">
            {/* Once a contract exists, its negotiated amount IS the deal's
                real price (may differ from the catalog price via a discount
                or a hand-agreed rate) -- show that, not the listing price. */}
            {contractInfo
              ? formatCurrency(contractInfo.amount, contractInfo.currency)
              : formatCurrency(unit.price, unit.currency)}
          </span>
        </div>
        {unit.area != null && unit.area > 0 && (
          <div className="flex items-baseline justify-between px-3.5 pb-1.5">
            <span className="text-[10px] text-[var(--ink-5)]">{t.buildings.hover.pricePerSqm}</span>
            <span className="text-[11px] font-medium text-[var(--ink-3)]">
              {/* Same price the row above shows (deal amount once sold/
                  reserved, catalog price otherwise) divided by area -- what
                  the front desk actually gets asked: "за сколько ушёл метр". */}
              {formatCurrency(
                Math.round((contractInfo ? contractInfo.amount : (unit.price ?? 0)) / unit.area),
                contractInfo ? contractInfo.currency : unit.currency
              )}
            </span>
          </div>
        )}

        {contractInfo && (
          <div className="border-t border-[var(--border-c2)] px-3.5 py-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-5)]">
                {t.buildings.hover.paid}
              </span>
              <span className="text-[13px] font-bold text-emerald-600">
                {formatCurrency(contractInfo.paid, contractInfo.currency)}
              </span>
            </div>
            {contractInfo.amount > 0 && (
              <>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--track-c)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                    style={{
                      width: `${Math.min(100, Math.round((contractInfo.paid / contractInfo.amount) * 100))}%`,
                    }}
                  />
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-[10px] text-[var(--ink-5)]">
                    {Math.min(100, Math.round((contractInfo.paid / contractInfo.amount) * 100))}%
                  </span>
                  {contractInfo.remaining > 0 && (
                    <span className="text-[11px] font-semibold text-rose-600">
                      −{formatCurrency(contractInfo.remaining, contractInfo.currency)}
                    </span>
                  )}
                </div>
              </>
            )}
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-5)]">
                {t.buildings.hover.owner}
              </span>
              <span className="truncate font-semibold text-[var(--ink-2)]">
                {contractInfo.clientName}
              </span>
            </div>
            {contractInfo.clientPhone && (
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-5)]">
                  {t.buildings.hover.phone}
                </span>
                <span className="text-[var(--ink-2)]">{contractInfo.clientPhone}</span>
              </div>
            )}
          </div>
        )}

        {!contractInfo && unit.manual_reserved && (
          <div className="border-t border-[var(--border-c2)] px-3.5 py-1.5">
            <p className="flex justify-between text-[var(--ink-4)]">
              <span>{t.buildings.hover.owner}</span>
              <span className="text-[var(--ink-2)]">{t.buildings.hover.reservedNoClient}</span>
            </p>
          </div>
        )}

        {!readOnly && (
          <p className="border-t border-[var(--border-c2)] bg-[var(--surface-2)] px-3.5 py-1.5 text-center text-[10px] text-[var(--ink-5)]">
            {unit.status === "available"
              ? t.buildings.hover.clickHint
              : contractInfo
                ? contractInfo.isQuickBooking
                  ? t.buildings.hover.clickHintQuickBooked
                  : t.buildings.hover.clickHintBooked
                : unit.manual_reserved
                  ? t.buildings.hover.clickHintQuickBooked
                  : t.buildings.hover.clickHint}
          </p>
        )}
      </div>
    </div>
  );
}

export function ShakhmatkaGrid({
  units,
  contractsByUnit,
  onBookUnit,
  onQuickBook,
  onCancelQuickBook,
  onAddUnit,
  pendingUnitIds,
  onMergeUnits,
  onSplitUnit,
  onDeleteUnit,
  canEditSold,
  readOnly = false,
  onViewUnit,
  statusFilter,
  roomsFilter,
  gapFilter = null,
  editMode = false,
}: {
  units: PropertyObject[];
  contractsByUnit: Record<string, UnitContractInfo>;
  onBookUnit: (unit: PropertyObject) => void;
  onQuickBook: (unit: PropertyObject) => void;
  onCancelQuickBook: (unit: PropertyObject, contractId: string) => void;
  onAddUnit: (floor: number, block: string, position: number) => void;
  pendingUnitIds: Set<string>;
  onMergeUnits: (unitA: PropertyObject, unitB: PropertyObject) => void;
  onSplitUnit: (unit: PropertyObject) => void;
  onDeleteUnit: (unit: PropertyObject) => void;
  canEditSold: boolean;
  readOnly?: boolean;
  onViewUnit: (unit: PropertyObject) => void;
  statusFilter: ObjectStatus | null;
  roomsFilter: number | null;
  gapFilter?: GapFilter;
  editMode?: boolean;
}) {
  const { t } = useLocale();

  if (units.length === 0) {
    return <p className="text-[var(--ink-5)]">{t.buildings.noUnits}</p>;
  }

  // Split the main residential grid from everything else. The main grid's
  // blocks, floors and column widths are computed from residential units ONLY,
  // so parking/shops never widen or space out the apartment shakhmatka.
  const residentialUnits = units.filter(isResidential);
  const otherUnits = units.filter((u) => !isResidential(u));

  // Numbering still runs over ALL units, so per-type sequences (П1, М1…) stay
  // consistent whether a unit is shown in the main grid or the section below.
  const apartmentNumbers = computeApartmentNumbers(units);

  // Blocks/entrances ordered left→right by when they were first created, so
  // the first entrance you made sits leftmost and each new one appears to its
  // right -- the way a real shakhmatka grows -- instead of an alphabetical
  // order that reshuffles them.
  const gridUnits = residentialUnits.length > 0 ? residentialUnits : units;
  const blockFirstCreated = new Map<string, string>();
  for (const u of gridUnits) {
    const b = u.block ?? "";
    const ts = u.created_at ?? "";
    const seen = blockFirstCreated.get(b);
    if (seen === undefined || ts < seen) blockFirstCreated.set(b, ts);
  }
  const blocks = Array.from(blockFirstCreated.keys()).sort((a, b) =>
    (blockFirstCreated.get(a) ?? "").localeCompare(blockFirstCreated.get(b) ?? "")
  );
  const hasBlocks = blocks.length > 1 || blocks[0] !== "";
  const floors = Array.from(new Set(gridUnits.map((u) => u.floor ?? 0))).sort((a, b) => b - a);

  // Widest floor of each block, measured by how many units it actually has
  // (not by stored position values). This is what pins the block's column
  // width. Measuring by position let a stray high-position unit -- left by a
  // construction glitch -- reserve a huge empty column and shove the next
  // entrance far to the right.
  const maxUnitsByBlock = new Map<string, number>();
  for (const block of blocks) {
    const perFloor = new Map<number, number>();
    for (const u of gridUnits) {
      if ((u.block ?? "") !== block) continue;
      const f = u.floor ?? 0;
      perFloor.set(f, (perFloor.get(f) ?? 0) + (u.span || 1));
    }
    maxUnitsByBlock.set(block, Math.max(0, ...perFloor.values()));
  }

  type Slot = { kind: "unit"; unit: PropertyObject } | { kind: "ghost"; position: number };
  function floorSlots(block: string, floor: number, cellUnits: PropertyObject[]): Slot[] {
    // Pack the floor's units left-to-right in order, ignoring gaps in their
    // stored positions -- so a floor always shows exactly as many cells as it
    // has units, side by side, with no confusing empty holes. One trailing
    // "+" add-slot (unless read-only) lets you append a unit.
    const sorted = [...cellUnits].sort(
      (a, b) => (a.position_in_floor ?? 0) - (b.position_in_floor ?? 0)
    );
    const slots: Slot[] = sorted.map((unit) => ({ kind: "unit" as const, unit }));
    if (!readOnly) {
      const last = sorted[sorted.length - 1];
      const nextPos = last ? (last.position_in_floor ?? sorted.length) + 1 : 1;
      slots.push({ kind: "ghost", position: nextPos });
    }
    return slots;
  }

  // Pin every block's column to its widest floor (units + a trailing add-slot)
  // so entrances line up cleanly and sit right next to each other.
  const blockWidths = new Map<string, number>();
  for (const block of blocks) {
    const slotCount = (maxUnitsByBlock.get(block) ?? 0) + (readOnly ? 0 : 1);
    blockWidths.set(block, slotCount * CELL + Math.max(0, slotCount - 1) * GAP);
  }

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4">

      {/* Blocks/entrances sit side by side as columns sharing the same floor
          rows, rather than stacked one under another -- lets you compare
          entrances at a glance the way a real shakhmatka is read. */}
      {/* ONE scrollbar on this page, the page's own.
          `overflow-x-auto` alone is not "horizontal only": CSS makes the other
          axis compute to `auto` as soon as one axis is not `visible`, so this
          box was also a vertical scroll container, and anything poking out of
          it -- a hover card opening downward from the bottom row -- gave it
          its own vertical scrollbar right next to the page's. Pinning
          overflow-y to hidden keeps the horizontal scrolling the grid needs
          and removes the second bar for good.
          Used to also carry a permanent pb-72 (288px) here so a bottom-row
          hover card always had room to open into -- but that meant 288px of
          plain empty space under the grid at all times, hover or not, which
          read as a big broken gap especially on a shorter tablet screen.
          Now the last few rows flip their card upward instead (see
          `openUpward` on UnitCell), so every downward-opening card always
          has real rows below it to render over, and this padding only needs
          to cover ordinary breathing room, not a worst-case card height. */}
      <div className="overflow-x-auto overflow-y-hidden">
        <div className="flex w-fit flex-col gap-2 pb-2">
          {hasBlocks && (
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0" />
              <div className="flex gap-4">
                {blocks.map((block) => (
                  <p
                    key={block}
                    style={{ width: blockWidths.get(block) }}
                    className="shrink-0 text-sm font-semibold text-[var(--ink-2)]"
                  >
                    {block || t.buildings.noBlock}
                  </p>
                ))}
              </div>
            </div>
          )}

          {floors.map((floor, floorIndex) => {
            // The hover card is up to ~260px tall (roughly 4 rows) -- any
            // row with fewer than 4 rows left below it flips its card
            // upward instead, so it always has somewhere to render into.
            const openUpward = floorIndex >= floors.length - 4;
            return (
            <div key={floor} className="flex items-center gap-3">
              <span className="w-16 shrink-0 text-xs font-medium text-[var(--ink-4)]">
                {t.buildings.floorLabel} {floor}
              </span>
              <div className="flex gap-4">
                {blocks.map((block) => {
                  const cellUnits = gridUnits
                    .filter((u) => (u.block ?? "") === block && (u.floor ?? 0) === floor)
                    .sort((a, b) => (a.position_in_floor ?? 0) - (b.position_in_floor ?? 0));
                  const slots = floorSlots(block, floor, cellUnits);
                  return (
                    <div
                      key={block}
                      style={{ width: blockWidths.get(block) }}
                      className="flex shrink-0 flex-nowrap gap-2"
                    >
                      {slots.map((slot) =>
                        slot.kind === "unit" ? (
                          <UnitCell
                            key={slot.unit.id}
                            unit={slot.unit}
                            apartmentNumber={apartmentNumbers.get(slot.unit.id)}
                            floorUnits={cellUnits}
                            contractInfo={contractsByUnit[slot.unit.id]}
                            onBookUnit={onBookUnit}
                            onQuickBook={onQuickBook}
                            onCancelQuickBook={onCancelQuickBook}
                            isPending={pendingUnitIds.has(slot.unit.id)}
                            onMergeUnits={onMergeUnits}
                            onSplitUnit={onSplitUnit}
                            onDeleteUnit={onDeleteUnit}
                            canEditSold={canEditSold}
                            readOnly={readOnly}
                            onViewUnit={onViewUnit}
                            statusFilter={statusFilter}
                            roomsFilter={roomsFilter}
                            gapFilter={gapFilter}
                            editMode={editMode}
                            openUpward={openUpward}
                          />
                        ) : canEditSold ? (
                          <button
                            key={`ghost-${block}-${floor}-${slot.position}`}
                            type="button"
                            title={t.buildings.addUnitHere}
                            onClick={() => onAddUnit(floor, block, slot.position)}
                            className="flex h-14 w-16 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-[var(--border-c)] text-[var(--ink-5)] transition-all hover:border-slate-400 hover:bg-[var(--surface-2)] hover:text-[var(--ink-4)] active:scale-95"
                          >
                            +
                          </button>
                        ) : (
                          <div
                            key={`ghost-${block}-${floor}-${slot.position}`}
                            className="h-14 w-16 shrink-0 rounded-md border-2 border-dashed border-[var(--border-c2)]"
                          />
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Non-residential units (shops, offices, parking, land, construction)
          live in their own section so they never stretch or space out the main
          apartment shakhmatka above. Each type wraps freely, so a basement of
          40 parking bays just flows onto more rows instead of widening a
          column. */}
      {otherUnits.length > 0 && (
        <div className="flex flex-col gap-4 border-t border-[var(--border-c)] pt-4">
          {NON_RES_ORDER.map((type) => {
            const group = otherUnits
              .filter((u) => (u.type ?? "apartment") === type)
              .sort((a, b) => {
                const bc = (a.block ?? "").localeCompare(b.block ?? "");
                if (bc !== 0) return bc;
                const fa = a.floor ?? 0;
                const fb = b.floor ?? 0;
                if (fa !== fb) return fa - fb;
                return (a.position_in_floor ?? 0) - (b.position_in_floor ?? 0);
              });
            if (group.length === 0) return null;
            const meta = TYPE_META[type];
            // Split each type by block/entrance so two blocks' commercial
            // units don't run together into one row with restarting numbers
            // (М1…М26, then М1… again). Each block gets its own labelled grid.
            const blockCreated = new Map<string, string>();
            for (const u of group) {
              const b = u.block ?? "";
              const ts = u.created_at ?? "";
              const seen = blockCreated.get(b);
              if (seen === undefined || ts < seen) blockCreated.set(b, ts);
            }
            const typeBlocks = [...blockCreated.keys()].sort((a, b) =>
              (blockCreated.get(a) ?? "").localeCompare(blockCreated.get(b) ?? "")
            );
            return (
              <div key={type} className="flex flex-col gap-2.5">
                <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-2)]">
                  {meta && (
                    <span
                      className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] ${meta.ring} ring-offset-1`}
                    >
                      {meta.prefix}
                    </span>
                  )}
                  {t.objects.types[type as keyof typeof t.objects.types] ?? type}
                  <span className="text-xs font-normal text-[var(--ink-5)]">
                    ({group.length})
                  </span>
                </p>
                {typeBlocks.map((block) => {
                  const cells = group.filter((u) => (u.block ?? "") === block);
                  return (
                    <div key={block} className="flex flex-col gap-1.5">
                      {block && (
                        <p className="text-xs font-medium text-[var(--ink-4)]">
                          {block} <span className="text-[var(--ink-5)]">({cells.length})</span>
                        </p>
                      )}
                      {/* A real grid (fixed CELL-wide columns) so the cells line
                          up tidily; a merged (span>1) cell spans that many
                          columns and still aligns. */}
                      <div
                        className="grid justify-start gap-2"
                        style={{ gridTemplateColumns: `repeat(auto-fill, ${CELL}px)` }}
                      >
                        {cells.map((unit) => (
                          <div
                            key={unit.id}
                            style={{ gridColumn: `span ${unit.span || 1}` }}
                          >
                            <UnitCell
                              unit={unit}
                              apartmentNumber={apartmentNumbers.get(unit.id)}
                              floorUnits={cells}
                              contractInfo={contractsByUnit[unit.id]}
                              onBookUnit={onBookUnit}
                              onQuickBook={onQuickBook}
                              onCancelQuickBook={onCancelQuickBook}
                              isPending={pendingUnitIds.has(unit.id)}
                              onMergeUnits={onMergeUnits}
                              onSplitUnit={onSplitUnit}
                              onDeleteUnit={onDeleteUnit}
                              canEditSold={canEditSold}
                              readOnly={readOnly}
                              onViewUnit={onViewUnit}
                              statusFilter={statusFilter}
                              roomsFilter={roomsFilter}
                              gapFilter={gapFilter}
                              editMode={editMode}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* What the bar and the tick on a cell mean. This is a reading key, not
          a control, and it used to sit in the filter row -- which made that
          row long enough to read as a wall of chips and buried the two actual
          filters in it. It belongs under the grid: you look it up after
          seeing a cell you don't recognise, not before. */}
      <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--ink-5)]">
        <span className="flex items-center gap-1.5">
          {/* Shown in the "продано" hue: that is the status people are
              actually chasing a balance on, and the bar takes its colour
              from the cell it sits in. */}
          <span
            className={`flex h-2.5 w-6 overflow-hidden rounded-sm ${STATUS_PROGRESS_COLORS.sold.track}`}
          >
            <span className={`h-full w-3/5 ${STATUS_PROGRESS_COLORS.sold.fill}`} />
          </span>
          {t.buildings.hover.partlyPaid}
        </span>
        <span className="flex items-center gap-1.5">
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3 text-emerald-600"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12.5l5.5 5.5L20 6.5" />
          </svg>
          {t.buildings.hover.fullyPaid}
        </span>
      </div>
    </div>
  );
}

// The filter bar, lifted out of the grid so it can sit on the page header
// line beside the icon toolbar instead of on a row of its own.
//
// Everything here is one bordered group with internal dividers, the same
// primitive the icon toolbar uses. Before, the statuses were separate loose
// pills, the rooms were a second bordered box with a text label in front of
// it, and the payment key was a third cluster after that -- three unrelated
// shapes strung across the full width. Glued, at the toolbar's own size, it
// reads as one control and takes roughly half the room.
export function ShakhmatkaFilters({
  units,
  statusFilter,
  onStatusChange,
  roomsFilter,
  onRoomsChange,
  gapFilter,
  onGapChange,
}: {
  units: PropertyObject[];
  statusFilter: ObjectStatus | null;
  onStatusChange: (next: ObjectStatus | null) => void;
  roomsFilter: number | null;
  onRoomsChange: (next: number | null) => void;
  gapFilter: GapFilter;
  onGapChange: (next: GapFilter) => void;
}) {
  const { t } = useLocale();

  // The three statuses core to selling are always offered, so it never looks
  // like "sold" quietly disappeared just because nothing has that status yet.
  // The two rarer ones appear only when actually used.
  const CORE_STATUSES: ObjectStatus[] = ["available", "reserved", "sold"];
  const presentStatuses = (
    Object.keys(t.buildings.legend) as Array<keyof typeof t.buildings.legend>
  ).filter(
    (status) => CORE_STATUSES.includes(status) || units.some((u) => u.status === status)
  );

  // Room counts come from the units of THIS building, not a fixed 1/2/3 list.
  const roomCounts = new Map<number, number>();
  for (const u of units) {
    if (u.rooms == null) continue;
    roomCounts.set(u.rooms, (roomCounts.get(u.rooms) ?? 0) + 1);
  }
  const presentRooms = Array.from(roomCounts.keys()).sort((a, b) => a - b);

  // The dashboard says "N без цены — в сумму не вошли" and there was nowhere
  // to go and look at them. These two pills appear only when such flats exist,
  // and they separate the two very different reasons: no price is fixable by
  // re-saving the building's rate, no area is not -- someone has to type the
  // area first, because the price is computed from it.
  const noPriceCount = units.filter((u) => hasGap(u, "no_price")).length;
  const noAreaCount = units.filter((u) => hasGap(u, "no_area")).length;

  const anyActive = statusFilter !== null || roomsFilter !== null || gapFilter !== null;

  return (
    <ControlGroup size="sm" scrollable>
      {presentStatuses.map((status) => {
        const active = statusFilter === status;
        return (
          <PillButton
            key={status}
            active={active}
            onClick={() => onStatusChange(active ? null : status)}
            label={
              <span className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    // On the brand fill the green "available" dot all but
                    // vanishes on the emerald theme; a hairline ring keeps
                    // every dot legible whatever colour sits behind it.
                    active ? "ring-1 ring-[var(--on-brand)]/80" : ""
                  }`}
                  style={{ background: STATUS_HUES[status].solid }}
                />
                {t.buildings.legend[status]}
              </span>
            }
          />
        );
      })}

      {presentRooms.length > 0 && (
        <>
          <GroupDivider />
          {presentRooms.map((rooms) => {
            const active = roomsFilter === rooms;
            return (
              <PillButton
                key={rooms}
                active={active}
                onClick={() => onRoomsChange(active ? null : rooms)}
                title={t.buildings.roomsFilter}
                label={
                  <span className="flex items-center gap-1">
                    {rooms} {t.buildings.roomsFilterShort}
                    <span className={active ? "text-[var(--on-brand)]/70" : "text-[var(--ink-5)]"}>
                      {roomCounts.get(rooms)}
                    </span>
                  </span>
                }
              />
            );
          })}
        </>
      )}

      {(noPriceCount > 0 || noAreaCount > 0) && (
        <>
          <GroupDivider />
          {noPriceCount > 0 && (
            <PillButton
              active={gapFilter === "no_price"}
              onClick={() => onGapChange(gapFilter === "no_price" ? null : "no_price")}
              title={t.buildings.noPriceFilterHint}
              label={
                <span className="flex items-center gap-1">
                  {t.buildings.noPriceFilter}
                  <span className={gapFilter === "no_price" ? "text-[var(--on-brand)]/70" : "text-[var(--ink-5)]"}>
                    {noPriceCount}
                  </span>
                </span>
              }
            />
          )}
          {noAreaCount > 0 && (
            <PillButton
              active={gapFilter === "no_area"}
              onClick={() => onGapChange(gapFilter === "no_area" ? null : "no_area")}
              title={t.buildings.noAreaFilterHint}
              label={
                <span className="flex items-center gap-1">
                  {t.buildings.noAreaFilter}
                  <span className={gapFilter === "no_area" ? "text-[var(--on-brand)]/70" : "text-[var(--ink-5)]"}>
                    {noAreaCount}
                  </span>
                </span>
              }
            />
          )}
        </>
      )}

      {anyActive && (
        <>
          <GroupDivider />
          <PillButton
            label="×"
            title={t.buildings.clearFilter}
            onClick={() => {
              onStatusChange(null);
              onRoomsChange(null);
              onGapChange(null);
            }}
          />
        </>
      )}
    </ControlGroup>
  );
}
