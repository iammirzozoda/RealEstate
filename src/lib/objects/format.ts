import type { ObjectStatus } from "./types";

// Built once -- this runs per cell of the shakhmatka; see the note in
// lib/currency.ts.
const areaFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

export function formatArea(area: number | null) {
  if (area === null) return "—";
  // Round to at most 2 decimals and group thousands, so a stored 55.2999999
  // reads "55.3 м²" instead of a long tail of digits.
  return `${areaFormat.format(area)} м²`;
}

export const STATUS_COLORS: Record<ObjectStatus, string> = {
  available: "bg-[var(--wash-emerald)] text-[var(--wash-emerald-ink)]",
  reserved: "bg-[var(--wash-amber)] text-[var(--wash-amber-ink)]",
  sold: "bg-[var(--wash-rose)] text-[var(--wash-rose-ink)]",
  rented: "bg-[var(--wash-sky)] text-[var(--wash-sky-ink)]",
  in_progress: "bg-[var(--wash-violet)] text-[var(--wash-violet-ink)]",
};

// Same idea as STATUS_COLORS, for the shakhmatka's own big filled tiles
// rather than a small status badge/pill. Same text colour (already legible
// against dark), a brighter background (--cell-*, globals.css): a badge's
// low-alpha tint reads fine as a small chip, but blown up to a whole cell
// in dark mode it read as a dim, murky green/maroon rather than the light
// pastel a light-mode cell shows.
export const CELL_COLORS: Record<ObjectStatus, string> = {
  available: "bg-[var(--cell-emerald)] text-[var(--wash-emerald-ink)]",
  reserved: "bg-[var(--cell-amber)] text-[var(--wash-amber-ink)]",
  sold: "bg-[var(--cell-rose)] text-[var(--wash-rose-ink)]",
  rented: "bg-[var(--cell-sky)] text-[var(--wash-sky-ink)]",
  in_progress: "bg-[var(--cell-violet)] text-[var(--wash-violet-ink)]",
};

// The payment bar drawn along the bottom of a shakhmatka cell, in that cell's
// OWN hue -- same colour, just stronger. A single green fill sitting on a rose
// "продано" cell read as a second, unrelated colour system laid over the
// status colours; this way the bar looks like more of the cell.
//
// Kept next to STATUS_COLORS on purpose: the two must move together, and a
// hue added to one and forgotten in the other is exactly how a status ends up
// with a bar that clashes with its own background.
export const STATUS_PROGRESS_COLORS: Record<ObjectStatus, { track: string; fill: string }> = {
  available: { track: "bg-[var(--wash-emerald)]", fill: "bg-[var(--wash-emerald-ink)]" },
  reserved: { track: "bg-[var(--wash-amber)]", fill: "bg-[var(--wash-amber-ink)]" },
  sold: { track: "bg-[var(--wash-rose)]", fill: "bg-[var(--wash-rose-ink)]" },
  rented: { track: "bg-[var(--wash-sky)]", fill: "bg-[var(--wash-sky-ink)]" },
  in_progress: { track: "bg-[var(--wash-violet)]", fill: "bg-[var(--wash-violet-ink)]" },
};

// How a unit is named to a person, as opposed to how it is stored.
//
// The stored name is "Даромадгоҳи 1 №6-4" -- entrance, then floor and the
// unit's position on that floor, run together with a hyphen. It is compact and
// unambiguous to whoever built the grid, and unreadable to everyone else: the
// "6-4" looks like a single code, and the flat number a buyer actually knows
// theirs by (34) is nowhere in it.
//
// The word patterns come from the dictionary because the two languages put
// them in opposite order -- "6 этаж" against "ошёнаи 6" -- so this can't be
// assembled from a number and a noun in fixed positions.
export function unitLabel(
  unit: {
    name?: string | null;
    block?: string | null;
    floor?: number | null;
    position_in_floor?: number | null;
  },
  apartmentNumber: number | undefined,
  words: { unitFloor: string; unitApartment: string }
): string {
  const parts: string[] = [];
  if (unit.block) parts.push(unit.block);
  if (unit.floor != null) parts.push(words.unitFloor.replace("{n}", String(unit.floor)));
  // The flat number is derived from the building's grid, so a caller that
  // hasn't loaded the grid has nothing to show. Falling back to the position
  // on the floor would be worse than saying nothing: it looks like a flat
  // number and isn't one.
  if (apartmentNumber != null) {
    parts.push(words.unitApartment.replace("{n}", String(apartmentNumber)));
  }
  // Nothing structured to say -- a free-standing house, or a unit saved before
  // the grid fields existed. Its own name is still better than an empty line.
  if (parts.length === 0) return unit.name?.trim() || "—";
  return parts.join(", ");
}
