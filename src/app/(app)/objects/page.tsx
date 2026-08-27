"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { SetupNotice } from "@/components/SetupNotice";
import { ControlGroup, GroupDivider } from "@/components/ActionBar";
import { AddMenu } from "@/components/AddMenu";
import { useRole } from "@/lib/auth/useRole";
import { Pagination } from "@/components/Pagination";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { STATUS_COLORS, formatArea } from "@/lib/objects/format";
import { formatCurrency } from "@/lib/currency";
import {
  OBJECT_STATUSES,
  OBJECT_TYPES,
  type ObjectStatus,
  type ObjectType,
  type PropertyObject,
} from "@/lib/objects/types";
import type { Building } from "@/lib/buildings/types";

const PAGE_SIZE = 25;

export default function ObjectsPage() {
  const { t } = useLocale();
  const configured = isSupabaseConfigured();
  const { role } = useRole();

  const [objects, setObjects] = useState<PropertyObject[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [buildings, setBuildings] = useState<Building[]>([]);
  // Per-building roll-up of its child units: how many are still available and
  // the total free area, so the list can show a live "В продаже" status and
  // the remaining square metres instead of a dash.
  const [buildingStats, setBuildingStats] = useState<
    Record<string, { available: number; availableArea: number; total: number }>
  >({});
  // "Loading" is derived, not stored. It is exactly "the data on screen does
  // not belong to the parameters currently set", so it is a comparison, not a
  // flag raised before a fetch and lowered after -- and raising it inside the
  // effect cost a second render every time a filter moved. Not configured
  // means nothing will ever load, so it is not loading either.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);
  const [typeFilter, setTypeFilter] = useState<ObjectType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ObjectStatus | "all">("all");

  // Every filter change restarts at page 1 -- page 7 of the previous result
  // set means nothing once the filter moved. Done in the handlers rather
  // than in an effect watching them: the reset is part of the event.
  function onFilterChange<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(1);
    };
  }

  const queryKey = [page, search, typeFilter, statusFilter].join("|");
  const loading = configured && loadedKey !== queryKey;

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();

    let query = supabase
      .schema("crm")
      .from("objects")
      .select("*", { count: "exact" })
      .is("building_id", null);
    if (typeFilter !== "all") query = query.eq("type", typeFilter);
    if (statusFilter !== "all") query = query.eq("status", statusFilter);
    if (search.trim()) {
      const q = search.trim();
      query = query.or(`name.ilike.%${q}%,address.ilike.%${q}%`);
    }
    const from = (page - 1) * PAGE_SIZE;
    query = query.order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);

    query.then(({ data, count }) => {
      setObjects((data ?? []) as PropertyObject[]);
      setTotalCount(count ?? 0);
      setLoadedKey(queryKey);
    });
  }, [configured, page, search, typeFilter, statusFilter, queryKey]);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase
      .schema("crm")
      .from("buildings")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => setBuildings((data ?? []) as Building[]));
  }, [configured]);

  // Roll up each building's units (available count + free area). Counted in
  // SQL: this used to read every unit of every building in 1000-row pages, one
  // request after another -- ten sequential round trips on a 10 000-unit
  // development, for three numbers per card.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    createClient()
      .schema("crm")
      .rpc("building_unit_stats")
      .then(({ data, error }) => {
        if (cancelled || error) {
          if (error) console.error("building_unit_stats failed:", error.message);
          return;
        }
        const stats: Record<
          string,
          { available: number; availableArea: number; total: number }
        > = {};
        for (const row of (data ?? []) as Array<{
          building_id: string;
          total: number;
          available: number;
          available_area: number;
        }>) {
          stats[row.building_id] = {
            total: row.total,
            available: row.available,
            availableArea: Number(row.available_area),
          };
        }
        setBuildingStats(stats);
      });

    return () => {
      cancelled = true;
    };
  }, [configured]);

  const filteredBuildings = useMemo(() => {
    if (typeFilter !== "all" || statusFilter !== "all") return [];
    return buildings.filter((b) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return `${b.name} ${b.address ?? ""}`.toLowerCase().includes(q);
    });
  }, [buildings, typeFilter, statusFilter, search]);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const empty = !loading && objects.length === 0 && filteredBuildings.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t.objects.title}</h1>

      {!configured && <SetupNotice />}

      {/* Search, filters and the add action in one right-aligned row --
          the add menu used to sit alone up in the title row, its own
          gap of empty header away from the controls that actually filter
          this same list. Search keeps flex-1 so it's the one thing that
          grows; everything else sits at its natural width beside it. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        <input
          value={searchInput}
          onChange={(e) => onFilterChange(setSearchInput)(e.target.value)}
          placeholder={t.objects.search}
          className="h-10 min-w-[220px] flex-1 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
        />
        {/* Two selects, not pills: 6 types + 5 statuses would be eleven
            pills wide, wrapping across lines where rentals/tasks fit
            their four in one -- a dropdown is still the same bordered
            ControlGroup box as every pill row, just the right widget for
            this many options. */}
        <ControlGroup scrollable>
          <select
            value={typeFilter}
            onChange={(e) => onFilterChange(setTypeFilter)(e.target.value as ObjectType | "all")}
            className="h-8 rounded-md border-0 bg-transparent px-2 text-sm text-[var(--ink-2)] focus:outline-none"
          >
            <option value="all">{t.objects.filters.allTypes}</option>
            {OBJECT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.objects.types[type]}
              </option>
            ))}
          </select>
          <GroupDivider />
          <select
            value={statusFilter}
            onChange={(e) => onFilterChange(setStatusFilter)(e.target.value as ObjectStatus | "all")}
            className="h-8 rounded-md border-0 bg-transparent px-2 text-sm text-[var(--ink-2)] focus:outline-none"
          >
            <option value="all">{t.objects.filters.allStatuses}</option>
            {OBJECT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t.objects.statuses[status]}
              </option>
            ))}
          </select>
        </ControlGroup>
        {role === "admin" && (
          <AddMenu
            label={t.objects.add}
            items={[
              { href: "/objects/new", label: t.objects.newObject },
              { href: "/buildings/new", label: t.objects.newBuilding },
            ]}
          />
        )}
      </div>

      <div className="animate-fade-up hidden overflow-x-auto rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] sm:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border-c)] text-[var(--ink-4)]">
            <tr>
              <th className="px-4 py-3 font-medium">{t.objects.table.name}</th>
              <th className="px-4 py-3 font-medium">{t.objects.table.address}</th>
              <th className="px-4 py-3 font-medium">{t.objects.table.type}</th>
              <th className="px-4 py-3 font-medium">{t.objects.table.status}</th>
              <th className="px-4 py-3 font-medium">{t.objects.table.area}</th>
              <th className="px-4 py-3 font-medium">{t.objects.table.price}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--ink-5)]">
                  {t.common.loading}
                </td>
              </tr>
            )}
            {empty && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--ink-5)]">
                  {t.objects.empty}
                </td>
              </tr>
            )}
            {filteredBuildings.map((building) => (
              <tr
                key={`building-${building.id}`}
                className="cursor-pointer border-b border-[var(--border-c2)] bg-[var(--surface-2)] transition-colors last:border-0 hover:bg-[var(--hover-c2)]"
              >
                <td className="px-4 py-3 font-medium text-[var(--ink-1)]">
                  <Link href={`/buildings/${building.id}`} className="block">
                    {building.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--ink-3)]">{building.address || "—"}</td>
                <td className="px-4 py-3 text-[var(--ink-3)]">{t.objects.buildingRowType}</td>
                <td className="px-4 py-3">
                  {(() => {
                    const s = buildingStats[building.id];
                    if (!s || s.total === 0)
                      return <span className="text-[var(--ink-3)]">—</span>;
                    const sold = s.available === 0;
                    return (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          sold ? STATUS_COLORS.sold : STATUS_COLORS.available
                        }`}
                      >
                        {sold
                          ? t.objects.buildingSoldOut
                          : `${t.objects.buildingInSale} · ${s.available}`}
                      </span>
                    );
                  })()}
                </td>
                <td className="px-4 py-3 text-[var(--ink-3)]">
                  {buildingStats[building.id]?.availableArea
                    ? formatArea(buildingStats[building.id].availableArea)
                    : "—"}
                </td>
                <td className="px-4 py-3 text-[var(--ink-3)]">
                  {building.price_per_sqm
                    ? `${formatCurrency(building.price_per_sqm, "TJS")}/м²`
                    : "—"}
                </td>
              </tr>
            ))}
            {objects.map((obj) => (
              <tr
                key={obj.id}
                className="cursor-pointer border-b border-[var(--border-c2)] transition-colors last:border-0 hover:bg-[var(--hover-c)]"
              >
                <td className="px-4 py-3 font-medium text-[var(--ink-1)]">
                  <Link href={`/objects/${obj.id}`} className="block">
                    {obj.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--ink-3)]">{obj.address || "—"}</td>
                <td className="px-4 py-3 text-[var(--ink-3)]">{t.objects.types[obj.type]}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[obj.status]}`}
                  >
                    {t.objects.statuses[obj.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--ink-3)]">{formatArea(obj.area)}</td>
                <td className="px-4 py-3 text-[var(--ink-3)]">
                  {formatCurrency(obj.price, obj.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="animate-fade-up flex flex-col gap-2 sm:hidden">
        {loading && (
          <p className="rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-6 text-center text-sm text-[var(--ink-5)]">
            {t.common.loading}
          </p>
        )}
        {empty && (
          <p className="rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-6 text-center text-sm text-[var(--ink-5)]">
            {t.objects.empty}
          </p>
        )}
        {filteredBuildings.map((building) => {
          const s = buildingStats[building.id];
          const sold = !!s && s.total > 0 && s.available === 0;
          return (
            <Link
              key={`building-${building.id}`}
              href={`/buildings/${building.id}`}
              className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-c)] bg-[var(--surface-2)] p-3.5 transition-colors active:bg-[var(--hover-c2)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-[var(--ink-1)]">{building.name}</span>
                {s && s.total > 0 && (
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                      sold ? STATUS_COLORS.sold : STATUS_COLORS.available
                    }`}
                  >
                    {sold ? t.objects.buildingSoldOut : `${t.objects.buildingInSale} · ${s.available}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--ink-4)]">{building.address || "—"}</p>
              <div className="flex items-center justify-between gap-2 text-xs text-[var(--ink-3)]">
                <span>{s?.availableArea ? formatArea(s.availableArea) : "—"}</span>
                <span>
                  {building.price_per_sqm
                    ? `${formatCurrency(building.price_per_sqm, "TJS")}/м²`
                    : "—"}
                </span>
              </div>
            </Link>
          );
        })}
        {objects.map((obj) => (
          <Link
            key={obj.id}
            href={`/objects/${obj.id}`}
            className="flex flex-col gap-1.5 rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] p-3.5 transition-colors active:bg-[var(--hover-c)]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-[var(--ink-1)]">{obj.name}</span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[obj.status]}`}
              >
                {t.objects.statuses[obj.status]}
              </span>
            </div>
            <p className="text-xs text-[var(--ink-4)]">{obj.address || "—"}</p>
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--ink-3)]">
              <span>{t.objects.types[obj.type]} · {formatArea(obj.area)}</span>
              <span>{formatCurrency(obj.price, obj.currency)}</span>
            </div>
          </Link>
        ))}
      </div>

      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
