"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/isConfigured";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { useConfirm } from "@/components/ConfirmDialog";
import { BackLink } from "@/components/BackLink";
import { SetupNotice } from "@/components/SetupNotice";
import { BuildingForm } from "@/components/BuildingForm";
import { FloorUnitsBuilder } from "@/components/FloorUnitsBuilder";
import { useRole } from "@/lib/auth/useRole";
import type { Building, BuildingInput } from "@/lib/buildings/types";
import { emptyBuildingInput } from "@/lib/buildings/types";
import type { PropertyObject } from "@/lib/objects/types";

export default function EditBuildingPage() {
  const { t } = useLocale();
  const confirm = useConfirm();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const configured = isSupabaseConfigured();
  const { role, loading: roleLoading } = useRole();

  // Seeded from `configured` rather than set from inside the effect: the
  // flag is a build-time env check, constant for the whole session, so the
  // not-configured case is a starting value, not something to synchronise.
  const [building, setBuilding] = useState<Building | null | undefined>(
    configured ? undefined : null
  );
  const [values, setValues] = useState<BuildingInput>(emptyBuildingInput);
  const [units, setUnits] = useState<PropertyObject[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{ text: string; ok: boolean } | null>(null);

  const loadUnits = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .schema("crm")
      .from("objects")
      .select("*")
      .eq("building_id", params.id);
    setUnits((data ?? []) as PropertyObject[]);
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
      .then(({ data }) => {
        const b = (data as Building) ?? null;
        setBuilding(b);
        if (b) {
          setValues({
            name: b.name,
            address: b.address ?? "",
            floors_count: b.floors_count?.toString() ?? "",
            units_per_floor: b.units_per_floor?.toString() ?? "",
            price_per_sqm: b.price_per_sqm?.toString() ?? "",
            facade_url: b.facade_url ?? "",
            plan_url: b.plan_url ?? "",
            construction_status: b.construction_status ?? "in_progress",
          });
        }
      });
    loadUnits();
  }, [configured, params.id, loadUnits]);

  const handleSubmit = async () => {
    const nextRate = values.price_per_sqm ? Number(values.price_per_sqm) : null;
    const rateChanged =
      nextRate != null && nextRate > 0 && nextRate !== (building?.price_per_sqm ?? null);

    // The rate used to reach the apartments only at the moment they were
    // generated, so changing it later moved one number in one row and the
    // shakhmatka went on showing the old totals. Ask before rewriting them:
    // an admin who came here to fix the address should not have the whole
    // price list recalculated behind their back. Saying no still saves the
    // new rate -- it then applies to apartments created from now on.
    // Clearing the field is the other half of the same idea, and it used to do
    // nothing at all: the rate went to NULL and every flat kept the price
    // computed from the rate that was there before -- a number with nothing
    // left behind it, still counted in the dashboard's potential. Offer to
    // take those prices away too. Sold flats keep theirs, and so do flats
    // priced in dollars, which never came from this (TJS) rate.
    const rateCleared = nextRate == null && (building?.price_per_sqm ?? null) != null;
    let clearPrices = false;
    if (rateCleared) {
      const affected = units.filter(
        (u) => u.status !== "sold" && u.currency === "TJS" && (u.price ?? 0) > 0
      );
      if (affected.length > 0) {
        clearPrices = await confirm(
          t.buildings.form.clearPricesConfirm.replace("{n}", String(affected.length)),
          { danger: true, confirmLabel: t.buildings.form.clearPricesBtn }
        );
      }
    }

    setSubmitting(true);
    const supabase = createClient();
    await supabase
      .schema("crm")
      .from("buildings")
      .update({
        name: values.name,
        address: values.address || null,
        floors_count: values.floors_count ? Number(values.floors_count) : null,
        units_per_floor: values.units_per_floor ? Number(values.units_per_floor) : null,
        price_per_sqm: nextRate,
        facade_url: values.facade_url || null,
        plan_url: values.plan_url || null,
        construction_status: values.construction_status,
      })
      .eq("id", params.id);

    // Nothing to call here for a changed rate: a database trigger (050) does
    // it as part of the same write. This screen used to ask first and then
    // send an RPC, which is now both redundant and a lie -- declining the
    // dialog would not have stopped anything.
    let clearedCount: number | null = null;
    if (clearPrices) {
      // No database function needed here, unlike repricing: this writes the
      // same literal NULL to every matching row, which REST expresses fine.
      // The filter travels as a few query parameters, not as a list of ids,
      // so it does not grow with the building.
      const { error, count } = await supabase
        .schema("crm")
        .from("objects")
        .update({ price: null }, { count: "exact" })
        .eq("building_id", params.id)
        .neq("status", "sold")
        .eq("currency", "TJS");
      if (error) {
        setSubmitting(false);
        setSaveError(t.buildings.form.repriceFailed.replace("{err}", error.message));
        return;
      }
      clearedCount = count ?? 0;
    }

    setSubmitting(false);
    // The shakhmatka is where the new prices are actually visible, so it also
    // carries the confirmation of how many rows moved.
    const receipt =
      clearedCount != null
        ? `?cleared=${clearedCount}`
        : rateChanged
          ? "?rate=applied"
          : "";
    router.push(`/buildings/${params.id}${receipt}`);
  };

  // Apply the rate that is already saved, whether or not it just changed.
  //
  // Saving only re-prices when the rate itself moved, which is right for a
  // save but leaves no way to say "apply what is there now". And flats keep
  // appearing that the last run never saw: ones booked since, ones that had
  // no area at the time, ones a migration only started counting later. Those
  // could never be reached again, because re-saving the same number is not a
  // change. Hence a button that does not care whether anything changed.
  const handleApplyRate = async () => {
    const rate = values.price_per_sqm ? Number(values.price_per_sqm) : null;
    if (rate == null || !(rate > 0)) {
      setApplyResult({ text: t.buildings.form.applyRateNoRate, ok: false });
      return;
    }
    // What the database is about to be asked to touch, counted from the same
    // rows this page already loaded -- so the answer can be compared with what
    // actually moved.
    const expected = units.filter(
      (u) => u.status !== "sold" && u.currency === "TJS" && (u.area ?? 0) > 0
    ).length;

    setApplying(true);
    setApplyResult(null);
    const supabase = createClient();
    const { data, error } = await supabase.schema("crm").rpc("reprice_building_units", {
      p_building_id: params.id,
      p_price_per_sqm: rate,
    });
    setApplying(false);

    if (error) {
      const missing =
        error.code === "PGRST202" || /Could not find the function/i.test(error.message);
      setApplyResult({
        text: missing
          ? t.buildings.form.repriceNoFunction
          : t.buildings.form.repriceFailed.replace("{err}", error.message),
        ok: false,
      });
      return;
    }

    const row = (Array.isArray(data) ? data[0] : data) as {
      repriced?: number;
      skipped_sold?: number;
      skipped_no_area?: number;
      skipped_currency?: number;
    } | null;
    const repriced = Number(row?.repriced ?? 0);

    let text = t.buildings.form.applyRateResult
      .replace("{n}", String(repriced))
      .replace("{noArea}", String(row?.skipped_no_area ?? 0))
      .replace("{cur}", String(row?.skipped_currency ?? 0))
      .replace("{sold}", String(row?.skipped_sold ?? 0));

    // Fewer rows moved than matched the filter. Nothing is wrong with the
    // arithmetic -- the missing ones were refused by the row-level policy,
    // which lets a non-admin change only free flats. Saying so beats leaving
    // a number that quietly does not add up.
    if (repriced < expected) {
      text += t.buildings.form.applyRateBlocked.replace("{n}", String(expected - repriced));
    }
    setApplyResult({ text, ok: repriced >= expected });
    await loadUnits();
  };

  const handleDelete = async () => {
    if (!(await confirm(t.buildings.form.confirmDelete, { danger: true }))) return;
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("crm").from("buildings").delete().eq("id", params.id);
    if (error) {
      setSaveError(t.buildings.form.deleteBlocked);
      return;
    }
    router.push("/objects");
  };

  if (!roleLoading && role !== "admin") {
    return (
      <div className="flex flex-col gap-3">
        <BackLink href={`/buildings/${params.id}`}>{t.buildings.backToList}</BackLink>
        <p className="text-[var(--ink-4)]">{t.users.accessDenied}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <BackLink href={`/buildings/${params.id}`}>{t.buildings.backToList}</BackLink>

      {!configured && <SetupNotice />}

      {configured && building === undefined && (
        <p className="text-[var(--ink-5)]">{t.common.loading}</p>
      )}
      {configured && building === null && (
        <p className="text-[var(--ink-5)]">{t.buildings.notFound}</p>
      )}

      {building && (
        <>
          <h1 className="text-2xl font-semibold">{building.name}</h1>
          {/* Floors count / units-per-floor are hidden: they assume the same
              number of units on every floor, which is wrong for multi-entrance
              buildings. The real structure is defined by the constructor below
              (blocks + floor ranges + per-range type). */}
          <BuildingForm
            values={values}
            onChange={setValues}
            submitting={submitting}
            onSubmit={handleSubmit}
            onDelete={handleDelete}
            hideFloorsCount
            hideUnitsPerFloor
          >
            {/* Saving only re-prices when the rate changed. This applies
                whatever rate is saved right now, to everything unsold -- the
                way to reach flats booked or added since the last run. */}
            <div className="rounded-xl border border-[var(--border-c)] bg-[var(--surface-2)] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--ink-2)]">
                    {t.buildings.form.applyRate}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--ink-4)]">
                    {t.buildings.form.applyRateHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleApplyRate}
                  disabled={applying}
                  className="h-10 shrink-0 rounded-lg border border-brand px-4 text-sm font-medium text-brand transition-all hover:bg-brand-soft active:scale-[0.98] disabled:opacity-50"
                >
                  {applying ? "…" : t.buildings.form.applyRateBtn}
                </button>
              </div>
              {applyResult && (
                <p
                  className={`mt-2.5 text-xs ${
                    applyResult.ok ? "text-[var(--wash-emerald-ink)]" : "text-[var(--wash-amber-ink)]"
                  }`}
                >
                  {applyResult.text}
                </p>
              )}
            </div>
          </BuildingForm>
          {saveError && <p className="text-sm text-[var(--wash-rose-ink)]">{saveError}</p>}

          <FloorUnitsBuilder
            buildingId={building.id}
            pricePerSqm={building.price_per_sqm}
            existingUnits={units}
            onGenerated={loadUnits}
          />
        </>
      )}
    </div>
  );
}
