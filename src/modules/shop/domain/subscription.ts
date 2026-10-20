export const TRIAL_DAYS = 7;

export type Subscription = {
  status: "trial" | "active" | "expired";
  trialEndsAt: Date;
  paidUntil: Date | null;
};

export type SubscriptionView =
  | { kind: "trial"; daysLeft: number; endsAt: Date }
  | { kind: "paid"; until: Date }
  | { kind: "read_only" };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Cùng luật quyền ghi với guard (shared/infrastructure/auth/access.ts): hết hạn thì chỉ đọc. */
export function describeSubscription(subscription: Subscription, now: Date): SubscriptionView {
  const { status, trialEndsAt, paidUntil } = subscription;
  if (status === "trial" && trialEndsAt > now) {
    return { kind: "trial", daysLeft: Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS), endsAt: trialEndsAt };
  }
  if (status === "active" && paidUntil && paidUntil > now) return { kind: "paid", until: paidUntil };
  return { kind: "read_only" };
}
