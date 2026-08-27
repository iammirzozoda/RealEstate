"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { DATE_BOUNDS, isDateInRange } from "@/lib/dates";
import { useConfirm } from "@/components/ConfirmDialog";
import { formatCurrency } from "@/lib/currency";
import { formatShortDate } from "@/lib/formatDate";
import { SendActions } from "@/components/SendActions";
import { MoneyIcon } from "@/components/icons";
import { receiptNumberFor } from "@/lib/contracts/receiptNumber";
import { useRole } from "@/lib/auth/useRole";
import type { Contract, ContractPayment } from "@/lib/contracts/types";

function addMonths(dateStr: string, months: number) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// How much of each planned installment is already covered by the money
// actually received. Clients rarely pay the exact installment -- sometimes
// more, sometimes less -- so nobody hand-marks plan rows anymore: the
// received total flows into the plan oldest-first (FIFO). A row is
// "covered" when enough real money has arrived to fill it, "partial" while
// it's filling, "upcoming" after the pool runs dry.
//
// The pool is (paid_amount) minus the share of the contract that was never
// part of the plan (the down payment): plan rows always sum to
// amount - downPayment, so pool = paid_amount - (amount - planTotal).
type PlanRowState = { covered: number; state: "covered" | "partial" | "upcoming" };

function allocatePlan(
  contract: Contract,
  planRows: ContractPayment[]
): Map<string, PlanRowState> {
  const planTotal = planRows.reduce((sum, p) => sum + p.amount, 0);
  let pool = Math.max(0, contract.paid_amount - (contract.amount - planTotal));
  const result = new Map<string, PlanRowState>();
  for (const row of planRows) {
    const covered = Math.min(pool, row.amount);
    pool -= covered;
    result.set(row.id, {
      covered,
      state:
        covered >= row.amount - 0.005 ? "covered" : covered > 0 ? "partial" : "upcoming",
    });
  }
  return result;
}

