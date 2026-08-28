"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import { SetupNotice } from "@/components/SetupNotice";
import {
  ShakhmatkaGrid,
  ShakhmatkaFilters,
  type UnitContractInfo,
  type GapFilter,
} from "@/components/ShakhmatkaGrid";
import { ContractBookingModal } from "@/components/ContractBookingModal";
import { QuickAddUnitModal } from "@/components/QuickAddUnitModal";
import { UnitEditModal } from "@/components/UnitEditModal";
import { Toast, type ToastType } from "@/components/Toast";
import { ConstructionStatusBadge } from "@/components/ConstructionStatusBadge";
import { DuplicateBuildingModal } from "@/components/DuplicateBuildingModal";
import { PlanViewerModal } from "@/components/PlanViewerModal";
import {
  DocumentIcon,
  PencilIcon,
  GearIcon,
  DuplicateIcon,
  BlueprintIcon,
} from "@/components/icons";
import { IconAction, IconToolbar } from "@/components/ActionBar";
import { computeApartmentNumbers } from "@/lib/buildings/apartmentNumbers";
import type { Building } from "@/lib/buildings/types";
import type { ObjectStatus, PropertyObject } from "@/lib/objects/types";
import { useRole } from "@/lib/auth/useRole";

export default function BuildingDetailPage() {
  const { t } = useLocale();
  const confirm = useConfirm();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const configured = isSupabaseConfigured();

  // Seeded from `configured` rather than set from inside the effect: the
  // flag is a build-time env check, constant for the whole session, so the
  // not-configured case is a starting value, not something to synchronise.
  const [building, setBuilding] = useState<Building | null | undefined>(
    configured ? undefined : null
  );
  const [units, setUnits] = useState<PropertyObject[]>([]);
  // The shakhmatka (and everything numbered/laid-out like one -- filters,
  // apartment numbering, "duplicate building") only ever means units meant
  // for SALE. Units marked listing_type = 'rent' (warehouses, storage --
  // whatever this building rents out instead of sells) live entirely on
  // their own page (/rentals, across every building at once), not here.
  const saleUnits = useMemo(() => units.filter((u) => u.listing_type !== "rent"), [units]);
  const [contractsByUnit, setContractsByUnit] = useState<Record<string, UnitContractInfo>>(
    {}
  );
  const [bookingUnit, setBookingUnit] = useState<PropertyObject | null>(null);
  const [viewingUnit, setViewingUnit] = useState<PropertyObject | null>(null);
  const [addingUnit, setAddingUnit] = useState<{
    floor: number;
    block: string;
    position: number;
  } | null>(null);
  const [pendingQuickBook, setPendingQuickBook] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState(false);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [showPlan, setShowPlan] = useState(false);
  // Filter state lives here, not in the grid: the bar that drives it now sits
  // in the page header beside the toolbar, while the cells it dims are inside
  // the grid.
  const [statusFilter, setStatusFilter] = useState<ObjectStatus | null>(null);
  const [roomsFilter, setRoomsFilter] = useState<number | null>(null);
  // "Which flats are missing a price / an area" -- the gap the dashboard
  // reports as a number with nowhere to go and look at it.
  const [gapFilter, setGapFilter] = useState<GapFilter>(null);
  // A stack of reversible structural edits (merge / split / delete / add) made
  // this session, so a mis-click can be undone with one button -- the data is
  // captured before each action and re-applied on undo.
  const [undoStack, setUndoStack] = useState<Array<{ label: string; run: () => Promise<void> }>>(
    []
  );
  const [toast, setToast] = useState<{ message: string | null; type: ToastType }>({
    message: null,
    type: "success",
  });
  const { role } = useRole();

  const pushUndo = (label: string, run: () => Promise<void>) =>
    setUndoStack((s) => [...s.slice(-9), { label, run }]);

  // Columns we can safely re-insert to bring a deleted/merged-away unit back.
  const reinsertPayload = (u: PropertyObject) => ({
    id: u.id,
    building_id: u.building_id,
    name: u.name,
    address: u.address ?? null,
    type: u.type,
    status: "available" as const,
    area: u.area,
    price: u.price,
    currency: u.currency,
    rooms: u.rooms,
    floor: u.floor,
    block: u.block,
    position_in_floor: u.position_in_floor,
    span: u.span ?? 1,
    manual_reserved: false,
    description: u.description ?? null,
    plan_url: u.plan_url ?? null,
  });

  const apartmentNumbers = useMemo(() => computeApartmentNumbers(saleUnits), [saleUnits]);

  // All three queries go out AT ONCE. They used to be a strict chain -- fetch
  // the units, then fetch the contracts for those unit ids, then fetch the
  // payments for those contract ids -- so the shakhmatka cost three full
  // round trips stacked end to end before it could draw anything. Nothing
  // actually needed the previous result: "the contracts of this building" and
  // "the paid installments of this building" are expressible directly by
  // filtering through the relationship, which is what the !inner joins below
  // do. Same data, one round trip's worth of waiting instead of three.
  const loadUnits = useCallback(async () => {
    const supabase = createClient();
    const [unitsRes, contractsRes, paymentsRes] = await Promise.all([
      supabase.schema("crm").from("objects").select("*").eq("building_id", params.id),
      supabase
        .schema("crm")
        .from("contracts")
        .select(
          "id, object_id, amount, paid_amount, currency, client:clients(name, phone, source), object:objects!inner(building_id)"
        )
        .eq("object.building_id", params.id),
      supabase
        .schema("crm")
        .from("contract_payments")
        .select("contract_id, contract:contracts!inner(object:objects!inner(building_id))")
        .eq("paid", true)
        .eq("contract.object.building_id", params.id),
    ]);

    setUnits((unitsRes.data ?? []) as PropertyObject[]);

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
        isQuickBooking: c.client?.source === "quick_booking" && c.paid_amount === 0,
      };
    }
    setContractsByUnit(map);
  }, [params.id]);

  useEffect(() => {
    if (!configured) return;
    const supabase = createClient();
    supabase
      .schema("crm")
      .from("buildings")
      .select("*")
      .eq("id", params.id)
      .maybeSingle()
      .then(({ data }) => setBuilding((data as Building) ?? null));
    loadUnits();
  }, [configured, params.id, loadUnits]);

  // Changing the price per m² on the edit screen recalculates the apartments,
  // and this is the screen where that becomes visible -- so it also carries
  // the receipt: how many actually moved. Derived from the URL during render
  // rather than pushed into state from an effect, which would be a second
  // render for something already known on the first.
  const rateParam = searchParams.get("rate");
  const clearedParam = searchParams.get("cleared");
  const repriceNotice = useMemo(() => {
    if (clearedParam !== null) {
      return {
        message: t.buildings.form.clearPricesDone.replace("{n}", clearedParam),
        type: "success" as ToastType,
      };
    }
    if (rateParam === "applied") {
      return { message: t.buildings.form.rateApplied, type: "success" as ToastType };
    }
    return null;
  }, [rateParam, clearedParam, t]);

  const handleMergeUnits = async (unitA: PropertyObject, unitB: PropertyObject) => {
    const combinedArea = (unitA.area ?? 0) + (unitB.area ?? 0) || null;
    const combinedPrice =
      combinedArea && building?.price_per_sqm
        ? combinedArea * building.price_per_sqm
        : (unitA.price ?? 0) + (unitB.price ?? 0) || null;
    const supabase = createClient();
    // Snapshot before so a merge can be fully undone (restore A, bring B back).
    const aBefore = { name: unitA.name, area: unitA.area, price: unitA.price, span: unitA.span ?? 1 };
    const bRow = reinsertPayload(unitB);
    await supabase
      .schema("crm")
      .from("objects")
      .update({
        name: unitA.block
          ? `${unitA.block} №${unitA.floor}-${unitA.position_in_floor}-${unitB.position_in_floor}`
          : `№${unitA.floor}-${unitA.position_in_floor}-${unitB.position_in_floor}`,
        area: combinedArea,
        price: combinedPrice,
        span: (unitA.span || 1) + (unitB.span || 1),
      })
      .eq("id", unitA.id);
    await supabase.schema("crm").from("objects").delete().eq("id", unitB.id);
    await loadUnits();
    pushUndo(t.buildings.cellActions.merge, async () => {
      const sb = createClient();
      await sb.schema("crm").from("objects").update(aBefore).eq("id", unitA.id);
      await sb.schema("crm").from("objects").insert(bRow);
    });
    setToast({ message: t.buildings.cellActions.merged, type: "success" });
  };

  // Split a merged (span>1) cell back into individual cells: shrink it to
  // span 1 and recreate the positions it had swallowed as fresh available
  // units. This is the direct "undo my merge" the shakhmatka needed.
  const handleSplitUnit = async (unit: PropertyObject) => {
    const span = unit.span || 1;
    if (span < 2 || role !== "admin") return;
    const supabase = createClient();
    const before = { area: unit.area, price: unit.price, name: unit.name, span };
    const basePos = unit.position_in_floor ?? 0;
    // Merging summed the cells' area/price into this one; splitting hands each
    // resulting cell an even share, so the booking window keeps its area and
    // price-per-m² instead of going blank on the new cells.
    const perArea = unit.area != null ? Math.round((unit.area / span) * 100) / 100 : null;
    const perPrice = unit.price != null ? Math.round((unit.price / span) * 100) / 100 : null;
    const newRows = [];
    for (let k = 1; k < span; k++) {
      newRows.push({
        building_id: unit.building_id,
        name: unit.block
          ? `${unit.block} №${unit.floor}-${basePos + k}`
          : `№${unit.floor}-${basePos + k}`,
        type: unit.type,
        status: "available" as const,
        currency: unit.currency,
        area: perArea,
        price: perPrice,
        rooms: unit.rooms,
        floor: unit.floor,
        block: unit.block,
        position_in_floor: basePos + k,
        span: 1,
      });
    }
    // The cell that stays keeps span 1, its own even share, and a single-cell
    // name (it was carrying the merged "№5-1-2" name).
    await supabase
      .schema("crm")
      .from("objects")
      .update({
        span: 1,
        area: perArea,
        price: perPrice,
        name: unit.block
          ? `${unit.block} №${unit.floor}-${basePos}`
          : `№${unit.floor}-${basePos}`,
      })
      .eq("id", unit.id);
    const { data: created } = await supabase
      .schema("crm")
      .from("objects")
      .insert(newRows)
      .select("id");
    await loadUnits();
    const createdIds = ((created ?? []) as Array<{ id: string }>).map((r) => r.id);
    pushUndo(t.buildings.cellActions.split, async () => {
      const sb = createClient();
      if (createdIds.length) await sb.schema("crm").from("objects").delete().in("id", createdIds);
      await sb
        .schema("crm")
        .from("objects")
        .update({ span: before.span, area: before.area, price: before.price, name: before.name })
        .eq("id", unit.id);
    });
    setToast({ message: t.buildings.cellActions.splitDone, type: "success" });
  };

  // Delete one cell (admin, edit mode). Reversible via undo -- the row is
  // captured and re-inserted with its original id.
  const handleDeleteUnit = async (unit: PropertyObject) => {
    if (role !== "admin") return;
    if (contractsByUnit[unit.id]) {
      setToast({ message: t.buildings.cellActions.cannotDeleteSold, type: "error" });
      return;
    }
    if (!(await confirm(t.buildings.cellActions.confirmDelete, { danger: true }))) return;
    const supabase = createClient();
    const row = reinsertPayload(unit);
    const { error } = await supabase.schema("crm").from("objects").delete().eq("id", unit.id);
    if (error) {
      setToast({ message: error.message, type: "error" });
      return;
    }
    await loadUnits();
    pushUndo(t.buildings.cellActions.delete, async () => {
      const sb = createClient();
      await sb.schema("crm").from("objects").insert(row);
    });
    setToast({ message: t.buildings.cellActions.deleted, type: "success" });
  };

  const handleUndo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((s) => s.slice(0, -1));
    try {
      await last.run();
      await loadUnits();
      setToast({ message: t.buildings.cellActions.undone, type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : t.common.error,
        type: "error",
      });
      await loadUnits();
    }
  };

  // Right-click toggles a hand reservation on the unit itself -- no
  // contract, no client attached, exactly "придержи эту квартиру". The
  // toggle is one SECURITY DEFINER RPC that flips objects.manual_reserved
  // and recomputes the status, so a second right-click always frees the
  // unit back up.
  const handleQuickBook = async (unit: PropertyObject) => {
    if (role === "director") return;
    if (pendingQuickBook.has(unit.id)) return;
    const existing = contractsByUnit[unit.id];
    if (existing) {
      // Legacy placeholder bookings (old flow that created a stub contract)
      // still cancel; a real buyer's contract explains itself instead of
      // silently doing nothing.
      if (existing.isQuickBooking) {
        await handleCancelQuickBook(unit, existing.id);
      } else {
        setToast({ message: t.buildings.cannotUnbookReal, type: "error" });
      }
      return;
    }

    setPendingQuickBook((prev) => new Set(prev).add(unit.id));
    const supabase = createClient();
    try {
      const { data, error } = await supabase
        .schema("crm")
        .rpc("toggle_manual_reservation", { p_object_id: unit.id });
      if (error) throw new Error(error.message);
      const nowReserved = Boolean(data);

      // Instant local feedback; a later reload reconciles with the server.
      setUnits((prev) =>
        prev.map((u) =>
          u.id === unit.id
            ? {
                ...u,
                manual_reserved: nowReserved,
                status: nowReserved ? "reserved" : "available",
              }
            : u
        )
      );
      setToast({
        message: nowReserved ? t.buildings.quickBooked : t.buildings.quickBookCancelled,
        type: "success",
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : t.common.error,
        type: "error",
      });
      await loadUnits();
    } finally {
      setPendingQuickBook((prev) => {
        const next = new Set(prev);
        next.delete(unit.id);
        return next;
      });
    }
  };

  // Right-click again on a unit that was quick-booked (and still has
  // nothing paid on it) undoes it -- deletes that placeholder contract and
  // frees the unit back up. Only ever targets the shared placeholder
  // client's own untouched bookings (guarded by isQuickBooking above), so
  // this can never silently delete a real buyer's contract or one with a
  // payment already recorded against it.
  const handleCancelQuickBook = async (unit: PropertyObject, contractId: string) => {
    if (pendingQuickBook.has(unit.id)) return;
    setPendingQuickBook((prev) => new Set(prev).add(unit.id));
    const supabase = createClient();
    try {
      const { error } = await supabase.schema("crm").rpc("cancel_quick_booking", {
        p_contract_id: contractId,
      });
      if (error) throw new Error(error.message);

      setUnits((prev) =>
        prev.map((u) => (u.id === unit.id ? { ...u, status: "available" } : u))
      );
      setContractsByUnit((prev) => {
        const next = { ...prev };
        delete next[unit.id];
        return next;
      });
      setToast({ message: t.buildings.quickBookCancelled, type: "success" });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : t.common.error,
        type: "error",
      });
    } finally {
      setPendingQuickBook((prev) => {
        const next = new Set(prev);
        next.delete(unit.id);
        return next;
      });
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <BackLink href="/buildings">{t.buildings.backToList}</BackLink>

      {!configured && <SetupNotice />}

      {configured && building === undefined && (
        <p className="text-[var(--ink-5)]">{t.common.loading}</p>
      )}
      {configured && building === null && (
        <p className="text-[var(--ink-5)]">{t.buildings.notFound}</p>
      )}

      {building && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-semibold">{building.name}</h1>
                <ConstructionStatusBadge status={building.construction_status} />
              </div>
              {building.address && <p className="text-sm text-[var(--ink-4)]">{building.address}</p>}
            </div>
            {/* Four wide labelled buttons became one icon toolbar: the row
                took most of the header and pushed the building's own name
                and address into a corner. Each icon names itself on hover
                (and via title/aria-label for touch and screen readers).
                The plan sits in the same group but OUTSIDE the admin check:
                the person who needs the floor plan open is the manager
                sitting with a buyer, and the rest of this toolbar edits the
                building, which they may not do. It appears only when a plan
                has actually been uploaded. */}
            {/* Filters and actions share one right-hand cluster, both at the
                small size so they line up as a single band instead of a tall
                icon row above a separate strip of chips. min-w-0: this is
                itself a flex item (of the title/toolbar row above), and a
                flex item's default min-width is its content's width, not 0
                -- without this, the browser would still treat "everything
                ShakhmatkaFilters needs unwrapped" as this row's own floor,
                even though ShakhmatkaFilters' own ControlGroup is already
                free to shrink and scroll. */}
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {saleUnits.length > 0 && (
              <ShakhmatkaFilters
                units={saleUnits}
                statusFilter={statusFilter}
                onStatusChange={setStatusFilter}
                roomsFilter={roomsFilter}
                onRoomsChange={setRoomsFilter}
                gapFilter={gapFilter}
                onGapChange={setGapFilter}
              />
            )}
            {/* Guarded as a whole: ControlGroup always draws its bordered
                box, so rendering it for a manager looking at a building with
                no plan would leave an empty bordered stub in the header. */}
            {(building.plan_url || role === "admin") && (
            <IconToolbar size="sm">
              {building.plan_url && (
                <IconAction
                  label={t.buildings.planTitle}
                  icon={<BlueprintIcon className="h-4 w-4" />}
                  onClick={() => setShowPlan(true)}
                />
              )}
              {role === "admin" && (
                <>
                <IconAction
                  label={editMode ? t.buildings.editModeOn : t.buildings.editMode}
                  icon={<PencilIcon className="h-4 w-4" />}
                  active={editMode}
                  onClick={() => setEditMode((v) => !v)}
                />
                <IconAction
                  label={t.buildings.report.savePdf}
                  icon={<DocumentIcon className="h-4 w-4" />}
                  href={`/buildings/${building.id}/report`}
                />
                <IconAction
                  label={t.buildings.configure}
                  icon={<GearIcon className="h-4 w-4" />}
                  tone="brand"
                  href={`/buildings/${building.id}/edit`}
                />
                <IconAction
                  label={t.buildings.duplicate.button}
                  icon={<DuplicateIcon className="h-4 w-4" />}
                  onClick={() => setShowDuplicate(true)}
                />
                </>
              )}
            </IconToolbar>
            )}
            </div>
          </div>

          {showPlan && building.plan_url && (
            <PlanViewerModal
              title={t.buildings.planTitle}
              url={building.plan_url}
              onClose={() => setShowPlan(false)}
            />
          )}

          {showDuplicate && (
            <DuplicateBuildingModal
              building={building}
              units={saleUnits}
              onClose={() => setShowDuplicate(false)}
            />
          )}

          {editMode && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--wash-amber-border)] bg-[var(--wash-amber)] px-4 py-2 text-sm text-[var(--wash-amber-ink)]">
              <span>{t.buildings.editModeHint}</span>
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--wash-amber-ink)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-semibold text-[var(--wash-amber-ink)] transition-all hover:bg-[var(--wash-amber)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span aria-hidden="true">↶</span>
                {t.buildings.cellActions.undo}
                {undoStack.length > 0 && ` (${undoStack.length})`}
              </button>
            </div>
          )}

          <ShakhmatkaGrid
            editMode={editMode}
            units={saleUnits}
            contractsByUnit={contractsByUnit}
            readOnly={role === "director"}
            onBookUnit={setBookingUnit}
            onQuickBook={handleQuickBook}
            onCancelQuickBook={handleCancelQuickBook}
            onAddUnit={(floor, block, position) => setAddingUnit({ floor, block, position })}
            pendingUnitIds={pendingQuickBook}
            onMergeUnits={handleMergeUnits}
            onSplitUnit={handleSplitUnit}
            onDeleteUnit={handleDeleteUnit}
            canEditSold={role === "admin"}
            onViewUnit={setViewingUnit}
            statusFilter={statusFilter}
            roomsFilter={roomsFilter}
            gapFilter={gapFilter}
          />

          {addingUnit && (
            <QuickAddUnitModal
              buildingId={building.id}
              floor={addingUnit.floor}
              block={addingUnit.block}
              position={addingUnit.position}
              siblingUnit={units.find(
                (u) => (u.block ?? "") === addingUnit.block && u.position_in_floor === addingUnit.position
              )}
              onClose={() => setAddingUnit(null)}
              onAdded={loadUnits}
            />
          )}

          {bookingUnit && (
            <ContractBookingModal
              unit={bookingUnit}
              buildingName={building.name}
              apartmentNumber={apartmentNumbers.get(bookingUnit.id)}
              onClose={() => setBookingUnit(null)}
              onBooked={loadUnits}
            />
          )}

          {viewingUnit && (
            <UnitEditModal
              unit={viewingUnit}
              allUnits={units}
              apartmentNumber={apartmentNumbers.get(viewingUnit.id)}
              pricePerSqm={building.price_per_sqm}
              canEdit={role === "admin"}
              onClose={() => setViewingUnit(null)}
              onSaved={() => {
                loadUnits();
              }}
            />
          )}
        </>
      )}
      <Toast
        message={toast.message ?? repriceNotice?.message ?? null}
        type={toast.message ? toast.type : (repriceNotice?.type ?? "success")}
        onDismiss={() => {
          setToast((prev) => ({ ...prev, message: null }));
          // Drop ?repriced= so a refresh does not replay the receipt.
          if (rateParam !== null || clearedParam !== null) router.replace(`/buildings/${params.id}`);
        }}
      />
    </div>
  );
}
