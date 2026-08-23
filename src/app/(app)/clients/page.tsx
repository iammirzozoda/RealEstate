"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { SetupNotice } from "@/components/SetupNotice";
import { Pagination } from "@/components/Pagination";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { formatCurrency, type Currency } from "@/lib/currency";
import { ExportMenu } from "@/components/ExportMenu";
import { ControlGroup, GroupDivider, IconAction } from "@/components/ActionBar";
import {
  CalendarIcon,
  CloseIcon,
  PlusIcon,
  SortDateNewIcon,
  SortDateOldIcon,
  SortNameAzIcon,
  SortNameZaIcon,
} from "@/components/icons";
import { MIN_BUSINESS_DATE, todayISO } from "@/lib/dates";
import type { Client } from "@/lib/clients/types";

// Paid/total across a client's active contracts, per currency -- fetched
// only for the 25 clients on the current page, so the list stays fast no
// matter how big the client base grows.
type ClientDebt = {
  byCurrency: Record<string, { total: number; paid: number }>;
};

// Which unit(s) a client bought -- a client has no building/unit of their
// own, it's reached through their contracts, and the list used to make you
// open the client just to find out what they'd actually bought. Almost
// always one entry; kept as a list because nothing stops someone owning two.
type ClientUnit = { buildingName: string | null; unitName: string };

const PAGE_SIZE = 25;

