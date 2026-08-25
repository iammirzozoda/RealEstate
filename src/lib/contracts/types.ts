import type { Currency } from "@/lib/currency";

export const CONTRACT_STATUSES = [
  "draft",
  "active",
  "completed",
  "cancelled",
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

// 'rent': amount is the lease's total value (monthly rate × months), not
// the object's price -- installment_months means lease term, not payoff
// schedule. Otherwise mechanically identical to 'installment' (same
// equal-split-by-month schedule, see regenerate_schedule and
// ContractBookingModal), so no separate payment machinery was needed for
// a recurring-looking charge that's really just a fixed-term split.
export const PAYMENT_TYPES = ["full", "installment", "barter", "rent"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export type Contract = {
  id: string;
  number: string | null;
  client_id: string;
  object_id: string;
  amount: number;
  paid_amount: number;
  currency: Currency;
  amount_words: string | null;
  status: ContractStatus;
  signed_date: string | null;
  notes: string | null;
  payment_type: PaymentType;
  installment_months: number | null;
  barter_details: string | null;
  created_at: string;
  updated_at: string;
};

export type ContractInput = {
  number: string;
  client_id: string;
  object_id: string;
  amount: string;
  paid_amount: string;
  currency: Currency;
  amount_words: string;
  status: ContractStatus;
  signed_date: string;
  notes: string;
  payment_type: PaymentType;
  installment_months: string;
  barter_details: string;
};

export type ContractPayment = {
  id: string;
  contract_id: string;
  due_date: string;
  amount: number;
  paid: boolean;
  paid_date: string | null;
  reminder_sent_at: string | null;
  created_at: string;
};
