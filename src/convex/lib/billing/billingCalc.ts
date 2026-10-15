/**
 * Billing math: tax (PPN), mid-cycle proration, billing periods and
 * per-tenant invoice numbering.
 *
 * All amounts are integer rupiah. Rounding is always half-up to the rupiah so
 * invoices never carry sub-rupiah noise and totals reconcile.
 */

import type { Money } from "./catalog";

/** Configurable per tenant; 11% is the current Indonesian PPN default. */
export const DEFAULT_TAX_RATE_PCT = 11;

export function roundRupiah(value: number): number {
  return Math.round(value);
}

export interface TaxBreakdown {
  net: Money;
  tax: Money;
  gross: Money;
  ratePct: number;
}

/** Treat `net` as the pre-tax amount and return the tax-inclusive gross. */
export function computeTax(
  net: Money,
  ratePct: number = DEFAULT_TAX_RATE_PCT,
): TaxBreakdown {
  const tax = roundRupiah(net * (ratePct / 100));
  return { net, tax, gross: net + tax, ratePct };
}

/** Extract net + tax from an already tax-inclusive (gross) amount. */
export function reverseTax(
  gross: Money,
  ratePct: number = DEFAULT_TAX_RATE_PCT,
): TaxBreakdown {
  const net = roundRupiah(gross / (1 + ratePct / 100));
  return { net, tax: gross - net, gross, ratePct };
}

export type BillingInterval = "monthly" | "yearly";

export interface ProrationInput {
  oldPrice: Money;
  newPrice: Money;
  periodStart: Date;
  periodEnd: Date;
  changeAt: Date;
}

export interface ProrationResult {
  direction: "upgrade" | "downgrade" | "same";
  /** Unused value of the old plan for the remainder of the period. */
  credit: Money;
  /** Cost of the new plan for the remainder of the period. */
  charge: Money;
  /** Charged immediately (0 when a downgrade produces a credit). */
  dueNow: Money;
  /** Positive balance carried to the next invoice (downgrades). */
  creditBalance: Money;
  /** Fraction of the period still remaining at the change moment. */
  remainingRatio: number;
}

export function computeProration(input: ProrationInput): ProrationResult {
  const total = input.periodEnd.getTime() - input.periodStart.getTime();
  const remaining = Math.max(
    0,
    input.periodEnd.getTime() - input.changeAt.getTime(),
  );
  const ratio = total > 0 ? remaining / total : 0;

  const credit = roundRupiah(input.oldPrice * ratio);
  const charge = roundRupiah(input.newPrice * ratio);
  const diff = charge - credit;

  const direction: ProrationResult["direction"] =
    input.newPrice > input.oldPrice
      ? "upgrade"
      : input.newPrice < input.oldPrice
        ? "downgrade"
        : "same";

  return {
    direction,
    credit,
    charge,
    dueNow: Math.max(0, diff),
    creditBalance: Math.max(0, -diff),
    remainingRatio: ratio,
  };
}

export function addBillingPeriod(
  start: Date,
  interval: BillingInterval,
): Date {
  const next = new Date(start.getTime());
  if (interval === "monthly") {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setFullYear(next.getFullYear() + 1);
  }
  return next;
}

export interface InvoiceNumberInput {
  tenantSlug: string;
  sequence: number;
  issuedAt: Date;
  prefix?: string;
}

/** Sequential, per-tenant invoice number, e.g. INV/KOPI-NUSANTARA/202610/0007 */
export function formatInvoiceNumber({
  tenantSlug,
  sequence,
  issuedAt,
  prefix = "INV",
}: InvoiceNumberInput): string {
  const year = issuedAt.getUTCFullYear();
  const month = String(issuedAt.getUTCMonth() + 1).padStart(2, "0");
  const seq = String(sequence).padStart(4, "0");
  return `${prefix}/${tenantSlug.toUpperCase()}/${year}${month}/${seq}`;
}
