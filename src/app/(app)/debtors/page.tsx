"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { SetupNotice } from "@/components/SetupNotice";
import { Pagination } from "@/components/Pagination";
import { formatCurrency, type Currency } from "@/lib/currency";
import { formatShortDate } from "@/lib/formatDate";
import { ExportMenu } from "@/components/ExportMenu";
import { ControlGroup, GroupDivider, PillButton } from "@/components/ActionBar";
import { SortIcon } from "@/components/icons";
import { HBarChart } from "@/components/charts/HBarChart";
import { STATUS_HUES } from "@/components/charts/palette";
import { waLink } from "@/lib/whatsapp";

const PAGE_SIZE = 25;
// Batch size for the "export everything" path -- PostgREST will not hand back
// more than this in one response anyway.
const EXPORT_BATCH = 1000;

type SortKey = "freshest" | "overdue" | "oldest" | "name";

// Which column each choice orders by, applied in the database so the order
// holds across pages.
const SORTS: Record<SortKey, { column: string; ascending: boolean }> = {
  // Most recently missed payment first -- who fell behind TODAY, then
  // yesterday, then a few days ago. These are the calls most worth making
  // first: still fresh enough that a reminder alone often fixes it, before
  // it drifts into "oldest" territory further down the list.
  freshest: { column: "latest_due", ascending: false },
  overdue: { column: "total_overdue", ascending: false },
  oldest: { column: "earliest_due", ascending: true },
  name: { column: "client_name", ascending: true },
};

// One reminder PER CONTRACT, not per missed installment. A long installment
// plan with nothing paid used to spill one row per overdue month (9, 20, 30
// rows for the same flat); now it's a single line summing what's overdue.
// Paid installments drop out on their own, so recording a payment shrinks the
// reminder and fully closing the plan removes it entirely.
type ContractDebt = {
  contractId: string;
  clientId: string | null;
  clientName: string;
  clientPhone: string | null;
  objectName: string | null;
  contractNumber: string | null;
  currency: Currency;
  missedCount: number;
  totalOverdue: number;
  // The whole balance of the contract, not just the overdue slice -- the two
  // were being confused for each other on screen.
  remainingTotal: number;
  // Earliest missed date = since when in arrears; latest = the current period
  // to chase. Days overdue is measured from the latest, so it reflects the
  // present cycle and rolls forward each month instead of ballooning to 785.
  earliestDue: string;
  latestDue: string;
  daysOverdue: number;
};

// A row exactly as crm.overdue_contracts() returns it.
type OverdueRow = {
  contract_id: string;
  contract_number: string | null;
  client_id: string | null;
  client_name: string;
  client_phone: string | null;
  object_name: string | null;
  currency: Currency;
  missed_count: number;
  total_overdue: number;
  remaining_total: number | null;
  earliest_due: string;
  latest_due: string;
};

// A quick "how bad is this one" read at a glance, without having to parse
// the day count. Amber for a debtor who just fell behind (0-3 days -- a
// reminder alone often still fixes this) vs rose for one who's been
// overdue longer (needs a firmer follow-up, not just a nudge).
function urgencyTone(daysOverdue: number): string {
  return daysOverdue <= 3
    ? "bg-[var(--wash-amber)] text-[var(--wash-amber-ink)]"
    : "bg-[var(--wash-rose)] text-[var(--wash-rose-ink)]";
}

// Same shape the table renders, built from one RPC row.
function toDebt(r: OverdueRow, now: number): ContractDebt {
  return {
    contractId: r.contract_id,
    clientId: r.client_id,
    clientName: r.client_name,
    clientPhone: r.client_phone,
    objectName: r.object_name,
    contractNumber: r.contract_number,
    currency: r.currency,
    missedCount: r.missed_count,
    totalOverdue: Number(r.total_overdue),
    remainingTotal: Number(r.remaining_total ?? 0),
    earliestDue: r.earliest_due,
    latestDue: r.latest_due,
    // Measured from the LATEST missed date, so it reflects the current cycle
    // and rolls forward each month instead of ballooning.
    daysOverdue: Math.floor((now - new Date(r.latest_due).getTime()) / 86_400_000),
  };
}

