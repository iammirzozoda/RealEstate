"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Building } from "@/lib/buildings/types";
import { MoneyPairValue, type MoneyPair } from "@/components/MoneyPairValue";
import { CountUp } from "@/components/CountUp";
import { useCountUp } from "@/lib/useCountUp";

type PeriodFilter = "all" | "today" | "month" | "year";

// Borderless now: the two selects sit inside one shared bordered group (see
// below), so each carrying its own outline would draw a box inside a box.
const GLASS_SELECT =
  "h-8 rounded-md border-0 bg-transparent px-2.5 text-xs font-medium text-white transition-colors hover:bg-white/15 focus:outline-none focus:ring-2 focus:ring-white/40";

// The dashboard's one bold move: a sales-progress hero (the single figure
// that answers "how is the portfolio doing" faster than four separate
// boxes), on an indigo-to-saffron gradient with a faint mountain skyline --
// a nod to the Pamirs rather than a generic SaaS blob-gradient. Everything
// else on the page stays on the quiet slate system; the boldness lives here
// and nowhere else.
export function DashboardHero({
  t,
  loading,
  brandName,
  totalUnits,
  availableCount,
  reservedCount,
  soldCount,
  paidRevenue,
  buildings,
  selectedBuildingId,
  onBuildingChange,
  periodFilter,
  onPeriodChange,
}: {
  t: Dictionary;
  loading: boolean;
  brandName: string;
  totalUnits: number;
  availableCount: number;
  reservedCount: number;
  soldCount: number;
  paidRevenue: MoneyPair;
  buildings: Building[];
  selectedBuildingId: string;
  onBuildingChange: (id: string) => void;
  periodFilter: PeriodFilter;
  onPeriodChange: (period: PeriodFilter) => void;
}) {
  const hasUnits = totalUnits > 0;

  // The headline number counts up to its value instead of appearing -- an
  // eased ~0.9s run, re-triggered when the figure itself changes (filters,
  // fresh data). rAF-driven, cancelled on unmount.
  const displaySold = Math.round(useCountUp(soldCount, !loading));

  // Bars fill from zero on mount so the existing width transition has
  // something to animate on first paint, not only on filter changes.
  const [barsLive, setBarsLive] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBarsLive(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const soldPct = hasUnits && barsLive ? (soldCount / totalUnits) * 100 : 0;
  const reservedPct = hasUnits && barsLive ? (reservedCount / totalUnits) * 100 : 0;
  const stats = [
    { label: t.dashboard.totalObjects, value: totalUnits },
    { label: t.dashboard.available, value: availableCount },
    { label: t.dashboard.reserved, value: reservedCount },
    { label: t.dashboard.sold, value: soldCount },
  ];

  return (
    <div className="hero-gradient hero-surface hero-panel relative overflow-hidden rounded-2xl px-6 py-8 text-white shadow-lg shadow-slate-900/10 sm:px-10 sm:py-10">
      {/* Mountain skyline signature, low-opacity so it stays atmosphere, not decoration. */}
      <svg
        viewBox="0 0 1000 200"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-28 w-full text-white/10 sm:h-36"
      >
        <path
          fill="currentColor"
          d="M0,160 L110,90 L200,140 L320,55 L430,120 L540,40 L650,110 L760,70 L860,130 L1000,85 L1000,200 L0,200 Z"
        />
      </svg>
      {/* A slow-drifting glow behind the headline number -- the one place
          this page moves on its own, so the hero reads as alive even before
          you touch anything. */}
      <div
        aria-hidden="true"
        className="animate-hero-glow pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-300/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="animate-hero-glow-2 pointer-events-none absolute -right-20 bottom-0 h-64 w-64 rounded-full bg-fuchsia-400/15 blur-3xl"
      />

      <div className="relative flex flex-col gap-7">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <h1 className="text-lg font-semibold tracking-tight sm:text-xl">{brandName}</h1>
          {/* Building and period are ONE control, not two glass pills with a
              gap. Same rule as every other filter row in the app -- kept on
              the hero's own translucent surface rather than a white group. */}
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-white/25 bg-white/10 p-1 backdrop-blur-sm">
            <select
              value={selectedBuildingId}
              onChange={(e) => onBuildingChange(e.target.value)}
              className={GLASS_SELECT}
            >
              <option style={{ color: "#0f172a" }} value="all">
                {t.dashboard.allBuildings}
              </option>
              {buildings.map((b) => (
                <option style={{ color: "#0f172a" }} key={b.id} value={b.id}>
                  {b.name}
                  {b.construction_status === "completed" ? ` · ${t.dashboard.completedSuffix}` : ""}
                </option>
              ))}
            </select>
            <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-white/25" />
            <select
              value={periodFilter}
              onChange={(e) => onPeriodChange(e.target.value as PeriodFilter)}
              className={GLASS_SELECT}
            >
              <option style={{ color: "#0f172a" }} value="all">
                {t.dashboard.periodAll}
              </option>
              <option style={{ color: "#0f172a" }} value="today">
                {t.dashboard.periodToday}
              </option>
              <option style={{ color: "#0f172a" }} value="month">
                {t.dashboard.periodMonth}
              </option>
              <option style={{ color: "#0f172a" }} value="year">
                {t.dashboard.periodYear}
              </option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="animate-fade-up flex w-full max-w-md flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-amber-100/80">
              {t.dashboard.hero.salesProgress}
            </span>
            {/* "Sold X of Y" reads instantly; a bare percentage was the
                single most-asked "what does this number mean" on this page.
                The bar repeats it visually: saffron = sold, white =
                reserved, the dim track = still available. */}
            {loading || !hasUnits ? (
              <span className="text-6xl font-bold tabular-nums sm:text-7xl">—</span>
            ) : (
              <>
                <div className="flex items-baseline gap-2.5">
                  <span className="text-6xl font-bold tabular-nums sm:text-7xl">
                    {displaySold}
                  </span>
                  <span className="text-2xl font-semibold text-white/60">
                    / {totalUnits}
                  </span>
                </div>
                <div className="mt-1 flex h-2.5 w-full overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full rounded-l-full bg-amber-300 transition-[width] duration-1000 ease-out"
                    style={{ width: `${soldPct}%` }}
                  />
                  <div
                    className="h-full bg-white/50 transition-[width] duration-1000 ease-out"
                    style={{ width: `${reservedPct}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-white/80">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-300" />
                    {t.dashboard.sold}: {soldCount}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-white/50" />
                    {t.dashboard.reserved}: {reservedCount}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-white/20" />
                    {t.dashboard.available}: {availableCount}
                  </span>
                </div>
              </>
            )}
            {!loading && !hasUnits && (
              <p className="max-w-xs text-sm leading-tight text-white/70">
                {t.dashboard.hero.noUnitsYet}
              </p>
            )}
          </div>

          <div
            className="animate-fade-up flex flex-wrap items-center gap-3"
            style={{ animationDelay: "80ms" }}
          >
            <div className="rounded-xl bg-white/10 px-4 py-3 backdrop-blur-sm">
              <p className="text-[11px] uppercase tracking-wide text-white/60">
                {t.dashboard.paidRevenue}
              </p>
              <div className="mt-1 text-2xl">
                {loading ? "…" : <MoneyPairValue value={paidRevenue} animate />}
              </div>
            </div>
            <Link
              href="/buildings"
              className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-900 shadow-sm transition-all hover:shadow-md active:scale-[0.97]"
            >
              {t.dashboard.hero.cta} →
            </Link>
          </div>
        </div>

        {!loading && (
          <div className="animate-fade-up grid grid-cols-2 gap-3 sm:grid-cols-4" style={{ animationDelay: "140ms" }}>
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className="animate-fade-up rounded-xl border border-white/10 bg-white/[0.07] px-4 py-3 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-white/[0.12]"
                style={{ animationDelay: `${180 + i * 40}ms` }}
              >
                <p className="text-3xl font-bold tabular-nums sm:text-4xl">
                  <CountUp value={stat.value} enabled={!loading} />
                </p>
                <p className="mt-0.5 text-xs text-white/60">{stat.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