export default function ClientsPage() {
  const { t } = useLocale();
  const configured = isSupabaseConfigured();

  const [clients, setClients] = useState<Client[]>([]);
  const [debts, setDebts] = useState<Record<string, ClientDebt>>({});
  const [units, setUnits] = useState<Record<string, ClientUnit[]>>({});
  const [totalCount, setTotalCount] = useState(0);
  // "Loading" is derived, not stored. It is exactly "the data on screen does
  // not belong to the filters currently set", so it is a comparison, not a
  // flag to raise before a fetch and lower after -- and raising it inside
  // the effect was a second render on every keystroke. Not configured means
  // nothing will ever load, so it is not loading either.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput);
  const [sort, setSort] = useState<"new" | "old" | "az" | "za">("new");
  // Added-on date range. Both ends optional, so "everything since March" and
  // "everything up to March" work without inventing a second control.
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // "all" rather than null so the <option> value round-trips as a string.
  const [buildingId, setBuildingId] = useState("all");
  const [buildings, setBuildings] = useState<Array<{ id: string; name: string }>>([]);

  // Every filter change restarts at page 1 -- page 7 of the previous result
  // set means nothing once the filter moved, and asking for it can land on an
  // empty page. Done in the handlers that change a filter rather than in an
  // effect watching them: the reset is part of the event, not state that
  // needs synchronising after the fact.
  function onFilterChange<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(1);
    };
  }

  useEffect(() => {
    if (!configured) return;
    createClient()
      .schema("crm")
      .from("buildings")
      .select("id, name")
      .order("name")
      .then(({ data }) => setBuildings((data ?? []) as Array<{ id: string; name: string }>));
  }, [configured]);

  const queryKey = [page, search, sort, dateFrom, dateTo, buildingId].join("|");
  const loading = configured && loadedKey !== queryKey;

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();

    // !inner turns the embed into a join filter: only clients WITH a
    // contract on a unit in the chosen building come back, and the row is
    // still one row per client however many contracts matched. Selecting
    // the plain "*" when no building is chosen keeps the default listing
    // from carrying contract rows it has no use for.
    const selectCols =
      buildingId === "all"
        ? "*"
        : "*, contracts!inner(object:objects!inner(building_id))";
    let query = supabase
      .schema("crm")
      .from("clients")
      .select(selectCols, { count: "exact" });
    if (buildingId !== "all") {
      query = query.eq("contracts.object.building_id", buildingId);
    }
    if (search.trim()) {
      const q = search.trim();
      query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,phone2.ilike.%${q}%`);
    }
    // created_at is a timestamp, so the upper bound has to reach the END of
    // the chosen day -- `lte` on the bare date would silently drop everyone
    // added that day.
    if (dateFrom) query = query.gte("created_at", dateFrom);
    if (dateTo) query = query.lt("created_at", `${dateTo}T23:59:59.999`);
    const from = (page - 1) * PAGE_SIZE;
    const orderBy =
      sort === "az" || sort === "za"
        ? { col: "name", asc: sort === "az" }
        : { col: "created_at", asc: sort === "old" };
    query = query
      .order(orderBy.col, { ascending: orderBy.asc })
      .range(from, from + PAGE_SIZE - 1);

    query.then(async ({ data, count }) => {
      // Through unknown: the select string is chosen at runtime, so
      // supabase-js cannot parse it into a row type at compile time.
      const rows = (data ?? []) as unknown as Client[];
      setClients(rows);
      setTotalCount(count ?? 0);
      setLoadedKey(queryKey);

      if (rows.length === 0) {
        setDebts({});
        setUnits({});
        return;
      }
      // One query covers both the debt bar and the object/unit column --
      // both read off the same contract rows, so there is no reason to ask
      // twice.
      const { data: contractRows } = await supabase
        .schema("crm")
        .from("contracts")
        .select(
          "client_id, amount, paid_amount, currency, status, object:objects(name, building:buildings(name))"
        )
        .in(
          "client_id",
          rows.map((c) => c.id)
        )
        .neq("status", "cancelled");

      const debtMap: Record<string, ClientDebt> = {};
      const unitMap: Record<string, ClientUnit[]> = {};
      const seen: Record<string, Set<string>> = {};
      for (const c of (contractRows ?? []) as unknown as Array<{
        client_id: string;
        amount: number;
        paid_amount: number;
        currency: Currency;
        object: { name: string; building: { name: string } | null } | null;
      }>) {
        const debtEntry = (debtMap[c.client_id] ??= { byCurrency: {} });
        const cur = (debtEntry.byCurrency[c.currency] ??= { total: 0, paid: 0 });
        cur.total += c.amount;
        cur.paid += Math.min(c.paid_amount, c.amount);

        if (c.object) {
          const key = `${c.object.building?.name ?? ""}|${c.object.name}`;
          const dedupe = (seen[c.client_id] ??= new Set());
          if (!dedupe.has(key)) {
            dedupe.add(key);
            (unitMap[c.client_id] ??= []).push({
              buildingName: c.object.building?.name ?? null,
              unitName: c.object.name,
            });
          }
        }
      }
      setDebts(debtMap);
      setUnits(unitMap);
    });
  }, [configured, page, search, sort, dateFrom, dateTo, buildingId, queryKey]);

  // Build the export rows on demand (every client MATCHING THE CURRENT
  // FILTERS, per-currency debt), fed to the Excel/PDF menu.
  //
  // This used to ignore every filter on the page and export the entire
  // client base regardless of what was actually on screen -- pick one ЖК
  // and a date range, and the download still had every client the company
  // has ever had. Same search/date/building conditions as the list query
  // below, just without the page slice: every MATCHING row, not page N's 25.
  const getExportRows = async () => {
    const supabase = createClient();
    const selectCols =
      buildingId === "all" ? "id, name, phone, email" : "id, name, phone, email, contracts!inner(object:objects!inner(building_id))";
    const all: Client[] = [];
    const stepSize = 1000;
    for (let from = 0; ; from += stepSize) {
      let query = supabase.schema("crm").from("clients").select(selectCols);
      if (buildingId !== "all") {
        query = query.eq("contracts.object.building_id", buildingId);
      }
      if (search.trim()) {
        const q = search.trim();
        query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,phone2.ilike.%${q}%`);
      }
      if (dateFrom) query = query.gte("created_at", dateFrom);
      if (dateTo) query = query.lt("created_at", `${dateTo}T23:59:59.999`);
      const { data } = await query.order("name").range(from, from + stepSize - 1);
      const chunk = (data ?? []) as unknown as Client[];
      all.push(...chunk);
      if (chunk.length < stepSize) break;
    }
    if (all.length === 0) return [];
    const { data: contractRows } = await supabase
      .schema("crm")
      .from("contracts")
      .select("client_id, amount, paid_amount, currency, status")
      .in(
        "client_id",
        all.map((c) => c.id)
      )
      .neq("status", "cancelled");
    const byClient: Record<string, { count: number; tjsPaid: number; tjsDebt: number; usdPaid: number; usdDebt: number }> = {};
    for (const c of (contractRows ?? []) as Array<{ client_id: string; amount: number; paid_amount: number; currency: Currency }>) {
      const e = (byClient[c.client_id] ??= { count: 0, tjsPaid: 0, tjsDebt: 0, usdPaid: 0, usdDebt: 0 });
      e.count += 1;
      const paid = Math.min(c.paid_amount, c.amount);
      const debt = Math.max(0, c.amount - c.paid_amount);
      if (c.currency === "USD") { e.usdPaid += paid; e.usdDebt += debt; }
      else { e.tjsPaid += paid; e.tjsDebt += debt; }
    }
    const num = (v: number) => (v ? v.toFixed(2).replace(".", ",") : "");
    return all.map((cl) => {
      const e = byClient[cl.id];
      return [cl.name, cl.phone ?? "", cl.email ?? "", e?.count ?? 0, num(e?.tjsPaid ?? 0), num(e?.tjsDebt ?? 0), num(e?.usdPaid ?? 0), num(e?.usdDebt ?? 0)];
    });
  };

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">{t.clients.title}</h1>

      {!configured && <SetupNotice />}

      {/* Search, date/building/sort and export/add used to be three separate
          rows (title+actions, then search alone, then the filter group) --
          one flex-wrap row now, everything a click apart from everything
          else instead of scattered top to bottom. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={searchInput}
          onChange={(e) => onFilterChange(setSearchInput)(e.target.value)}
          placeholder={t.clients.search}
          className="h-10 min-w-[160px] flex-1 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
        />
        {/* Dates and sort are ONE glued control, not two floating pills.
            List page, so full size; a divider keeps the two jobs legible. */}
        <ControlGroup>
          <span className="pl-1.5 pr-0.5 text-[var(--ink-5)]" aria-hidden="true">
            <CalendarIcon className="h-[19px] w-[19px]" />
          </span>
          <span className="text-xs text-[var(--ink-5)]">{t.clients.dateRange.from}</span>
          <input
            type="date"
            value={dateFrom}
            min={MIN_BUSINESS_DATE}
            max={dateTo || todayISO()}
            onChange={(e) => onFilterChange(setDateFrom)(e.target.value)}
            aria-label={`${t.clients.dateRange.label} ${t.clients.dateRange.from}`}
            className="h-10 rounded-md border border-transparent bg-transparent px-1 text-xs text-[var(--ink-2)] hover:border-[var(--border-c)] focus:border-[var(--field-focus-border)] focus:outline-none"
          />
          <span className="text-xs text-[var(--ink-5)]">{t.clients.dateRange.to}</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || MIN_BUSINESS_DATE}
            max={todayISO()}
            onChange={(e) => onFilterChange(setDateTo)(e.target.value)}
            aria-label={`${t.clients.dateRange.label} ${t.clients.dateRange.to}`}
            className="h-10 rounded-md border border-transparent bg-transparent px-1 text-xs text-[var(--ink-2)] hover:border-[var(--border-c)] focus:border-[var(--field-focus-border)] focus:outline-none"
          />
          {(dateFrom || dateTo) && (
            <IconAction
              label={t.clients.dateRange.clear}
              icon={<CloseIcon />}
              onClick={() => {
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
            />
          )}

          <GroupDivider />

          {/* Which building a client bought in. Clients have no building of
              their own -- the link runs client → contract → unit → building --
              so this filters through the relationship rather than on a column,
              and a buyer with two flats in the same building still appears
              once. */}
          <select
            value={buildingId}
            onChange={(e) => onFilterChange(setBuildingId)(e.target.value)}
            aria-label={t.clients.buildingFilter}
            title={t.clients.buildingFilter}
            className="h-10 max-w-[150px] rounded-md border-0 bg-transparent px-1.5 text-xs text-[var(--ink-2)] focus:outline-none"
          >
            <option value="all">{t.clients.allObjects}</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <GroupDivider />

          {(
            [
              { id: "new", label: t.clients.sort.newest, icon: <SortDateNewIcon /> },
              { id: "old", label: t.clients.sort.oldest, icon: <SortDateOldIcon /> },
              { id: "az", label: t.clients.sort.az, icon: <SortNameAzIcon /> },
              { id: "za", label: t.clients.sort.za, icon: <SortNameZaIcon /> },
            ] as const
          ).map((opt) => (
            <IconAction
              key={opt.id}
              label={opt.label}
              icon={opt.icon}
              active={sort === opt.id}
              onClick={() => onFilterChange(setSort)(opt.id)}
            />
          ))}
        </ControlGroup>

        {/* Export and "add client" -- used to sit up in the title row, its
            own group with a gap of empty header between it and everything
            else that filters the same list. Same row as the rest now. */}
        <ControlGroup>
          <ExportMenu
            bare
            getData={getExportRows}
            headers={[
              t.clients.table.name,
              t.clients.table.phone,
              t.clients.form.email,
              t.clients.stats.bought,
              "Оплачено TJS",
              "Долг TJS",
              "Оплачено USD",
              "Долг USD",
            ]}
            filenameBase="clients"
            title={t.clients.title}
          />
          <GroupDivider />
          <IconAction
            label={t.clients.newClient}
            icon={<PlusIcon />}
            tone="brand"
            href="/clients/new"
          />
        </ControlGroup>
      </div>

      {/* Table from tablet width up; below that a table just gets narrower
          columns squeezed to fit, not actually readable without scrolling
          sideways to see the rest of a row -- so on phone this becomes a
          stack of cards instead, same four facts per client, one under the
          other rather than side by side. No second data-fetch: both views
          read the same clients/debts/units state, only the markup differs. */}
      <div className="animate-fade-up hidden overflow-x-auto rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] sm:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border-c)] text-[var(--ink-4)]">
            <tr>
              <th className="px-4 py-3 font-medium">{t.clients.table.name}</th>
              <th className="px-4 py-3 font-medium">{t.clients.table.phone}</th>
              <th className="px-4 py-3 font-medium">{t.clients.table.unit}</th>
              <th className="w-56 px-4 py-3 font-medium">{t.clients.stats.debt}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--ink-5)]">
                  {t.common.loading}
                </td>
              </tr>
            )}
            {!loading && clients.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-[var(--ink-5)]">
                  {t.clients.empty}
                </td>
              </tr>
            )}
            {clients.map((client) => (
              <tr
                key={client.id}
                className="cursor-pointer border-b border-[var(--border-c2)] transition-colors last:border-0 hover:bg-[var(--hover-c)]"
              >
                <td className="px-4 py-3 font-medium text-[var(--ink-1)]">
                  <Link href={`/clients/${client.id}`} className="block">
                    {client.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-[var(--ink-3)]">{client.phone || "—"}</td>
                <td className="px-4 py-3 text-[var(--ink-3)]">
                  <Link href={`/clients/${client.id}`} className="block">
                    <UnitCell units={units[client.id]} />
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/clients/${client.id}`} className="block">
                    <DebtBar debt={debts[client.id]} />
                  </Link>
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
        {!loading && clients.length === 0 && (
          <p className="rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-6 text-center text-sm text-[var(--ink-5)]">
            {t.clients.empty}
          </p>
        )}
        {clients.map((client) => (
          <Link
            key={client.id}
            href={`/clients/${client.id}`}
            className="flex flex-col gap-2 rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] p-3.5 transition-colors active:bg-[var(--hover-c)]"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-[var(--ink-1)]">{client.name}</span>
              <span className="shrink-0 text-sm text-[var(--ink-3)]">{client.phone || "—"}</span>
            </div>
            <div className="flex items-end justify-between gap-3">
              <UnitCell units={units[client.id]} />
              <div className="w-32 shrink-0">
                <DebtBar debt={debts[client.id]} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}

// Which unit(s) the client bought -- building name above, unit number below,
// same two-line shape wherever the app already shows an apartment (the
// shakhmatka's own cells). Stacked, not comma-joined, for the rare client
// with more than one: a comma-run of "ЖК А №5, ЖК Б №12" is one long string
// to parse, two short lines are two facts to read.
function UnitCell({ units }: { units: ClientUnit[] | undefined }) {
  if (!units || units.length === 0) return <span className="text-[var(--ink-5)]">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {units.map((u, i) => (
        <div key={i} className="leading-tight">
          {u.buildingName && <p className="text-xs text-[var(--ink-5)]">{u.buildingName}</p>}
          <p className="font-medium text-[var(--ink-2)]">№{u.unitName}</p>
        </div>
      ))}
    </div>
  );
}

// The debt cell: one bar per currency (TJS and USD don't mix into one
// percentage), green fill = share paid, red figure = what's still owed.
function DebtBar({ debt }: { debt: ClientDebt | undefined }) {
  if (!debt) return <span className="text-[var(--ink-5)]">—</span>;
  const entries = Object.entries(debt.byCurrency).filter(([, v]) => v.total > 0);
  if (entries.length === 0) return <span className="text-[var(--ink-5)]">—</span>;
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map(([currency, v]) => {
        const pct = Math.min(100, Math.round((v.paid / v.total) * 100));
        const remaining = Math.max(0, v.total - v.paid);
        return (
          <div key={currency}>
            <div className="flex items-baseline justify-between gap-2 text-[11px]">
              <span className={pct === 100 ? "font-semibold text-[var(--wash-emerald-ink)]" : "text-[var(--ink-5)]"}>
                {pct}%
              </span>
              {remaining > 0 ? (
                <span className="font-semibold text-[var(--wash-rose-ink)]">
                  −{formatCurrency(remaining, currency as Currency)}
                </span>
              ) : (
                <span className="font-semibold text-[var(--wash-emerald-ink)]">✓</span>
              )}
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--track-c)]">
              <div
                className={`h-full rounded-full ${
                  pct === 100
                    ? "bg-emerald-500"
                    : "bg-gradient-to-r from-emerald-500 to-emerald-400"
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
