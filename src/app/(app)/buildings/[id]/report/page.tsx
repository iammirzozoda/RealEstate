"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { PrintIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { useSettings } from "@/lib/settings/SettingsProvider";
import { printDocument } from "@/lib/print";
import { formatCurrency, type Currency } from "@/lib/currency";
import { formatShortDate } from "@/lib/formatDate";
import { formatArea } from "@/lib/objects/format";
import { computeApartmentNumbers } from "@/lib/buildings/apartmentNumbers";
import type { Building } from "@/lib/buildings/types";
import type { ObjectStatus, PropertyObject } from "@/lib/objects/types";

type ContractRow = {
  id: string;
  object_id: string;
  number: string | null;
  amount: number;
  paid_amount: number;
  currency: Currency;
  status: string;
  created_by: string | null;
  client: { id: string; name: string; phone: string | null } | null;
};

type PaymentRow = {
  id: string;
  amount: number;
  paid_date: string | null;
  due_date: string;
  contract: {
    object_id: string;
    currency: Currency;
    number: string | null;
    client: { name: string } | null;
  } | null;
};

type Pair = { tjs: number; usd: number };
const addPair = (p: Pair, cur: Currency, v: number) => {
  if (cur === "USD") p.usd += v;
  else p.tjs += v;
};
function pairText(p: Pair): string {
  const parts: string[] = [];
  if (p.tjs > 0) parts.push(formatCurrency(p.tjs, "TJS"));
  if (p.usd > 0) parts.push(formatCurrency(p.usd, "USD"));
  return parts.length ? parts.join(" + ") : "—";
}

// Print colours: light fills so they read on paper even in greyscale, with a
// visible border. STATUS_COLORS use Tailwind bg-*-100 which the print engine
// drops when "background graphics" is off, so we spell out inline styles.
const CELL_STYLE: Record<ObjectStatus, React.CSSProperties> = {
  available: { background: "#ecfdf5", borderColor: "#6ee7b7", color: "#047857" },
  reserved: { background: "#fffbeb", borderColor: "#fcd34d", color: "#b45309" },
  sold: { background: "#fef2f2", borderColor: "#fca5a5", color: "#b91c1c" },
  rented: { background: "#eff6ff", borderColor: "#93c5fd", color: "#1d4ed8" },
  in_progress: { background: "#f5f3ff", borderColor: "#c4b5fd", color: "#6d28d9" },
};

const PLUM = "#5b3468";

