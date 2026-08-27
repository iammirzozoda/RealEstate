"use client";

import { useState } from "react";
import Link from "next/link";
import { compactNumber, hueAt, type ChartHue } from "./palette";

export type HBarDatum = {
  label: string;
  value: number;
  hue?: ChartHue;
  hint?: string;
  /** Optional -- when set, the whole row is a link (e.g. a debtor's client
      page), and the label picks up the same hover colour every other link
      on the dashboard uses instead of a bare underline. */
  href?: string;
  /** Optional reference value >= `value` (e.g. the whole remaining balance
      behind an overdue amount). When set, the row draws two layers: a
      track sized to `total` relative to the other rows' totals, with
      `value` filled in as a fraction OF that track -- so both "how big is
      this row's total exposure" and "how much of it is already overdue"
      read at once, instead of just ranking bare `value`s against each
      other with no sense of what each is a share of. Omit it and a row
      behaves exactly as before: one bar, sized by `value` alone. */
  total?: number;
};

// Horizontal bars, sorted longest first.
//
// Chosen over vertical columns wherever the categories are NAMES rather than
// dates: "Кайҳонавадон 36 Б" under a 40px column either truncates or wraps into
// the neighbour, while beside a horizontal bar it has the whole card width. It
// is also the natural shape for a ranking, which is what "who owes most" is.
//
// Hovering a bar lifts it and dims the rest, so the row being read is never
// competing with the others for attention.
export function HBarChart({
  data,
  formatValue = compactNumber,
}: {
  data: HBarDatum[];
  formatValue?: (n: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // The reference each row's TRACK is sized against -- `total` when a row
  // carries one, otherwise its own `value` (which is what made every row a
  // full-width track before `total` existed, so a chart that never passes
  // it renders pixel-identical to the old single-bar version).
  const max = Math.max(...data.map((d) => d.total ?? d.value), 0);

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((d, i) => {
        const hue = d.hue ?? hueAt(i);
        const reference = d.total ?? d.value;
        // Track length: this row's reference against the biggest reference
        // in the set, so rows are ranked by `total` (whole exposure) when
        // one is given, by `value` otherwise.
        const trackFrac = max > 0 ? reference / max : 0;
        // Fill within the track: what fraction of THIS row's own reference
        // `value` actually is. With no `total`, reference === value, so this
        // is always 1 -- the track is entirely filled, same as before.
        const fillFrac = reference > 0 ? d.value / reference : 0;
        const dim = hover !== null && hover !== i;
        return (
          <li
            key={`${d.label}-${i}`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            className="flex flex-col gap-1 transition-opacity"
            style={{ opacity: dim ? 0.4 : 1 }}
          >
            <div className="flex items-baseline justify-between gap-3 text-sm">
              {d.href ? (
                <Link
                  href={d.href}
                  className="-mx-1 min-w-0 truncate rounded px-1 text-[var(--ink-2)] transition-colors hover:bg-brand-soft hover:text-brand"
                  title={d.label}
                >
                  {d.label}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-[var(--ink-2)]" title={d.label}>
                  {d.label}
                </span>
              )}
              <span className="shrink-0 font-semibold tabular-nums text-[var(--ink-1)]">
                {formatValue(d.value)}
                {d.total != null && (
                  <span className="ml-1 font-normal text-[var(--ink-5)]">
                    / {formatValue(d.total)}
                  </span>
                )}
              </span>
            </div>
            {/* Scaling the OUTER row (not just the fill) means a row with a
                small total exposure gets a physically short track, not a
                full-width one with a short fill lost inside it -- the two
                things being compared (exposure between rows, overdue share
                within one row) each get their own dimension instead of
                fighting for the same one. */}
            <div
              className="h-2.5 w-full overflow-hidden transition-transform duration-200"
              style={{ transform: hover === i ? "scaleY(1.4)" : undefined }}
            >
              <div
                className="animate-chart-grow-x h-full overflow-hidden rounded-full bg-[var(--track-c)]"
                style={{
                  width: `${trackFrac * 100}%`,
                  minWidth: reference > 0 ? 6 : 0,
                  animationDelay: `${i * 60}ms`,
                }}
              >
                <div
                  className="h-full rounded-full transition-[filter]"
                  style={{
                    width: `${fillFrac * 100}%`,
                    background: `linear-gradient(90deg, ${hue.from}, ${hue.to})`,
                    boxShadow: hover === i ? `0 2px 10px ${hue.solid}66` : undefined,
                    filter: hover === i ? "brightness(1.08)" : undefined,
                  }}
                />
              </div>
            </div>
            {d.hint && <span className="text-[11px] text-[var(--ink-5)]">{d.hint}</span>}
          </li>
        );
      })}
    </ul>
  );
}
