"use client";

import { COPY_FOR_CLIENT, COPY_FOR_COMPANY } from "@/lib/contracts/copyLabels";
import { printDocument } from "@/lib/print";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { Modal } from "@/components/Modal";
import { ContractForm } from "@/components/ContractForm";
import { ContractDocument, type ContractDocumentData } from "@/components/ContractDocument";
import type { ContractInput, ContractPayment } from "@/lib/contracts/types";
import type { PropertyObject } from "@/lib/objects/types";

type PreviewContract = ContractDocumentData & { id: string };

// Left-click booking flow for the shakhmatka: fill in the buyer and terms,
// then -- without leaving the dialog -- see the generated contract text and
// print it or save it as a PDF right there. "Save" only creates the
// contract; the print/PDF step happens here in the preview stage.
export function ContractBookingModal({
  unit,
  buildingName,
  apartmentNumber,
  onClose,
  onBooked,
}: {
  unit: PropertyObject;
  buildingName: string | null;
  apartmentNumber: number | undefined;
  onClose: () => void;
  onBooked: () => void;
}) {
  const { t } = useLocale();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewContract | null>(null);
  const [payments, setPayments] = useState<ContractPayment[]>([]);

  const handleSubmit = async (values: ContractInput) => {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .schema("crm")
      .from("contracts")
      .insert({
        number: values.number || null,
        client_id: values.client_id,
        object_id: values.object_id,
        amount: values.amount ? Number(values.amount) : 0,
        paid_amount: values.paid_amount ? Number(values.paid_amount) : 0,
        currency: values.currency,
        amount_words: values.amount_words || null,
        status: values.status,
        signed_date: values.signed_date || null,
        notes: values.notes || null,
        payment_type: values.payment_type,
        installment_months: values.installment_months
          ? Number(values.installment_months)
          : null,
        barter_details: values.barter_details || null,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setError(insertError?.message ?? t.common.error);
      setSubmitting(false);
      return;
    }

    // Object status (available/reserved/sold/rented) is derived
    // automatically by a DB trigger from the contract's paid_amount --
    // no manual update here.
    const paidAmount = values.paid_amount ? Number(values.paid_amount) : 0;
    const amount = values.amount ? Number(values.amount) : 0;
    // 'rent': amount is the lease's total value and months is its term,
    // not a sale price/payoff schedule -- otherwise the exact same
    // equal-split generation as an installment sale.
    const months =
      (values.payment_type === "installment" || values.payment_type === "rent") &&
      values.installment_months
        ? Number(values.installment_months)
        : 0;
    const baseDate = values.signed_date || new Date().toISOString().slice(0, 10);

    const paymentRowsToInsert: Array<{
      contract_id: string;
      due_date: string;
      amount: number;
      paid: boolean;
      paid_date: string | null;
    }> = [];
    if (paidAmount > 0) {
      paymentRowsToInsert.push({
        contract_id: data.id,
        due_date: baseDate,
        amount: paidAmount,
        paid: true,
        paid_date: baseDate,
      });
    }
    // An installment sale gets its whole monthly schedule up front, counted
    // from the sale date -- staff shouldn't have to open the contract later
    // and click "generate" just so the printed annex shows the plan. Same
    // equal-split math as ContractPayments' manual generator: the last
    // month absorbs whatever a few cents of rounding leaves over.
    if (months > 0 && amount - paidAmount > 0) {
      const remaining = amount - paidAmount;
      const base = Math.floor((remaining / months) * 100) / 100;
      const addMonths = (dateStr: string, m: number) => {
        const d = new Date(dateStr);
        d.setMonth(d.getMonth() + m);
        return d.toISOString().slice(0, 10);
      };
      for (let i = 0; i < months; i++) {
        const isLast = i === months - 1;
        paymentRowsToInsert.push({
          contract_id: data.id,
          due_date: addMonths(baseDate, i + 1),
          amount: isLast ? Math.round((remaining - base * (months - 1)) * 100) / 100 : base,
          paid: false,
          paid_date: null,
        });
      }
    }
    if (paymentRowsToInsert.length > 0) {
      const { error: scheduleError } = await supabase
        .schema("crm")
        .from("contract_payments")
        .insert(paymentRowsToInsert);
      if (scheduleError) {
        // Contract exists; only the schedule failed. Surface it rather than
        // silently printing a contract with an empty annex.
        setError(scheduleError.message);
      }
    }

    const [{ data: full }, { data: paymentRows }] = await Promise.all([
      supabase
        .schema("crm")
        .from("contracts")
        .select(
          "*, client:clients(name, phone, passport, passport_issued_by, birth_date, address), object:objects(name, address, area, floor, block, rooms, building:buildings(name, address, price_per_sqm))"
        )
        .eq("id", data.id)
        .maybeSingle(),
      supabase
        .schema("crm")
        .from("contract_payments")
        .select("*")
        .eq("contract_id", data.id)
        .order("due_date", { ascending: true }),
    ]);

    setSubmitting(false);
    onBooked();

    if (!full) {
      // Contract was created fine, just couldn't reload it for preview --
      // send staff to the full contract page instead of leaving them stuck.
      onClose();
      return;
    }
    setPreview(full as unknown as PreviewContract);
    setPayments((paymentRows ?? []) as ContractPayment[]);
  };

  const title = preview
    ? `${t.contracts.bookingPreview.title}${preview.number ? ` №${preview.number}` : ""}`
    : t.buildings.bookUnit;

  return (
    <Modal title={title} onClose={onClose} size="lg" guardClose={!preview}>
      {!preview ? (
        <>
          <ContractForm
            initial={{
              object_id: unit.id,
              amount: unit.price?.toString() ?? "",
              currency: unit.currency,
              // A unit listed for rent is never being sold -- default the
              // payment type to match instead of making staff switch it
              // from "full payment" every single time.
              payment_type: unit.listing_type === "rent" ? "rent" : "full",
              // The deal is being struck now -- default the signing date to
              // today rather than making staff pick it every single time.
              signed_date: new Date().toISOString().slice(0, 10),
            }}
            lockedObject={{
              id: unit.id,
              label: apartmentNumber != null ? `№${apartmentNumber}` : unit.name,
              secondaryLabel: apartmentNumber != null ? unit.name : null,
              buildingName,
              apartmentNumber: apartmentNumber ?? null,
            }}
            objectArea={unit.area}
            submitting={submitting}
            onSubmit={handleSubmit}
          />
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-500">{t.contracts.bookingPreview.subtitle}</p>

          <div id="contract-print-area" className="flex flex-col gap-10 print:gap-0">
            <div className="print:break-after-page">
              <ContractDocument
                contract={preview}
                payments={payments}
                apartmentNumber={apartmentNumber}
                copyLabel={COPY_FOR_CLIENT}
              />
            </div>
            <ContractDocument
              contract={preview}
              payments={payments}
              apartmentNumber={apartmentNumber}
              copyLabel={COPY_FOR_COMPANY}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => printDocument()}
              className="rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md active:scale-[0.98]"
            >
              {t.contracts.print.button}
            </button>
            <Link
              href={`/contracts/${preview.id}`}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t.contracts.bookingPreview.openFull}
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded-lg px-4 py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100"
            >
              {t.contracts.bookingPreview.done}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