// A full documentation dump of one building ("бэкап объекта"): sales summary,
// the shakhmatka snapshot, and a unit-by-unit table with buyers -- everything
// needed to file the object on paper / as a PDF. Opened from Settings; the
// Print button saves it as a PDF via the browser.
export default function BuildingReportPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const { settings } = useSettings();
  const [building, setBuilding] = useState<Building | null | undefined>(undefined);
  const [units, setUnits] = useState<PropertyObject[]>([]);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [paidByCurrency, setPaidByCurrency] = useState<Pair>({ tjs: 0, usd: 0 });
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  // created_by -> display name (email). Empty for non-admins (list_staff is
  // admin-gated), which quietly hides the manager section for them.
  const [staff, setStaff] = useState<Record<string, string>>({});

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: b } = await supabase
        .schema("crm")
        .from("buildings")
        .select("*")
        .eq("id", params.id)
        .maybeSingle();
      setBuilding((b as Building) ?? null);

      const { data: u } = await supabase
        .schema("crm")
        .from("objects")
        .select("*")
        .eq("building_id", params.id);
      const unitRows = (u ?? []) as PropertyObject[];
      setUnits(unitRows);

      if (unitRows.length === 0) return;
      const ids = unitRows.map((x) => x.id);
      const { data: c } = await supabase
        .schema("crm")
        .from("contracts")
        .select(
          "id, object_id, number, amount, paid_amount, currency, status, created_by, client:clients(id, name, phone)"
        )
        .in("object_id", ids);
      const contractRows = ((c ?? []) as unknown as ContractRow[]).filter(
        (x) => x.status !== "cancelled"
      );
      setContracts(contractRows);

      // Paid schedule rows: both the "received" total and the receipt history.
      const { data: pays } = await supabase
        .schema("crm")
        .from("contract_payments")
        .select(
          "id, amount, paid_date, due_date, contract:contracts(object_id, currency, number, client:clients(name))"
        )
        .eq("paid", true);
      const payRows = ((pays ?? []) as unknown as PaymentRow[]).filter(
        (p) => p.contract && ids.includes(p.contract.object_id)
      );
      const paid: Pair = { tjs: 0, usd: 0 };
      for (const p of payRows) {
        if (p.contract) addPair(paid, p.contract.currency, p.amount);
      }
      setPaidByCurrency(paid);
      payRows.sort((a, b) => (b.paid_date ?? b.due_date).localeCompare(a.paid_date ?? a.due_date));
      setPayments(payRows);

      // Staff names for the manager breakdown (admin-only RPC; harmless if empty).
      const { data: staffRows } = await supabase.schema("crm").rpc("list_staff");
      const map: Record<string, string> = {};
      for (const s of (staffRows ?? []) as Array<{ id: string; email: string }>) {
        map[s.id] = s.email;
      }
      setStaff(map);
    })();
  }, [params.id]);

  const apartmentNumbers = useMemo(() => computeApartmentNumbers(units), [units]);
  const contractByUnit = useMemo(() => {
    const m = new Map<string, ContractRow>();
    for (const c of contracts) m.set(c.object_id, c);
    return m;
  }, [contracts]);

  const stats = useMemo(() => {
    const counts: Record<ObjectStatus, number> = {
      available: 0,
      reserved: 0,
      sold: 0,
      rented: 0,
      in_progress: 0,
    };
    let totalArea = 0;
    let availableArea = 0;
    const contractValue: Pair = { tjs: 0, usd: 0 };
    const debt: Pair = { tjs: 0, usd: 0 };
    for (const u of units) {
      counts[u.status] += 1;
      totalArea += u.area ?? 0;
      if (u.status === "available") availableArea += u.area ?? 0;
    }
    for (const c of contracts) {
      addPair(contractValue, c.currency, c.amount);
      addPair(debt, c.currency, Math.max(0, c.amount - c.paid_amount));
    }
    return { counts, totalArea, availableArea, contractValue, debt };
  }, [units, contracts]);

  // Shakhmatka layout: blocks (entrances) ordered by first creation, floors top-down.
  const blocks = useMemo(() => {
    const first = new Map<string, string>();
    for (const u of units) {
      const b = u.block ?? "";
      const ts = u.created_at ?? "";
      const seen = first.get(b);
      if (seen === undefined || ts < seen) first.set(b, ts);
    }
    return [...first.keys()].sort((a, b) =>
      (first.get(a) ?? "").localeCompare(first.get(b) ?? "")
    );
  }, [units]);
  const floors = useMemo(
    () => [...new Set(units.map((u) => u.floor ?? 0))].sort((a, b) => b - a),
    [units]
  );

  const clientsList = useMemo(() => {
    const seen = new Map<string, { name: string; phone: string | null; count: number }>();
    for (const c of contracts) {
      if (!c.client) continue;
      const e = seen.get(c.client.id) ?? { name: c.client.name, phone: c.client.phone, count: 0 };
      e.count += 1;
      seen.set(c.client.id, e);
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [contracts]);

  // Sales per manager (whoever created the contract), within this building.
  const managerStats = useMemo(() => {
    const m = new Map<string, { name: string; deals: number; amount: Pair }>();
    for (const c of contracts) {
      const key = c.created_by ?? "—";
      const e = m.get(key) ?? {
        name: c.created_by ? staff[c.created_by] ?? "—" : "—",
        deals: 0,
        amount: { tjs: 0, usd: 0 },
      };
      e.deals += 1;
      addPair(e.amount, c.currency, c.amount);
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.deals - a.deals);
  }, [contracts, staff]);
  const showManagers = managerStats.some((m) => m.name !== "—");

  if (building === undefined) return <p className="text-slate-400">{t.common.loading}</p>;
  if (building === null) return <p className="text-slate-400">{t.buildings.notFound}</p>;

  const today = new Date().toISOString().slice(0, 10);
  const th = "border border-slate-300 px-2 py-1 text-left font-semibold";
  const td = "border border-slate-200 px-2 py-1";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackLink href={`/buildings/${params.id}`}>{t.buildings.backToList}</BackLink>
        <button
          type="button"
          onClick={() => printDocument("building-report")}
          className="btn-brand inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:shadow-md active:scale-[0.98]"
        >
          <PrintIcon /> {t.buildings.report.savePdf}
        </button>
      </div>

      <div
        id="building-report"
        className="mx-auto w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-8 text-[12px] text-slate-800 shadow-sm print:border-0 print:shadow-none"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b-2 pb-3" style={{ borderColor: PLUM }}>
          <div className="flex items-center gap-3">
            {settings.company_logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={settings.company_logo_url} alt="" className="h-12 w-12 object-contain" />
            )}
            <div>
              <p className="text-[15px] font-bold">{settings.company_name || t.appName}</p>
              {settings.company_address && (
                <p className="text-[10px] text-slate-500">{settings.company_address}</p>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
              {t.buildings.report.title}
            </p>
            <p className="text-[10px] text-slate-500">{today}</p>
          </div>
        </div>

        <h1 className="mt-3 text-xl font-bold" style={{ color: PLUM }}>
          {building.name}
        </h1>
        {building.address && <p className="text-[11px] text-slate-500">{building.address}</p>}

        {/* Summary tiles */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { label: t.dashboard.totalObjects, value: String(units.length) },
            { label: t.objects.statuses.sold, value: String(stats.counts.sold) },
            { label: t.objects.statuses.reserved, value: String(stats.counts.reserved) },
            { label: t.objects.statuses.available, value: String(stats.counts.available) },
            { label: t.dashboard.totalArea, value: formatArea(stats.totalArea) },
            { label: t.dashboard.areaForSale, value: formatArea(stats.availableArea) },
            { label: t.buildings.report.received, value: pairText(paidByCurrency) },
            { label: t.dashboard.totalDebt, value: pairText(stats.debt) },
          ].map((s) => (
            <div key={s.label} className="rounded-md border border-slate-200 px-2.5 py-1.5">
              <p className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">
                {s.label}
              </p>
              <p className="text-[13px] font-bold leading-tight">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Shakhmatka snapshot */}
        <h2 className="mt-5 text-[13px] font-bold uppercase tracking-wide" style={{ color: PLUM }}>
          {t.buildings.report.shakhmatka}
        </h2>
        <div className="mt-2 overflow-x-auto">
          {floors.map((floor) => (
            <div key={floor} className="mb-1 flex items-center gap-2">
              <span className="w-10 shrink-0 text-[9px] text-slate-400">
                {t.buildings.floorLabel} {floor}
              </span>
              <div className="flex flex-wrap gap-2">
                {blocks.map((block) => {
                  const cells = units
                    .filter((u) => (u.block ?? "") === block && (u.floor ?? 0) === floor)
                    .sort((a, b) => (a.position_in_floor ?? 0) - (b.position_in_floor ?? 0));
                  if (cells.length === 0) return null;
                  return (
                    <div key={block} className="flex gap-1">
                      {cells.map((u) => (
                        <span
                          key={u.id}
                          style={{ ...CELL_STYLE[u.status], borderWidth: 1, borderStyle: "solid" }}
                          className="flex h-7 w-9 items-center justify-center rounded text-[10px] font-bold"
                        >
                          {apartmentNumbers.get(u.id) ?? "—"}
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="mt-2 flex flex-wrap gap-3 text-[9px] text-slate-500">
          {(["available", "reserved", "sold"] as ObjectStatus[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span
                style={{ ...CELL_STYLE[s], borderWidth: 1, borderStyle: "solid" }}
                className="inline-block h-2.5 w-2.5 rounded"
              />
              {t.objects.statuses[s]}
            </span>
          ))}
        </div>

        {/* Units table with buyers */}
        <h2
          className="mt-5 text-[13px] font-bold uppercase tracking-wide print:break-before-page"
          style={{ color: PLUM }}
        >
          {t.buildings.report.units}
        </h2>
        <div className="overflow-x-auto">
        <table className="mt-2 w-full min-w-[640px] border-collapse text-[10px]">
          <thead>
            <tr style={{ background: "#faf6fc" }}>
              <th className={th}>№</th>
              <th className={th}>{t.buildings.report.block}</th>
              <th className={th}>{t.buildings.floorLabel}</th>
              <th className={th}>{t.buildings.floorBuilder.area}</th>
              <th className={th}>{t.contracts.form.status}</th>
              <th className={th}>{t.buildings.report.buyer}</th>
              <th className={th}>{t.contracts.form.amount}</th>
              <th className={th}>{t.contracts.form.paidAmount}</th>
              <th className={th}>{t.buildings.hover.remaining}</th>
            </tr>
          </thead>
          <tbody>
            {[...units]
              .sort(
                (a, b) =>
                  (apartmentNumbers.get(a.id) ?? 0) - (apartmentNumbers.get(b.id) ?? 0)
              )
              .map((u) => {
                const c = contractByUnit.get(u.id);
                const remaining = c ? Math.max(0, c.amount - c.paid_amount) : 0;
                return (
                  <tr key={u.id}>
                    <td className={`${td} font-semibold`}>{apartmentNumbers.get(u.id) ?? "—"}</td>
                    <td className={td}>{u.block || "—"}</td>
                    <td className={td}>{u.floor ?? "—"}</td>
                    <td className={td}>{u.area != null ? formatArea(u.area) : "—"}</td>
                    <td className={td} style={{ color: CELL_STYLE[u.status].color }}>
                      {t.objects.statuses[u.status]}
                    </td>
                    <td className={td}>{c?.client?.name ?? "—"}</td>
                    <td className={td}>{c ? formatCurrency(c.amount, c.currency) : "—"}</td>
                    <td className={td}>{c ? formatCurrency(c.paid_amount, c.currency) : "—"}</td>
                    <td className={td}>{c && remaining > 0 ? formatCurrency(remaining, c.currency) : "—"}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
        </div>

        {/* Clients */}
        {clientsList.length > 0 && (
          <>
            <h2 className="mt-5 text-[13px] font-bold uppercase tracking-wide" style={{ color: PLUM }}>
              {t.buildings.report.clients} ({clientsList.length})
            </h2>
            <div className="overflow-x-auto">
            <table className="mt-2 w-full border-collapse text-[10px]">
              <thead>
                <tr style={{ background: "#faf6fc" }}>
                  <th className={th}>{t.clients.table.name}</th>
                  <th className={th}>{t.clients.table.phone}</th>
                  <th className={th}>{t.buildings.report.unitsCount}</th>
                </tr>
              </thead>
              <tbody>
                {clientsList.map((cl) => (
                  <tr key={cl.name}>
                    <td className={td}>{cl.name}</td>
                    <td className={td}>{cl.phone || "—"}</td>
                    <td className={td}>{cl.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}

        {/* Manager breakdown (admin only -- staff map is empty otherwise) */}
        {showManagers && (
          <>
            <h2 className="mt-5 text-[13px] font-bold uppercase tracking-wide" style={{ color: PLUM }}>
              {t.buildings.report.managers}
            </h2>
            <div className="overflow-x-auto">
            <table className="mt-2 w-full border-collapse text-[10px]">
              <thead>
                <tr style={{ background: "#faf6fc" }}>
                  <th className={th}>{t.buildings.report.manager}</th>
                  <th className={th}>{t.buildings.report.deals}</th>
                  <th className={th}>{t.contracts.form.amount}</th>
                </tr>
              </thead>
              <tbody>
                {managerStats.map((m, i) => (
                  <tr key={i}>
                    <td className={td}>{m.name}</td>
                    <td className={td}>{m.deals}</td>
                    <td className={td}>{pairText(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}

        {/* Payment history -- every receipt taken on this building */}
        {payments.length > 0 && (
          <>
            <h2
              className="mt-5 text-[13px] font-bold uppercase tracking-wide print:break-before-page"
              style={{ color: PLUM }}
            >
              {t.buildings.report.payments} ({payments.length})
            </h2>
            <div className="overflow-x-auto">
            <table className="mt-2 w-full border-collapse text-[10px]">
              <thead>
                <tr style={{ background: "#faf6fc" }}>
                  <th className={th}>{t.buildings.report.receiptDate}</th>
                  <th className={th}>№</th>
                  <th className={th}>{t.buildings.report.buyer}</th>
                  <th className={th}>{t.contracts.payments.amount}</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className={td}>{formatShortDate(p.paid_date ?? p.due_date)}</td>
                    <td className={td}>{p.contract?.number ?? "—"}</td>
                    <td className={td}>{p.contract?.client?.name ?? "—"}</td>
                    <td className={`${td} font-semibold`}>
                      {formatCurrency(p.amount, p.contract?.currency ?? "TJS")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </>
        )}

        <p className="mt-6 text-right text-[9px] text-slate-400">
          {settings.company_name || t.appName} · {today}
        </p>
      </div>
    </div>
  );
}
