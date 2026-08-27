"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { useRole } from "@/lib/auth/useRole";
import { useConfirm } from "@/components/ConfirmDialog";
import { SetupNotice } from "@/components/SetupNotice";
import { ContractBookingModal } from "@/components/ContractBookingModal";
import { ControlGroup, PillButton } from "@/components/ActionBar";
import { formatCurrency } from "@/lib/currency";
import { formatArea } from "@/lib/objects/format";
import { STATUS_HUES } from "@/components/charts/palette";
import { OBJECT_TYPES, type ObjectStatus, type ObjectType, type PropertyObject } from "@/lib/objects/types";
import type { UnitContractInfo } from "@/components/ShakhmatkaGrid";

type RentalUnit = PropertyObject & { building: { name: string } | null };

const RENTAL_STATUS_FILTERS: Array<ObjectStatus | "all"> = ["all", "available", "reserved", "rented"];

// Its own page, not nested under a building -- rent is a separate line of
// work from the shakhmatka (a warehouse/storage unit rarely belongs to the
// same floor/position layout an apartment grid is drawn from, and staff
// managing leases across every building shouldn't have to open each one to
// see what's rented). Every object here has listing_type = 'rent'; the
// shakhmatka never shows one, see buildings/[id]/page.tsx's saleUnits.
export default function RentalsPage() {
  const { t } = useLocale();
  const { role } = useRole();
  const confirm = useConfirm();
  const pathname = usePathname();
  const configured = isSupabaseConfigured();
  const canEdit = role === "admin";

  const [units, setUnits] = useState<RentalUnit[]>([]);
  const [contractsByUnit, setContractsByUnit] = useState<Record<string, UnitContractInfo>>({});
  const [buildings, setBuildings] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<ObjectStatus | "all">("all");
  const [bookingUnit, setBookingUnit] = useState<PropertyObject | null>(null);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [type, setType] = useState<ObjectType>("commercial");
  const [addBuildingId, setAddBuildingId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!configured) return;
    setLoading(true);
    const supabase = createClient();
    const [unitsRes, contractsRes, paymentsRes, buildingsRes] = await Promise.all([
      supabase
        .schema("crm")
        .from("objects")
        .select("*, building:buildings(name)")
        .eq("listing_type", "rent")
        .order("name"),
      supabase
        .schema("crm")
        .from("contracts")
        .select(
          "id, object_id, amount, paid_amount, currency, client:clients(name, phone, source), object:objects!inner(listing_type)"
        )
        .eq("object.listing_type", "rent"),
      supabase
        .schema("crm")
        .from("contract_payments")
        .select("contract_id, contract:contracts!inner(object:objects!inner(listing_type))")
        .eq("paid", true)
        .eq("contract.object.listing_type", "rent"),
      supabase.schema("crm").from("buildings").select("id, name").order("name"),
    ]);

    setUnits((unitsRes.data ?? []) as unknown as RentalUnit[]);
    setBuildings((buildingsRes.data ?? []) as Array<{ id: string; name: string }>);

    const contractRows = (contractsRes.data ?? []) as unknown as Array<{
      id: string;
      object_id: string;
      amount: number;
      paid_amount: number;
      currency: UnitContractInfo["currency"];
      client: { name: string; phone: string | null; source: string | null } | null;
    }>;
    const paymentsCountByContract: Record<string, number> = {};
    for (const p of (paymentsRes.data ?? []) as Array<{ contract_id: string }>) {
      paymentsCountByContract[p.contract_id] = (paymentsCountByContract[p.contract_id] ?? 0) + 1;
    }
    const map: Record<string, UnitContractInfo> = {};
    for (const c of contractRows) {
      map[c.object_id] = {
        id: c.id,
        clientName: c.client?.name ?? "—",
        clientPhone: c.client?.phone ?? null,
        amount: c.amount,
        paid: c.paid_amount,
        remaining: c.amount - c.paid_amount,
        currency: c.currency,
        paymentsCount: paymentsCountByContract[c.id] ?? 0,
        isQuickBooking: false,
      };
    }
    setContractsByUnit(map);
    setLoading(false);
  }, [configured]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredUnits = useMemo(
    () => (statusFilter === "all" ? units : units.filter((u) => u.status === statusFilter)),
    [units, statusFilter]
  );

  const cashDesk = (contractId: string) =>
    `/contracts/${contractId}/payments?from=${encodeURIComponent(pathname)}`;

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.schema("crm").from("objects").insert({
      name: name.trim(),
      type,
      status: "available",
      listing_type: "rent",
      area: area ? Number(area) : null,
      building_id: addBuildingId || null,
      span: 1,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setName("");
    setArea("");
    setAddBuildingId("");
    setAdding(false);
    load();
  };

  const handleDelete = async (unit: PropertyObject) => {
    const ok = await confirm(t.buildings.rental.deleteConfirm, { danger: true });
    if (!ok) return;
    const supabase = createClient();
    await supabase.schema("crm").from("objects").delete().eq("id", unit.id);
    load();
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">{t.buildings.rental.title}</h1>
        <p className="text-sm text-[var(--ink-4)]">{t.buildings.rental.subtitle}</p>
      </div>

      {!configured && <SetupNotice />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ControlGroup>
          {RENTAL_STATUS_FILTERS.map((s) => (
            <PillButton
              key={s}
              label={s === "all" ? t.tasks.filters.allStatuses : t.objects.statuses[s]}
              active={statusFilter === s}
              onClick={() => setStatusFilter(s)}
            />
          ))}
        </ControlGroup>
        {canEdit && !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-fit rounded-lg border border-[var(--field-border)] px-3 py-1.5 text-sm font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--hover-c)]"
          >
            {t.buildings.rental.add}
          </button>
        )}
      </div>

      {adding && (
        <form
          onSubmit={handleAdd}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border-c)] bg-[var(--surface-2)] p-3.5"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-[var(--ink-3)]">{t.buildings.rental.name}</span>
            <input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.buildings.rental.namePlaceholder}
              className="h-9 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-[var(--ink-3)]">{t.buildings.rental.building}</span>
            <select
              value={addBuildingId}
              onChange={(e) => setAddBuildingId(e.target.value)}
              className="h-9 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            >
              <option value="">{t.buildings.rental.noBuilding}</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-[var(--ink-3)]">{t.buildings.rental.area}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="h-9 w-28 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-[var(--ink-3)]">{t.buildings.rental.type}</span>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as ObjectType)}
              className="h-9 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-2.5 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            >
              {OBJECT_TYPES.map((ot) => (
                <option key={ot} value={ot}>
                  {t.objects.types[ot]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="h-9 rounded-lg bg-brand px-3.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {t.buildings.rental.save}
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="h-9 rounded-lg border border-[var(--field-border)] px-3.5 text-xs font-medium text-[var(--ink-2)] hover:bg-[var(--hover-c)]"
            >
              {t.buildings.rental.cancel}
            </button>
          </div>
          {error && <p className="w-full text-xs text-[var(--wash-rose-ink)]">{error}</p>}
        </form>
      )}

      {loading ? (
        <p className="text-[var(--ink-5)]">{t.common.loading}</p>
      ) : filteredUnits.length === 0 ? (
        <p className="text-sm text-[var(--ink-5)]">{t.buildings.rental.empty}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredUnits.map((unit) => {
            const contractInfo = contractsByUnit[unit.id];
            return (
              <div
                key={unit.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: STATUS_HUES[unit.status].solid }}
                  />
                  <div className="min-w-0">
                    <Link
                      href={`/objects/${unit.id}`}
                      className="-mx-1 truncate rounded px-1 font-medium text-[var(--ink-1)] transition-colors hover:bg-[var(--hover-c2)]"
                    >
                      {unit.name}
                    </Link>
                    <p className="text-xs text-[var(--ink-4)]">
                      {[
                        unit.building?.name,
                        t.objects.types[unit.type],
                        unit.area != null ? formatArea(unit.area) : null,
                        t.objects.statuses[unit.status],
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>

                {contractInfo ? (
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs text-[var(--ink-5)]">{t.buildings.rental.tenant}</p>
                      <p className="text-sm font-medium text-[var(--ink-2)]">
                        {contractInfo.clientName}
                      </p>
                    </div>
                    {contractInfo.remaining > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-[var(--ink-5)]">{t.buildings.hover.remaining}</p>
                        <p className="text-sm font-semibold text-[var(--wash-rose-ink)]">
                          {formatCurrency(contractInfo.remaining, contractInfo.currency)}
                        </p>
                      </div>
                    )}
                    <Link
                      href={cashDesk(contractInfo.id)}
                      className="shrink-0 rounded-lg border border-[var(--field-border)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--hover-c)]"
                    >
                      {t.buildings.rental.paymentsAction}
                    </Link>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-2">
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleDelete(unit)}
                        className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--wash-rose-ink)] transition-colors hover:bg-[var(--wash-rose)]"
                      >
                        {t.common.confirmDeleteBtn}
                      </button>
                    )}
                    {role !== "director" && (
                      <button
                        type="button"
                        onClick={() => setBookingUnit(unit)}
                        className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98]"
                      >
                        {t.buildings.rental.bookAction}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {bookingUnit && (
        <ContractBookingModal
          unit={bookingUnit}
          buildingName={
            (units.find((u) => u.id === bookingUnit.id) as RentalUnit | undefined)?.building?.name ?? null
          }
          apartmentNumber={undefined}
          onClose={() => setBookingUnit(null)}
          onBooked={load}
        />
      )}
    </div>
  );
}