export default function DebtorsPage() {
  const { t } = useLocale();
  const configured = isSupabaseConfigured();
  const [rows, setRows] = useState<ContractDebt[]>([]);
  const [totals, setTotals] = useState<
    Array<{ currency: Currency; overdue: number; remaining: number; contracts: number }>
  >([]);
  // Explicit, and visible on screen. The order used to be fixed and unstated,
  // so there was no way to tell what the list was sorted by. Defaults to
  // "freshest" (who just fell behind) rather than "by amount owed" -- the
  // list is a call queue, and the most recently missed payment is the one
  // worth acting on first.
  const [sort, setSort] = useState<SortKey>("freshest");
  // Filter by ЖК: collections are organised per development, so "show me only
  // this one" is the first thing anybody asks of this list.
  const [buildingId, setBuildingId] = useState<string>("all");
  const [buildings, setBuildings] = useState<Array<{ id: string; name: string }>>([]);
  const [byBuilding, setByBuilding] = useState<
    Array<{ name: string; overdue: number; remaining: number; contracts: number; currency: Currency }>
  >([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  // "Loading" is derived, not stored. It is exactly "the data on screen does
  // not belong to the parameters currently set", so it is a comparison, not a
  // flag raised before a fetch and lowered after -- and raising it inside the
  // effect cost a second render every time a filter moved. Not configured
  // means nothing will ever load, so it is not loading either.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // Paged, 25 at a time. Two ceilings had to go here. First: the page used to
  // pull EVERY unpaid overdue installment and group them in the browser -- and
  // a two-year plan is 20-30 rows on its own, so PostgREST's 1000-row cap was
  // reachable at a few dozen debtors. Migration 038 fixed that by grouping in
  // SQL. But one contract still costs one row, so the same cap returns at a
  // thousand contracts in arrears -- and on THIS page a silently truncated
  // list means somebody who owes money never gets called. Hence real paging,
  // with the row count coming from the server rather than from rows.length.
  const queryKey = [page, sort, buildingId].join("|");
  const loading = configured && loadedKey !== queryKey;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const from = (page - 1) * PAGE_SIZE;
    const order = SORTS[sort];
    createClient()
      .schema("crm")
      .rpc("overdue_contracts", { p_building_id: buildingId === "all" ? null : buildingId }, { count: "exact" })
      // Sorted in the database, so the order holds ACROSS pages -- sorting the
      // 25 rows on screen would be a different list on every page. contract_id
      // second: without a unique tiebreaker, equal values can come back in a
      // different order per page, showing one debtor twice and another never.
      .order(order.column, { ascending: order.ascending })
      .order("contract_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .then(({ data, count, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("overdue_contracts failed:", error.message);
          setFailure(error.message);
          setRows([]);
          setTotalCount(0);
          setLoadedKey(queryKey);
          return;
        }
        const batch = (data ?? []) as OverdueRow[];
        // Debts get paid while the page is open. If that emptied the page
        // we're standing on, fall back to the first one rather than showing a
        // blank table under a "3 / 2" counter.
        if (batch.length === 0 && page > 1) {
          setPage(1);
          return;
        }
        const now = Date.now();
        setFailure(null);
        setRows(batch.map((r) => toDebt(r, now)));
        setTotalCount(count ?? 0);
        setLoadedKey(queryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [configured, page, sort, buildingId, queryKey]);

  // The headline totals cover EVERY debtor, not the 25 on screen, so they come
  // from their own aggregate instead of being summed from `rows`.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    createClient()
      .schema("crm")
      .rpc("overdue_totals", { p_building_id: buildingId === "all" ? null : buildingId })
      .then(({ data, error }) => {
        if (cancelled || error) {
          if (error) console.error("overdue_totals failed:", error.message);
          return;
        }
        setTotals(
          (
            (data ?? []) as Array<{
              currency: Currency;
              contracts: number;
              total_overdue: number;
              remaining_total: number;
            }>
          )
            .map((r) => ({
              currency: r.currency,
              contracts: r.contracts,
              overdue: Number(r.total_overdue),
              remaining: Number(r.remaining_total ?? 0),
            }))
            .filter((r) => r.overdue > 0)
        );
      });
    return () => {
      cancelled = true;
    };
  }, [configured, buildingId]);

  // The chart shows every building regardless of the filter -- narrowing the
  // list to one ЖК shouldn't hide the comparison that tells you which ЖК to
  // narrow to. Fetched once.
  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const supabase = createClient();
    Promise.all([
      supabase.schema("crm").from("buildings").select("id, name").order("name"),
      supabase.schema("crm").rpc("overdue_by_building"),
    ]).then(([bRes, oRes]) => {
      if (cancelled) return;
      setBuildings((bRes.data ?? []) as Array<{ id: string; name: string }>);
      if (oRes.error) {
        console.error("overdue_by_building failed:", oRes.error.message);
        return;
      }
      setByBuilding(
        (
          (oRes.data ?? []) as Array<{
            building_name: string;
            currency: Currency;
            contracts: number;
            total_overdue: number;
            remaining_total: number | null;
          }>
        ).map((r) => ({
          name: r.building_name,
          currency: r.currency,
          contracts: r.contracts,
          overdue: Number(r.total_overdue),
          remaining: Number(r.remaining_total ?? 0),
        }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [configured]);

  // Grouped by currency: one panel and one scale per currency, because TJS and
  // USD on a shared axis compare nothing.
  const byCurrency = useMemo(() => {
    const seen: Currency[] = [];
    for (const r of byBuilding) if (!seen.includes(r.currency)) seen.push(r.currency);
    return seen.map((currency) => ({
      currency,
      rows: byBuilding.filter((r) => r.currency === currency),
      total: totals.find((tt) => tt.currency === currency) ?? null,
    }));
  }, [byBuilding, totals]);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // Export is the whole list, not the current page -- an Excel file of 25 rows
  // out of 1200 would be quietly wrong in exactly the way this change exists
  // to prevent. Fetched in batches on demand, only when the button is pressed.
  const getExportRows = async () => {
    const num = (n: number) => n.toFixed(2).replace(".", ",");
    const supabase = createClient();
    const all: ContractDebt[] = [];
    const now = Date.now();
    for (let from = 0; ; from += EXPORT_BATCH) {
      const { data, error } = await supabase
        .schema("crm")
        // The export follows the same filter as the list on screen -- a file
        // covering every ЖК while the page shows one would disagree with what
        // the person exporting it was looking at.
        .rpc("overdue_contracts", { p_building_id: buildingId === "all" ? null : buildingId })
        .range(from, from + EXPORT_BATCH - 1);
      const batch = (data ?? []) as OverdueRow[];
      if (error || batch.length === 0) break;
      all.push(...batch.map((r) => toDebt(r, now)));
      if (batch.length < EXPORT_BATCH) break;
    }
    return all.map((r) => [
      r.clientName,
      r.clientPhone ?? "",
      r.objectName ?? "",
      r.contractNumber ?? "",
      r.earliestDue,
      r.missedCount,
      num(r.totalOverdue),
      num(r.remainingTotal),
      r.currency,
    ]);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.debtors.title}</h1>
          <p className="text-sm text-[var(--ink-4)]">{t.debtors.subtitle}</p>
        </div>
        {totalCount > 0 && (
          <ExportMenu
            getData={getExportRows}
            headers={[
              t.debtors.client,
              t.clients.table.phone,
              t.debtors.object,
              "№",
              t.debtors.oldestDue,
              t.debtors.missedPayments,
              t.debtors.overdueNow,
              t.debtors.remainingCol,
              "Валюта",
            ]}
            filenameBase="debtors"
            title={t.debtors.title}
          />
        )}
      </div>

      {!configured && <SetupNotice />}

      {failure && (
        <div className="rounded-lg border border-[var(--wash-rose-border)] bg-[var(--wash-rose)] px-4 py-3 text-sm text-[var(--wash-rose-ink)]">
          <p className="font-semibold">{t.dashboard.summaryFailed}</p>
          <p className="mt-1 text-xs opacity-80">{failure}</p>
        </div>
      )}

      {/* One panel PER CURRENCY, each on its own scale.
          The previous version put every building on a single axis regardless of
          currency, so 1 072 475 TJS and 99 205 USD were compared as if they
          were the same unit -- the USD bars were flattened to slivers and every
          building appeared twice with no hint why. Currencies do not share an
          axis. Horizontal bars, so "Кайҳонавадон 36 Б" gets the card width
          instead of 40px under a column. */}
      {byCurrency.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {byCurrency.map(({ currency, rows: cRows, total }) => (
            <div
              key={currency}
              className="rounded-2xl border border-[var(--border-c)] bg-[var(--surface-1)] p-4 shadow-sm"
            >
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-[var(--ink-2)]">
                  {t.debtors.chartTitle} · {currency}
                </p>
                {total && (
                  <span className="text-xs text-[var(--ink-4)]">
                    <span className="font-semibold text-[var(--wash-rose-ink)]">
                      {formatCurrency(total.overdue, currency)}
                    </span>{" "}
                    <span className="text-[var(--ink-5)]">
                      / {formatCurrency(total.remaining, currency)}
                    </span>
                  </span>
                )}
              </div>
              <HBarChart
                data={cRows.map((b) => ({
                  label: b.name,
                  value: b.overdue,
                  // Track sized to the whole remaining balance, overdue
                  // filled in as a share of it -- see chartHint below,
                  // which this now actually matches.
                  total: b.remaining > 0 ? b.remaining : b.overdue,
                  hue: STATUS_HUES.sold,
                  hint: `${b.contracts} ${t.contracts.title.toLowerCase()}`,
                }))}
                formatValue={(n) => formatCurrency(n, currency)}
              />
              {total && <p className="mt-3 text-xs text-[var(--ink-5)]">{t.debtors.chartHint}</p>}
            </div>
          ))}
        </div>
      )}

      {/* The order is a choice, it says which one is active, and the three
          options are ONE glued control instead of three loose pills. */}
      {totalCount > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--ink-4)]">{t.debtors.sortLabel}:</span>
          <ControlGroup size="sm" scrollable>
            {/* Filter by ЖК, in the same glued control as the sort options. */}
            <select
              value={buildingId}
              onChange={(e) => {
                setBuildingId(e.target.value);
                setPage(1);
              }}
              aria-label={t.dashboard.allBuildings}
              className="h-8 rounded-md border-0 bg-transparent px-2 text-xs text-[var(--ink-2)] focus:outline-none"
            >
              <option value="all">{t.dashboard.allBuildings}</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <GroupDivider />
            <span className="pl-1 text-[var(--ink-5)]" aria-hidden="true">
              <SortIcon className="h-4 w-4" />
            </span>
            {(
              [
                ["freshest", t.debtors.sortByFreshest],
                ["overdue", t.debtors.sortByOverdue],
                ["oldest", t.debtors.sortByOldest],
                ["name", t.debtors.sortByName],
              ] as Array<[SortKey, string]>
            ).map(([key, label]) => (
              <PillButton
                key={key}
                label={label}
                active={sort === key}
                onClick={() => {
                  setSort(key);
                  setPage(1);
                }}
              />
            ))}
          </ControlGroup>
        </div>
      )}

      <div className="animate-fade-up hidden overflow-x-auto rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] sm:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-[var(--border-c)] text-[var(--ink-4)]">
            <tr>
              <th className="px-4 py-3 font-medium">{t.debtors.client}</th>
              <th className="px-4 py-3 font-medium">{t.debtors.object}</th>
              <th className="px-4 py-3 font-medium">{t.debtors.oldestDue}</th>
              <th className="px-4 py-3 text-right font-medium">{t.debtors.overdueNow}</th>
              <th className="px-4 py-3 text-right font-medium">{t.debtors.remainingCol}</th>
              <th className="px-4 py-3 text-right font-medium"></th>
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
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--wash-emerald-ink)]">
                  {t.debtors.empty}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.contractId} className="border-b border-[var(--border-c2)] last:border-0 hover:bg-[var(--hover-c)]">
                <td className="px-4 py-3">
                  {r.clientId ? (
                    <Link
                      href={`/clients/${r.clientId}`}
                      className="-mx-1 rounded px-1 font-medium text-[var(--ink-1)] transition-colors hover:bg-[var(--wash-plum)] hover:text-brand"
                    >
                      {r.clientName}
                    </Link>
                  ) : (
                    <span className="font-medium text-[var(--ink-1)]">{r.clientName}</span>
                  )}
                  {r.clientPhone && (
                    <div className="text-xs text-[var(--ink-5)]">{r.clientPhone}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-[var(--ink-3)]">{r.objectName ?? "—"}</td>
                <td className="px-4 py-3 text-[var(--ink-3)]">
                  <div className="flex flex-col items-start gap-1">
                    {formatShortDate(r.earliestDue)}
                    <span
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${urgencyTone(r.daysOverdue)}`}
                    >
                      {r.daysOverdue} {t.debtors.days}
                    </span>
                  </div>
                </td>
                {/* Amount first, then how many payments make it up, spelled
                    out. "9 плат." said nothing about what was owed. */}
                <td className="px-4 py-3 text-right">
                  <div className="font-semibold text-[var(--wash-rose-ink)]">
                    {formatCurrency(r.totalOverdue, r.currency)}
                  </div>
                  <div className="text-xs text-[var(--ink-5)]">
                    {r.missedCount}{" "}
                    {r.missedCount === 1 ? t.debtors.missedOne : t.debtors.missedPayments}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-[var(--ink-2)]">
                  {formatCurrency(r.remainingTotal, r.currency)}
                </td>
                <td className="px-4 py-3 text-right">
                  {r.clientPhone ? (
                    <a
                      href={waLink(
                        r.clientPhone,
                        t.debtors.reminderMsg
                          .replace("{name}", r.clientName)
                          .replace("{contract}", r.contractNumber ?? "—")
                          .replace(
                            "{amount}",
                            formatCurrency(r.totalOverdue, r.currency)
                          )
                          .replace("{days}", String(r.daysOverdue))
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={t.debtors.whatsapp}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--wash-emerald-border)] px-2.5 py-1 text-xs font-semibold text-[var(--wash-emerald-ink)] transition-all hover:bg-[var(--wash-emerald)] active:scale-95"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1a13 13 0 0 1-1.5-.5c-2.6-1.1-4.3-3.7-4.4-3.9-.1-.2-1-1.4-1-2.6s.6-1.8.9-2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c0 .2.1.3 0 .5l-.3.5-.4.5c-.2.1-.3.3-.1.6.1.3.7 1.1 1.4 1.8.9.9 1.7 1.1 2 1.3.2.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l2 .9c.2.1.4.2.4.3.1.1.1.6-.1 1.1Z" /></svg>
                      {t.debtors.whatsapp}
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--ink-5)]">{t.debtors.noPhone}</span>
                  )}
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
        {!loading && rows.length === 0 && (
          <p className="rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-8 text-center text-sm text-[var(--wash-emerald-ink)]">
            {t.debtors.empty}
          </p>
        )}
        {rows.map((r) => (
          <div
            key={r.contractId}
            className="flex flex-col gap-2.5 rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] p-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {r.clientId ? (
                  <Link
                    href={`/clients/${r.clientId}`}
                    className="-mx-1 block rounded px-1 font-medium text-[var(--ink-1)] transition-colors hover:bg-[var(--wash-plum)] hover:text-brand"
                  >
                    {r.clientName}
                  </Link>
                ) : (
                  <span className="font-medium text-[var(--ink-1)]">{r.clientName}</span>
                )}
                {r.clientPhone && (
                  <div className="text-xs text-[var(--ink-5)]">{r.clientPhone}</div>
                )}
              </div>
              <span className="shrink-0 text-right text-xs text-[var(--ink-4)]">
                {r.objectName ?? "—"}
              </span>
            </div>

            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs text-[var(--ink-5)]">
                  {formatShortDate(r.earliestDue)}
                  <span
                    className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-medium ${urgencyTone(r.daysOverdue)}`}
                  >
                    {r.daysOverdue} {t.debtors.days}
                  </span>
                </p>
                <p className="font-semibold text-[var(--wash-rose-ink)]">
                  {formatCurrency(r.totalOverdue, r.currency)}
                </p>
                <p className="text-xs text-[var(--ink-5)]">
                  {r.missedCount}{" "}
                  {r.missedCount === 1 ? t.debtors.missedOne : t.debtors.missedPayments}
                  {" · "}
                  {t.debtors.remainingCol}: {formatCurrency(r.remainingTotal, r.currency)}
                </p>
              </div>
              {r.clientPhone ? (
                <a
                  href={waLink(
                    r.clientPhone,
                    t.debtors.reminderMsg
                      .replace("{name}", r.clientName)
                      .replace("{contract}", r.contractNumber ?? "—")
                      .replace("{amount}", formatCurrency(r.totalOverdue, r.currency))
                      .replace("{days}", String(r.daysOverdue))
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={t.debtors.whatsapp}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--wash-emerald-border)] px-2.5 py-1.5 text-xs font-semibold text-[var(--wash-emerald-ink)] transition-all active:scale-95"
                >
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.3 14.1c-.2.6-1.2 1.2-1.7 1.2-.4.1-1 .1-1.6-.1a13 13 0 0 1-1.5-.5c-2.6-1.1-4.3-3.7-4.4-3.9-.1-.2-1-1.4-1-2.6s.6-1.8.9-2c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.4l.9 2.1c0 .2.1.3 0 .5l-.3.5-.4.5c-.2.1-.3.3-.1.6.1.3.7 1.1 1.4 1.8.9.9 1.7 1.1 2 1.3.2.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l2 .9c.2.1.4.2.4.3.1.1.1.6-.1 1.1Z" /></svg>
                  {t.debtors.whatsapp}
                </a>
              ) : (
                <span className="shrink-0 text-xs text-[var(--ink-5)]">{t.debtors.noPhone}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
