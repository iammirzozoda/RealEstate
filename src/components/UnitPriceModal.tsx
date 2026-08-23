"use client";

import { useState } from "react";
import { Modal } from "@/components/Modal";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, type Currency } from "@/lib/currency";

// Change the price of an apartment that is ALREADY SOLD, from the client's
// own card.
//
// Until now the only way in was the shakhmatka's edit mode, and a sold cell
// doesn't open the unit editor at all -- it opens the buyer. So once a flat
// was sold its price was effectively frozen, even though re-pricing after the
// fact is ordinary (a re-measurement, a renegotiation, a plain typo).
//
// The contract amount is a SEPARATE number from the apartment's price: the
// apartment has a list price, the contract records what this buyer actually
// agreed to pay. They usually match, so the checkbox offers to move both --
// but it is off by default, because silently rewriting the sum on a signed
// contract (and with it every balance and receipt that follows from it) is
// not something a price correction should do behind anyone's back.
export function UnitPriceModal({
  unitId,
  unitName,
  area,
  price,
  currency,
  contractId,
  contractAmount,
  onClose,
  onSaved,
}: {
  unitId: string;
  unitName: string;
  area: number | null;
  price: number | null;
  currency: Currency;
  contractId: string;
  contractAmount: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const [areaStr, setAreaStr] = useState(area?.toString() ?? "");
  // The rate is what staff actually negotiate in; the total follows from it
  // and the area. Seeded from this unit's own current rate.
  const [rate, setRate] = useState(
    price != null && area ? String(Math.round((price / area) * 100) / 100) : ""
  );
  const [syncContract, setSyncContract] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const areaNum = areaStr === "" ? null : Number(areaStr);
  const rateNum = rate === "" ? null : Number(rate);
  const total = areaNum != null && rateNum != null ? areaNum * rateNum : null;

  const save = async () => {
    if (total == null) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error: objError } = await supabase
      .schema("crm")
      .from("objects")
      .update({ area: areaNum, price: total })
      .eq("id", unitId);
    if (objError) {
      setSaving(false);
      setError(objError.message);
      return;
    }
    if (syncContract) {
      const { error: contractError } = await supabase
        .schema("crm")
        .from("contracts")
        .update({ amount: total })
        .eq("id", contractId);
      if (contractError) {
        setSaving(false);
        // The apartment did change -- say so, rather than leaving the impression
        // that nothing happened.
        setError(`${t.buildings.unitPrice.contractFailed}: ${contractError.message}`);
        return;
      }
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <Modal onClose={onClose} title={`${t.buildings.unitPrice.title} · ${unitName}`}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-[var(--ink-3)]">{t.buildings.unitPrice.area}</span>
            <input
              type="number"
              inputMode="decimal"
              value={areaStr}
              onChange={(e) => setAreaStr(e.target.value)}
              className="h-11 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-[var(--ink-3)]">{t.buildings.unitPrice.rate}</span>
            <input
              type="number"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="h-11 rounded-lg border border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-sm text-[var(--ink-1)] focus:border-[var(--field-focus-border)] focus:outline-none focus:ring-2 focus:ring-[var(--field-focus-ring)]"
            />
          </label>
        </div>

        <div className="rounded-lg bg-[var(--surface-2)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[var(--ink-5)]">
            {t.buildings.unitPrice.newPrice}
          </p>
          <p className="text-xl font-bold text-[var(--ink-1)]">
            {total != null ? formatCurrency(total, currency) : "—"}
          </p>
          {price != null && (
            <p className="mt-0.5 text-xs text-[var(--ink-5)]">
              {t.buildings.unitPrice.wasPrice}: {formatCurrency(price, currency)}
            </p>
          )}
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--border-c)] px-3.5 py-3">
          <input
            type="checkbox"
            checked={syncContract}
            onChange={(e) => setSyncContract(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-[var(--ink-2)]">
              {t.buildings.unitPrice.syncContract}
            </span>
            <span className="text-xs text-[var(--ink-4)]">
              {t.buildings.unitPrice.syncContractHint.replace(
                "{amount}",
                formatCurrency(contractAmount, currency)
              )}
            </span>
          </span>
        </label>

        {error && <p className="text-sm font-medium text-[var(--wash-rose-ink)]">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-[var(--field-border)] px-4 py-2.5 text-sm font-medium text-[var(--ink-2)] transition-all hover:bg-[var(--surface-2)] active:scale-[0.98]"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || total == null}
            className="btn-brand flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? t.common.loading : t.buildings.unitEdit.save}
          </button>
        </div>
      </div>
    </Modal>
  );
}
