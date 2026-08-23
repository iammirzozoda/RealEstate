"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { DATE_BOUNDS, isDateInRange } from "@/lib/dates";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, CURRENCIES } from "@/lib/currency";
import { formatArea } from "@/lib/objects/format";
import { CONTRACT_STATUSES, PAYMENT_TYPES, type ContractInput } from "@/lib/contracts/types";
import { amountToWordsTj } from "@/lib/contracts/amountToWordsTj";
import { ClientAutocomplete } from "@/components/ClientAutocomplete";
import type { Client, ClientInput } from "@/lib/clients/types";
import type { PropertyObject } from "@/lib/objects/types";

const FIELD_CLASS =
  "h-10 rounded-lg border border-slate-300 px-3 text-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10";
const FIELD_CLASS_SM =
  "h-9 rounded-lg border border-slate-300 px-2.5 text-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10";
const TEXTAREA_CLASS =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm transition-colors focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10";

type ObjectWithBuilding = PropertyObject & { building: { name: string } | null };

export type LockedObject = {
  id: string;
  label: string;
  secondaryLabel: string | null;
  buildingName: string | null;
  apartmentNumber: number | null;
};

// Initials of a full name: "Ҳакимов Парвиз Холиқович" -> "ҲПХ".
function initialsOf(fullName: string): string {
  return fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

// Contract numbers are system-generated, never typed by staff:
// building initial + apartment number + the buyer's initials, e.g. a unit
// №157 in "Бурҷи Бохтар" sold to Ҳакимов Парвиз Холиқович -> "Б-157-ҲПХ".
//
// The apartment number is the real shakhmatka number (the one printed on the
// contract), not the unit's position within its floor -- position repeats on
// every floor, so it never identified the apartment on its own. The day of
// the month used to be the third part; the buyer's initials say far more and
// don't collide across two deals on the same day.
function computeContractNumber(
  object:
    | { name: string; apartmentNumber: number | null; buildingName: string | null }
    | undefined,
  clientName: string
): string {
  if (!object) return "";
  const source = (object.buildingName || object.name).trim();
  if (!source) return "";
  const parts = [source.charAt(0).toUpperCase()];
  if (object.apartmentNumber != null) parts.push(String(object.apartmentNumber));
  const initials = initialsOf(clientName);
  if (initials) parts.push(initials);
  return parts.join("-");
}

const emptyInput: ContractInput = {
  number: "",
  client_id: "",
  object_id: "",
  amount: "",
  paid_amount: "",
  currency: "TJS",
  amount_words: "",
  status: "draft",
  signed_date: "",
  notes: "",
  payment_type: "full",
  installment_months: "",
  barter_details: "",
};

export function ContractForm({
  initial,
  submitting,
  onSubmit,
  onDelete,
  lockedObject,
  objectArea,
}: {
  initial?: Partial<ContractInput>;
  submitting: boolean;
  onSubmit: (values: ContractInput) => void;
  onDelete?: () => void;
  // Area of the unit being contracted (m²). When known, staff can enter a
  // price per m² and the total contract amount is computed from it -- prices
  // are negotiated individually per client, so the rate is the natural thing
  // to type, not the total.
  objectArea?: number | null;
  // When set, this form is opened for one specific, already-known unit (a
  // shakhmatka booking click) -- the object field becomes a locked display
  // instead of a searchable dropdown of every unit in the system, so staff
  // can't accidentally book payment onto the wrong apartment, and we skip
  // fetching the full objects table since nothing here needs it.
  lockedObject?: LockedObject;
}) {
  const { t } = useLocale();
  const [values, setValues] = useState<ContractInput>({ ...emptyInput, ...initial });
  const [clients, setClients] = useState<Client[]>([]);
  const [objects, setObjects] = useState<ObjectWithBuilding[]>([]);
  const [newClient, setNewClient] = useState<ClientInput | null>(null);
  const [creatingClient, setCreatingClient] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const isExistingContract = Boolean(initial?.number);
  // A contract is signed on a real, past date -- not in year 0202 or 20260.
  const signedBounds = DATE_BOUNDS.past();
  const signedInvalid = !isDateInRange(values.signed_date, signedBounds.min, signedBounds.max);

  const amountNum = Number(values.amount) || 0;
  const paidNum = Number(values.paid_amount) || 0;
  const pct = amountNum > 0 ? (paidNum / amountNum) * 100 : 0;
  const lastAutoWords = useRef("");

  // Price per m². Known area comes either from the prop (locked booking flow)
  // or the object picked in the dropdown. Seed the rate from the initial
  // amount so an existing/default price shows its implied rate.
  const areaForRate =
    objectArea ??
    (lockedObject ? null : objects.find((o) => o.id === values.object_id)?.area ?? null);
  const [pricePerSqm, setPricePerSqm] = useState(() => {
    const amt = Number(initial?.amount) || 0;
    return objectArea && objectArea > 0 && amt > 0
      ? String(Math.round((amt / objectArea) * 100) / 100)
      : "";
  });
  // Two one-way helpers -- never call each other, so no update loop: typing a
  // rate fills the amount; typing an amount back-fills the implied rate.
  const setRateAndAmount = (v: string) => {
    setPricePerSqm(v);
    if (areaForRate && areaForRate > 0) {
      update("amount", v === "" ? "" : String(Math.round(Number(v) * areaForRate * 100) / 100));
    }
  };
  const setAmountAndRate = (v: string) => {
    update("amount", v);
    if (areaForRate && areaForRate > 0) {
      setPricePerSqm(v === "" ? "" : String(Math.round((Number(v) / areaForRate) * 100) / 100));
    }
  };

  // When editing an existing contract the object's area loads a moment after
  // the form -- back-fill the implied rate once it's known and the field is
  // still blank, so the price/m² isn't left empty under a real amount.
  useEffect(() => {
    if (pricePerSqm !== "") return;
    if (areaForRate && areaForRate > 0 && amountNum > 0) {
      setPricePerSqm(String(Math.round((amountNum / areaForRate) * 100) / 100));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaForRate, amountNum]);

  const installmentMonthsNum = Number(values.installment_months) || 0;
  const installmentRemaining = Math.max(amountNum - paidNum, 0);
  // Same split ContractPayments uses when it actually generates the
  // schedule: equal monthly amounts, with the last month absorbing
  // whatever a few cents of rounding leaves over.
  const monthlyBase =
    installmentMonthsNum > 0
      ? Math.floor((installmentRemaining / installmentMonthsNum) * 100) / 100
      : 0;
  const monthlyLast =
    installmentMonthsNum > 0
      ? Math.round((installmentRemaining - monthlyBase * (installmentMonthsNum - 1)) * 100) / 100
      : 0;

  const handlePercentChange = (pctValue: string) => {
    const p = Number(pctValue) || 0;
    const newPaid = amountNum > 0 ? Math.round(((amountNum * p) / 100) * 100) / 100 : 0;
    update("paid_amount", newPaid.toString());
  };

  useEffect(() => {
    const supabase = createClient();
    supabase
      .schema("crm")
      .from("clients")
      .select("*")
      .order("name")
      .then(({ data }) => setClients((data ?? []) as Client[]));
    if (!lockedObject) {
      supabase
        .schema("crm")
        .from("objects")
        .select("*, building:buildings(name)")
        .order("name")
        .then(({ data }) => setObjects((data ?? []) as unknown as ObjectWithBuilding[]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = <K extends keyof ContractInput>(key: K, value: ContractInput[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  // The number embeds the buyer's initials, so it has to be regenerated when
  // the buyer changes -- not just once when the unit is known. The field is
  // read-only for new contracts, so there's no hand-typed value to clobber.
  const resolvedClientName = (
    newClient?.name ??
    clients.find((c) => c.id === values.client_id)?.name ??
    ""
  ).trim();

  useEffect(() => {
    if (isExistingContract) return;
    let source: Parameters<typeof computeContractNumber>[0];
    if (lockedObject) {
      source = {
        name: lockedObject.secondaryLabel || lockedObject.label,
        apartmentNumber: lockedObject.apartmentNumber,
        buildingName: lockedObject.buildingName,
      };
    } else {
      const selected = objects.find((o) => o.id === values.object_id);
      if (!selected) return;
      source = {
        name: selected.name,
        // Only the shakhmatka booking flow knows the real apartment number;
        // editing an existing contract never regenerates a number anyway.
        apartmentNumber: null,
        buildingName: selected.building?.name ?? null,
      };
    }
    update("number", computeContractNumber(source, resolvedClientName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, values.object_id, lockedObject, resolvedClientName]);

  // Auto-suggest the Tajik amount-in-words whenever the amount/currency
  // changes, but only while the field still matches our last suggestion —
  // once staff edit it by hand, further amount changes leave it alone.
  useEffect(() => {
    if (!amountNum) return;
    if (values.amount_words && values.amount_words !== lastAutoWords.current) return;
    const generated = amountToWordsTj(amountNum, values.currency);
    lastAutoWords.current = generated;
    update("amount_words", generated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountNum, values.currency]);

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setClientError(null);

    // A real estate purchase contract legally needs the buyer's full
    // identification -- enforced here (not on the general lead-capture
    // client form, which stays lightweight) and only for *new* contracts,
    // so editing an older contract that predates this rule isn't blocked
    // just because nobody went back and filled in its client's passport.
    if (!isExistingContract) {
      const resolvedClient = newClient ?? clients.find((c) => c.id === values.client_id);
      const missing =
        !resolvedClient ||
        !resolvedClient.name?.trim() ||
        !resolvedClient.passport?.trim() ||
        !resolvedClient.passport_issued_by?.trim() ||
        !resolvedClient.birth_date?.trim();
      if (missing) {
        setClientError(t.contracts.form.missingRequiredClientFields);
        return;
      }
    }

    if (!newClient) {
      onSubmit(values);
      return;
    }
    setCreatingClient(true);
    setClientError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .schema("crm")
      .from("clients")
      .insert({
        name: newClient.name,
        phone: newClient.phone || null,
        phone2: newClient.phone2 || null,
        email: newClient.email || null,
        passport: newClient.passport || null,
        passport_issued_by: newClient.passport_issued_by || null,
        birth_date: newClient.birth_date || null,
        address: newClient.address || null,
        source: newClient.source || null,
        notes: newClient.notes || null,
      })
      .select("id")
      .single();
    setCreatingClient(false);
    if (error || !data) {
      setClientError(error?.message ?? t.common.error);
      return;
    }
    onSubmit({ ...values, client_id: data.id });
  };

  return (
    <form onSubmit={handleFormSubmit} className={`flex flex-col gap-4 ${lockedObject ? "w-full" : "max-w-xl"}`}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">{t.contracts.form.number}</span>
        <input
          value={values.number}
          onChange={(e) => update("number", e.target.value)}
          readOnly={!isExistingContract}
          placeholder={isExistingContract ? "" : t.contracts.form.numberAuto}
          className={`${FIELD_CLASS} ${isExistingContract ? "" : "bg-slate-50 text-slate-500"}`}
        />
      </label>

      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <ClientAutocomplete
          clients={clients}
          value={values.client_id}
          onChange={(id) => update("client_id", id)}
          newClient={newClient}
          onNewClientChange={setNewClient}
        />
        {lockedObject ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">{t.contracts.form.object}</span>
            <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
              <span className="font-semibold text-slate-900">{lockedObject.label}</span>
              {lockedObject.secondaryLabel && (
                <span className="truncate text-xs text-slate-400">
                  · {lockedObject.secondaryLabel}
                </span>
              )}
              {lockedObject.buildingName && (
                <span className="truncate text-xs text-slate-400">
                  · {lockedObject.buildingName}
                </span>
              )}
              {objectArea != null && (
                <span className="shrink-0 text-xs font-medium text-slate-500">
                  · {formatArea(objectArea)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">{t.contracts.form.object}</span>
            <select
              required
              value={values.object_id}
              onChange={(e) => {
                const objectId = e.target.value;
                const selected = objects.find((o) => o.id === objectId);
                // The number is regenerated by the effect above whenever the
                // unit or the buyer changes -- don't compute it here too.
                setValues((v) => {
                  const nextAmount = v.amount || selected?.price?.toString() || v.amount;
                  // Seed the implied price/m² for the newly chosen unit.
                  const amt = Number(nextAmount) || 0;
                  if (selected?.area && selected.area > 0 && amt > 0) {
                    setPricePerSqm(String(Math.round((amt / selected.area) * 100) / 100));
                  } else {
                    setPricePerSqm("");
                  }
                  return {
                    ...v,
                    object_id: objectId,
                    amount: nextAmount,
                    currency: selected?.currency ?? v.currency,
                  };
                });
              }}
              className={FIELD_CLASS}
            >
              <option value="">{t.contracts.form.selectObject}</option>
              {objects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {areaForRate && areaForRate > 0 && (
        <div className="grid grid-cols-[2fr_1fr] items-end gap-4 rounded-lg bg-slate-50 p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">{t.contracts.form.pricePerSqm}</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={pricePerSqm}
              onChange={(e) => setRateAndAmount(e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
          <p className="pb-2.5 text-xs text-slate-500">
            {new Intl.NumberFormat("ru-RU").format(areaForRate)} м² ×{" "}
            {pricePerSqm ? new Intl.NumberFormat("ru-RU").format(Number(pricePerSqm)) : "—"} ={" "}
            <span className="font-semibold text-slate-800">
              {formatCurrency(amountNum || null, values.currency)}
            </span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-[2fr_2fr_1fr] gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.contracts.form.amount}</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={values.amount}
            onChange={(e) => setAmountAndRate(e.target.value)}
            className={FIELD_CLASS}
          />
        </label>
        {/* On an EXISTING contract the paid total is not a field -- it is the
            sum of the receipts, and typing over it is what made the balance
            stop matching the payment history. Editable only while drafting a
            new contract, where it means the down payment and gets written as
            a real payment row. */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.contracts.form.paidAmount}</span>
          {isExistingContract ? (
            <>
              <div
                className={`${FIELD_CLASS} flex items-center bg-slate-50 text-slate-500`}
                aria-readonly="true"
              >
                {values.paid_amount || "0"}
              </div>
              <span className="text-[11px] text-slate-400">
                {t.contracts.form.paidFromHistory}
              </span>
            </>
          ) : (
            <input
              type="number"
              min="0"
              step="0.01"
              value={values.paid_amount}
              onChange={(e) => update("paid_amount", e.target.value)}
              className={FIELD_CLASS}
            />
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.contracts.form.currency}</span>
          <select
            value={values.currency}
            onChange={(e) => update("currency", e.target.value as ContractInput["currency"])}
            className={FIELD_CLASS}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>

      {amountNum > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-slate-500">
            {pct.toFixed(1)}% {t.contracts.form.percentOfAmount} ·{" "}
            {formatCurrency(paidNum, values.currency)}
          </span>
          {/* The percent box writes into paid_amount, so on an existing
              contract it would overwrite the receipts total the same way the
              field itself did. Drafting only; afterwards the figure is just
              reported. */}
          {!isExistingContract && (
            <label className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{t.contracts.form.enterPercent}</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={pct ? Math.round(pct * 10) / 10 : ""}
                onChange={(e) => handlePercentChange(e.target.value)}
                className={`w-20 ${FIELD_CLASS_SM}`}
              />
            </label>
          )}
        </div>
      )}

      <div className={`grid grid-cols-1 gap-4 ${lockedObject ? "" : "sm:grid-cols-2"}`}>
        {!lockedObject && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">{t.contracts.form.status}</span>
            <select
              value={values.status}
              onChange={(e) => update("status", e.target.value as ContractInput["status"])}
              className={FIELD_CLASS}
            >
              {CONTRACT_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t.contracts.statuses[status]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.contracts.form.signedDate}</span>
          <input
            type="date"
            value={values.signed_date}
            min={signedBounds.min}
            max={signedBounds.max}
            onChange={(e) => update("signed_date", e.target.value)}
            className={`${FIELD_CLASS} ${signedInvalid ? "border-red-400" : ""}`}
          />
          {signedInvalid && (
            <span className="text-xs font-medium text-red-600">
              {t.common.dateOutOfRange
                .replace("{min}", signedBounds.min)
                .replace("{max}", signedBounds.max)}
            </span>
          )}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">{t.contracts.form.paymentType}</span>
          <select
            value={values.payment_type}
            onChange={(e) =>
              update("payment_type", e.target.value as ContractInput["payment_type"])
            }
            className={FIELD_CLASS}
          >
            {PAYMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.contracts.paymentTypes[type]}
              </option>
            ))}
          </select>
        </label>
        {values.payment_type === "installment" && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">
              {t.contracts.form.installmentMonths}
            </span>
            <input
              type="number"
              min="1"
              value={values.installment_months}
              onChange={(e) => update("installment_months", e.target.value)}
              className={FIELD_CLASS}
            />
          </label>
        )}
      </div>

      {values.payment_type === "installment" && installmentMonthsNum > 0 && (
        <div className="flex flex-col gap-1.5 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">{t.contracts.form.downPayment}</span>
            <span className="font-medium text-slate-900">
              {formatCurrency(paidNum, values.currency)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">{t.contracts.form.installmentRemaining}</span>
            <span className="font-medium text-slate-900">
              {formatCurrency(installmentRemaining, values.currency)}
            </span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5">
            <span className="font-medium text-slate-700">{t.contracts.form.monthlyPayment}</span>
            <span className="font-semibold text-slate-900">
              {formatCurrency(monthlyBase, values.currency)} × {installmentMonthsNum}
              {monthlyLast !== monthlyBase && (
                <span className="ml-1 font-normal text-slate-400">
                  ({formatCurrency(monthlyLast, values.currency)} {t.contracts.form.lastMonth})
                </span>
              )}
            </span>
          </div>
        </div>
      )}

      {values.payment_type === "barter" && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">
            {t.contracts.form.barterDetails}
          </span>
          <textarea
            value={values.barter_details}
            onChange={(e) => update("barter_details", e.target.value)}
            rows={2}
            className={TEXTAREA_CLASS}
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">{t.contracts.form.amountWords}</span>
        <input
          value={values.amount_words}
          onChange={(e) => update("amount_words", e.target.value)}
          placeholder={t.contracts.form.amountWordsPlaceholder}
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">{t.contracts.form.notes}</span>
        <textarea
          value={values.notes}
          onChange={(e) => update("notes", e.target.value)}
          rows={4}
          className={TEXTAREA_CLASS}
        />
      </label>

      {clientError && <p className="text-sm text-red-600">{clientError}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || creatingClient}
          className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:hover:scale-100"
        >
          {isExistingContract ? t.contracts.form.save : t.contracts.form.create}
        </button>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-red-300 px-4 py-2.5 text-sm font-medium text-red-600 transition-all hover:border-red-400 hover:bg-red-50 active:scale-[0.98]"
          >
            {t.contracts.form.delete}
          </button>
        )}
      </div>
    </form>
  );
}