export function ContractPayments({
  contract,
  onPaymentAdded,
}: {
  contract: Contract;
  onPaymentAdded?: () => void;
}) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const { role } = useRole();
  const [payments, setPayments] = useState<ContractPayment[]>([]);
  const [generating, setGenerating] = useState(false);
  const [newAmount, setNewAmount] = useState("");
  const [newDate, setNewDate] = useState(today());
  const [recording, setRecording] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .schema("crm")
      .from("contract_payments")
      .select("*")
      .eq("contract_id", contract.id)
      .order("due_date", { ascending: true });
    setPayments((data ?? []) as ContractPayment[]);
    // updated_at is not read by the query -- it is here on purpose, as a
    // change signal. This component holds its own copy of the schedule, so
    // editing the contract (or re-pricing the flat) beside it would otherwise
    // leave the plan and the receipts showing pre-edit figures until the page
    // was reloaded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract.id, contract.updated_at]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGenerate = async () => {
    const months = contract.installment_months ?? 0;
    if (!months) return;
    setGenerating(true);
    const remaining = contract.amount - contract.paid_amount;
    const base = Math.floor((remaining / months) * 100) / 100;
    const baseDate = contract.signed_date ?? today();
    const rows = Array.from({ length: months }, (_, i) => {
      const isLast = i === months - 1;
      const amount = isLast
        ? Math.round((remaining - base * (months - 1)) * 100) / 100
        : base;
      return {
        contract_id: contract.id,
        due_date: addMonths(baseDate, i + 1),
        amount,
      };
    });
    const supabase = createClient();
    await supabase.schema("crm").from("contract_payments").insert(rows);
    await load();
    setGenerating(false);
  };

  const handleRecordPayment = async () => {
    const amount = Number(newAmount);
    if (!amount || amount <= 0) return;
    // Re-checked here, not just via min/max on the input: a receipt dated
    // outside any plausible range lands outside every report it belongs to.
    const b = DATE_BOUNDS.past();
    if (!isDateInRange(newDate, b.min, b.max)) {
      setRecordError(
        t.common.dateOutOfRange.replace("{min}", b.min).replace("{max}", b.max)
      );
      return;
    }
    setRecording(true);
    setRecordError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("crm").rpc("record_payment", {
      p_contract_id: contract.id,
      p_amount: amount,
      p_date: newDate,
    });
    setRecording(false);
    if (error) {
      setRecordError(error.message);
      return;
    }
    setNewAmount("");
    setNewDate(today());
    await load();
    onPaymentAdded?.();
  };

  const handleDeletePayment = async (payment: ContractPayment) => {
    if (!(await confirm(t.contracts.payments.confirmDelete, { danger: true }))) return;
    setDeletingId(payment.id);
    setRecordError(null);
    const supabase = createClient();
    // Deleting a payment that had already been counted as paid must also
    // give that amount back on the contract, or paid_amount (and the
    // object's sold/reserved status derived from it) drifts wrong -- the
    // RPC does the delete and the paid_amount adjustment as one atomic
    // update instead of reading contract.paid_amount from this component's
    // (possibly stale) props and writing back a computed value.
    const { error } = await supabase.schema("crm").rpc("delete_payment", {
      p_payment_id: payment.id,
    });
    setDeletingId(null);
    if (error) {
      setRecordError(error.message);
      return;
    }
    await load();
    onPaymentAdded?.();
  };

  // crm.regenerate_schedule exists in the database precisely for this --
  // recompute the unpaid rows from the CURRENT remaining balance, leaving
  // receipts untouched -- but nothing in the app ever called it. Editing a
  // contract's amount (a discount, a correction) writes only to
  // crm.contracts; the schedule rows it should also move are a separate
  // table, never revisited. A printed schedule this drifted from was the
  // symptom that surfaced it: paid correctly matched real receipts, but the
  // unpaid rows still summed to the OLD total, so "boqimonda" on the paper
  // read far higher than amount - paid_amount actually is.
  const scheduleTotal = payments.reduce((sum, p) => sum + p.amount, 0);
  // A closed deal (paid in full, or overpaid) has nothing left to
  // redistribute -- crm.regenerate_schedule computes remaining as
  // amount - paid_amount and refuses to run at zero ("Nothing left to
  // schedule"), so the button below would just error if it were offered
  // here. The stale row total on an already-settled contract is history,
  // not something to reconcile: what a client actually owes (remaining)
  // already reads correctly regardless of it, which is the number that
  // matters once the deal is done.
  const mismatch =
    payments.length > 0 &&
    contract.amount > contract.paid_amount &&
    Math.abs(scheduleTotal - contract.amount) > 0.5;

  const handleRegenerate = async () => {
    if (!contract.installment_months) return;
    const remaining = contract.amount - contract.paid_amount;
    const ok = await confirm(
      t.contracts.payments.regenerateConfirm
        .replace("{remaining}", formatCurrency(remaining, contract.currency))
        .replace("{months}", String(contract.installment_months)),
      { danger: true, confirmLabel: t.contracts.payments.regenerateBtn }
    );
    if (!ok) return;
    setRegenerating(true);
    setRecordError(null);
    const supabase = createClient();
    const { error } = await supabase.schema("crm").rpc("regenerate_schedule", {
      p_contract_id: contract.id,
      p_months: contract.installment_months,
    });
    setRegenerating(false);
    if (error) {
      setRecordError(error.message);
      return;
    }
    await load();
    onPaymentAdded?.();
  };

  const payBounds = DATE_BOUNDS.past();
  const payDateInvalid = !isDateInRange(newDate, payBounds.min, payBounds.max);

  const readOnly = role === "director";

  // Received money (receipts), newest first; the plan stays due-date
  // ordered because receipt numbers derive from that ordering.
  const paidPayments = payments
    .filter((p) => p.paid)
    .sort((a, b) => (b.paid_date ?? b.due_date).localeCompare(a.paid_date ?? a.due_date));
  const planRows = payments.filter((p) => !p.paid);
  const allocation = allocatePlan(contract, planRows);

  const coveredCount = planRows.filter(
    (p) => allocation.get(p.id)?.state === "covered"
  ).length;
  const nextDue =
    planRows.find((p) => allocation.get(p.id)?.state !== "covered") ?? null;
  const nextDueRemaining = nextDue
    ? nextDue.amount - (allocation.get(nextDue.id)?.covered ?? 0)
    : 0;

  const paidPct =
    contract.amount > 0
      ? Math.min(Math.round((contract.paid_amount / contract.amount) * 100), 100)
      : 0;

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-[var(--border-c)] bg-[var(--surface-1)] p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[var(--ink-2)]">{t.contracts.payments.title}</p>
        {planRows.length > 0 && (
          <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--ink-4)]">
            {coveredCount}/{planRows.length}
          </span>
        )}
      </div>

      {/* Surfaced above everything else, including the collapsed schedule --
          a drifted plan quietly overstates what's still owed on every
          printed copy of this contract until someone happens to expand the
          schedule and add it up by hand. */}
      {mismatch && (
        <div className="rounded-lg border border-[var(--wash-amber-border)] bg-[var(--wash-amber)] px-3.5 py-3">
          <p className="text-xs font-semibold text-[var(--wash-amber-ink)]">
            {t.contracts.payments.mismatchTitle}
          </p>
          <p className="mt-1 text-xs text-[var(--wash-amber-ink)]">
            {t.contracts.payments.mismatchHint
              .replace("{schedule}", formatCurrency(scheduleTotal, contract.currency))
              .replace("{contract}", formatCurrency(contract.amount, contract.currency))}
          </p>
          {role === "admin" && contract.installment_months && (
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={regenerating}
              className="mt-2 h-8 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-sm transition-all hover:bg-amber-700 active:scale-[0.98] disabled:opacity-50"
            >
              {regenerating ? t.common.loading : t.contracts.payments.regenerateBtn}
            </button>
          )}
        </div>
      )}

      {/* Recording a payment is the thing staff do here most often --
          it gets the prominent spot at the top, not buried under a table.
          Directors watch, they don't take money. */}
      {!readOnly && (
        // The everyday money action -- deliberately loud so it's the first
        // thing the eye lands on: a brand-tinted card, big amount field, bold
        // gradient button.
        <div
          className="relative flex flex-col gap-3 overflow-hidden rounded-xl border-2 border-brand-soft p-4 shadow-sm"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--brand) 10%, var(--surface-1)), color-mix(in srgb, var(--brand) 3%, var(--surface-1)))",
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-10"
            style={{ background: "var(--brand)" }}
          />
          <p className="relative flex items-center gap-2 text-sm font-bold text-brand">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand text-sm text-[var(--on-brand)] shadow-sm">
              +
            </span>
            {t.contracts.payments.recordTitle}
          </p>
          <div className="relative flex flex-wrap items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs">
              <span className="font-semibold text-[var(--ink-3)]">{t.contracts.payments.amount}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="0"
                className="h-12 w-full rounded-lg border-2 border-[var(--field-border)] bg-[var(--field-bg)] px-3 text-lg font-bold text-[var(--ink-1)] transition-colors focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_25%,transparent)]"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold text-[var(--ink-3)]">{t.contracts.payments.dueDate}</span>
              {/* Money is received on a date that has happened. A receipt dated
                  next year (or year 0202) would land outside every report it
                  belongs to and never be found again. */}
              <input
                type="date"
                value={newDate}
                min={payBounds.min}
                max={payBounds.max}
                onChange={(e) => setNewDate(e.target.value)}
                className={`h-12 rounded-lg border-2 bg-[var(--field-bg)] px-2.5 text-sm text-[var(--ink-1)] transition-colors focus:border-[var(--brand)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--brand)_25%,transparent)] ${
                  payDateInvalid ? "border-[var(--wash-rose-ink)]" : "border-[var(--field-border)]"
                }`}
              />
            </label>
          </div>
          <button
            type="button"
            onClick={handleRecordPayment}
            disabled={recording || !newAmount || payDateInvalid}
            className="btn-brand relative h-12 w-full rounded-lg text-base font-bold text-[var(--on-brand)] shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg hover:brightness-110 active:translate-y-0 active:scale-[0.99] disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {recording ? (
              t.common.loading
            ) : (
              <span className="inline-flex items-center justify-center gap-2">
                <MoneyIcon className="h-5 w-5" /> {t.contracts.payments.record}
              </span>
            )}
          </button>
          {recordError && (
            <p className="relative text-xs font-medium text-[var(--wash-rose-ink)]">{recordError}</p>
          )}
        </div>
      )}

      {!readOnly && payments.length === 0 && contract.payment_type === "installment" && (
        <>
          <p className="text-sm text-[var(--ink-5)]">{t.contracts.payments.generateHint}</p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || !contract.installment_months}
            className="w-full rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] transition-all hover:border-[var(--ink-5)] hover:bg-[var(--hover-c)] active:scale-[0.98] disabled:opacity-50"
          >
            {t.contracts.payments.generate}
          </button>
        </>
      )}

      {/* Compact by default: overall progress + the next thing due. Just
          the glance-level summary now -- the schedule toggle used to live
          here too, which meant clicking it revealed content sitting a full
          history list further down the card, disconnected from the button
          that opened it. Each list below now carries its own toggle
          directly above its own content instead. */}
      {payments.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--track-c)]">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${paidPct}%` }}
            />
          </div>
          {nextDue && (
            <p className="text-xs text-[var(--ink-4)]">
              {t.contracts.payments.nextDue}:{" "}
              <span className="font-semibold text-[var(--ink-2)]">{formatShortDate(nextDue.due_date)}</span> ·{" "}
              <span className="font-semibold text-[var(--ink-2)]">
                {formatCurrency(nextDueRemaining, contract.currency)}
              </span>
            </p>
          )}
        </div>
      )}

      {/* Money actually received, newest first -- collapsed by default and
          behind its own toggle, same shape as the schedule below. A
          contract with dozens of installments already paid used to print
          every one of them here unconditionally, which was most of this
          card's height on a long-running deal that anyone opening it
          mainly wants the CURRENT state of, not the full paper trail. */}
      {paidPayments.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setHistoryExpanded((v) => !v)}
            className="w-full rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] transition-all hover:bg-[var(--hover-c)] active:scale-[0.98]"
          >
            {historyExpanded
              ? t.clients.paymentHistory.hide
              : `${t.clients.paymentHistory.title} (${paidPayments.length})`}
          </button>
          {historyExpanded && (
            <div className="flex flex-col gap-2">
              {paidPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col gap-2 rounded-lg border border-[var(--wash-emerald-border)] bg-[var(--wash-emerald)] px-3 py-2.5 transition-colors hover:border-[var(--wash-emerald-ink)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-semibold text-[var(--ink-1)]">
                        {formatCurrency(p.amount, contract.currency)}
                      </span>
                      <span className="text-xs text-[var(--ink-5)]">
                        №{receiptNumberFor(payments, p.id)} · {formatShortDate(p.paid_date ?? p.due_date)}
                      </span>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--wash-emerald)] px-2.5 py-1 text-xs font-medium text-[var(--wash-emerald-ink)]">
                      ✓ {t.clients.paymentHistory.paid}
                    </span>
                  </div>
                  {/* Same rule as everywhere else: every action of this row in
                      one cluster on the right, not split to opposite edges. */}
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--wash-emerald-border)] pt-1.5">
                    <SendActions
                      contractId={contract.id}
                      kind="receipt"
                      paymentId={p.id}
                      printAction={{
                        href: `/contracts/${contract.id}/payments/${p.id}/receipt`,
                        label: t.contracts.receipt.print,
                      }}
                    />
                    {role === "admin" && (
                      <button
                        type="button"
                        onClick={() => handleDeletePayment(p)}
                        disabled={deletingId === p.id}
                        title={t.contracts.payments.deletePayment}
                        className="flex items-center gap-1 rounded-lg border border-[var(--wash-rose-border)] px-2 py-1 text-[11px] font-semibold text-[var(--wash-rose-ink)] transition-all hover:bg-[var(--wash-rose)] active:scale-95 disabled:opacity-50"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* The plan, with each installment's coverage DERIVED from received
          money (oldest first) -- nothing here is ever hand-marked, so a
          client paying 5 000 against a 10 000 installment shows exactly
          that: 5 000 / 10 000, not a wrongly "paid" row. Own toggle right
          above its own content, mirroring the history accordion above --
          this button used to sit all the way up by the progress bar,
          revealing content on the far side of the (always-open) history
          list instead of right next to it. */}
      {planRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="w-full rounded-lg border border-[var(--border-c)] bg-[var(--surface-1)] px-4 py-2 text-sm font-medium text-[var(--ink-2)] transition-all hover:bg-[var(--hover-c)] active:scale-[0.98]"
          >
            {expanded
              ? t.contracts.payments.hideSchedule
              : `${t.contracts.payments.showSchedule} (${planRows.length})`}
          </button>
          {expanded && (
            <div className="flex flex-col gap-2">
              {planRows.map((p) => {
                const a = allocation.get(p.id) ?? { covered: 0, state: "upcoming" as const };
                return (
                  <div
                    key={p.id}
                    className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 transition-colors ${
                      a.state === "covered"
                        ? "border-[var(--wash-emerald-border)] bg-[var(--wash-emerald)]"
                        : a.state === "partial"
                          ? "border-[var(--wash-amber-border)] bg-[var(--wash-amber)]"
                          : "border-[var(--border-c2)] hover:border-[var(--border-c)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-[var(--ink-2)]">
                          {a.state === "partial"
                            ? `${formatCurrency(a.covered, contract.currency)} / ${formatCurrency(p.amount, contract.currency)}`
                            : formatCurrency(p.amount, contract.currency)}
                        </span>
                        <span className="text-xs text-[var(--ink-5)]">{formatShortDate(p.due_date)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {a.state === "covered" && (
                          <span className="rounded-full bg-[var(--wash-emerald)] px-2.5 py-1 text-xs font-medium text-[var(--wash-emerald-ink)]">
                            ✓ {t.contracts.payments.covered}
                          </span>
                        )}
                        {a.state === "partial" && (
                          <span className="rounded-full bg-[var(--wash-amber)] px-2.5 py-1 text-xs font-medium text-[var(--wash-amber-ink)]">
                            {Math.round((a.covered / p.amount) * 100)}%
                          </span>
                        )}
                        {role === "admin" && (
                          <button
                            type="button"
                            onClick={() => handleDeletePayment(p)}
                            disabled={deletingId === p.id}
                            title={t.contracts.payments.deletePayment}
                            className="flex items-center rounded-lg border border-[var(--wash-rose-border)] px-2 py-1 text-[11px] font-semibold text-[var(--wash-rose-ink)] transition-all hover:bg-[var(--wash-rose)] active:scale-95 disabled:opacity-50"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                    {a.state === "partial" && (
                      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--track-c)]">
                        <div
                          className="h-full rounded-full bg-amber-500 transition-[width] duration-500"
                          style={{ width: `${(a.covered / p.amount) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
