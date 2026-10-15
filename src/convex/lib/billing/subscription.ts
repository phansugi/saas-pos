/**
 * Subscription lifecycle & access policy.
 *
 * Key product rule: never hard-lock a cashier mid-transaction. When a tenant
 * is overdue we degrade to READ-ONLY (no new sales, but settlement, receipts
 * and data export keep working) and only BLOCK after the grace period ends.
 */

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "suspended"
  | "canceled";

export type AccessMode = "full" | "read_only" | "blocked";

export const DEFAULT_GRACE_DAYS = 7;

export interface AccessEvaluationInput {
  status: SubscriptionStatus;
  now: Date;
  trialEndsAt?: Date | null;
  currentPeriodEnd?: Date | null;
  graceDays?: number;
}

export interface AccessDecision {
  mode: AccessMode;
  /** New POS sales are permitted. */
  canCreateSales: boolean;
  /** Settling existing bills / taking payment is always allowed. */
  canSettlePayments: boolean;
  reason: string;
  graceDaysRemaining: number;
}

const MS_PER_DAY = 86_400_000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function overdueDecision(
  overdueDays: number,
  grace: number,
  overdueReason: string,
  expiredReason: string,
): AccessDecision {
  if (overdueDays <= grace) {
    return {
      mode: "read_only",
      canCreateSales: false,
      canSettlePayments: true,
      reason: `${overdueReason} Mode baca-saja, ${grace - overdueDays} hari tersisa.`,
      graceDaysRemaining: grace - overdueDays,
    };
  }
  return {
    mode: "blocked",
    canCreateSales: false,
    canSettlePayments: true,
    reason: expiredReason,
    graceDaysRemaining: 0,
  };
}

export function evaluateAccess(input: AccessEvaluationInput): AccessDecision {
  const grace = input.graceDays ?? DEFAULT_GRACE_DAYS;
  const now = input.now.getTime();

  switch (input.status) {
    case "canceled":
      return {
        mode: "blocked",
        canCreateSales: false,
        canSettlePayments: true,
        reason: "Langganan dibatalkan.",
        graceDaysRemaining: 0,
      };

    case "suspended":
      return {
        mode: "blocked",
        canCreateSales: false,
        canSettlePayments: true,
        reason: "Akun ditangguhkan menunggu penyelesaian pembayaran.",
        graceDaysRemaining: 0,
      };

    case "trialing": {
      const endMs = input.trialEndsAt?.getTime();
      if (endMs && now <= endMs) {
        return {
          mode: "full",
          canCreateSales: true,
          canSettlePayments: true,
          reason: "Masa uji coba aktif.",
          graceDaysRemaining: grace,
        };
      }
      const overdueDays = endMs ? daysBetween(new Date(endMs), input.now) : grace + 1;
      return overdueDecision(
        overdueDays,
        grace,
        "Masa uji coba berakhir.",
        "Masa uji coba berakhir melewati masa tenggang.",
      );
    }

    case "active": {
      const endMs = input.currentPeriodEnd?.getTime();
      if (!endMs || now <= endMs) {
        return {
          mode: "full",
          canCreateSales: true,
          canSettlePayments: true,
          reason: "Langganan aktif.",
          graceDaysRemaining: grace,
        };
      }
      const overdueDays = daysBetween(new Date(endMs), input.now);
      return overdueDecision(
        overdueDays,
        grace,
        "Periode langganan berakhir.",
        "Periode berakhir melewati masa tenggang.",
      );
    }

    case "past_due": {
      const endMs = input.currentPeriodEnd?.getTime();
      const overdueDays = endMs ? daysBetween(new Date(endMs), input.now) : 0;
      return overdueDecision(
        overdueDays,
        grace,
        "Pembayaran tertunda.",
        "Pembayaran tertunda melewati masa tenggang.",
      );
    }
  }
}

/**
 * Suggested next status for the billing engine's scheduler, based on the
 * current status and time. Providers (Xendit/GDCPay) only confirm payment —
 * the lifecycle itself is owned here.
 */
export function nextStatusOnPeriodEnd(
  status: SubscriptionStatus,
  currentPeriodEnd: Date,
  now: Date,
  graceDays = DEFAULT_GRACE_DAYS,
): SubscriptionStatus {
  if (status !== "active") return status;
  if (now.getTime() <= currentPeriodEnd.getTime()) return "active";
  const overdueDays = daysBetween(currentPeriodEnd, now);
  if (overdueDays > graceDays) return "suspended";
  return "past_due";
}
