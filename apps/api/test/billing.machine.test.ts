// The one rule for a paid subscription (billing/machine.ts), over every class of case:
// our row (none, or each of five statuses) × Paddle's status (five) × whether the gym
// already holds another live plan × whether Paddle's record is older than ours.
// The expected column is written from Part 5 §3 and Paddle's own status list
// (developer.paddle.com, subscription entity), not read off the code.
import { describe, expect, it } from "vitest";
import { decide, targetStatus, type LocalRow, type LocalStatus, type ProviderStatus, type Snapshot } from "../src/modules/billing/machine.js";

const T0 = new Date("2026-10-01T00:00:00Z");
const T1 = new Date("2026-10-02T00:00:00Z");
const MONTH1 = new Date("2026-11-01T00:00:00Z");
const MONTH2 = new Date("2026-12-01T00:00:00Z");

const snap = (status: ProviderStatus, patch: Partial<Snapshot> = {}): Snapshot => ({
  status,
  updatedAt: T1,
  planId: "plan-a",
  currentPeriodEnd: MONTH1,
  cancelAtPeriodEnd: false,
  ...patch,
});

const row = (status: LocalStatus, patch: Partial<LocalRow> = {}): LocalRow => ({
  status,
  providerUpdatedAt: T0,
  planId: "plan-a",
  currentPeriodEnd: MONTH1,
  cancelAtPeriodEnd: false,
  ...patch,
});

const PROVIDER: ProviderStatus[] = ["active", "past_due", "paused", "canceled", "trialing"];
const LOCAL: (LocalStatus | null)[] = [null, "trialing", "active", "past_due", "canceled", "expired"];

/** What each case must decide, from the rules as written in machine.ts's header. */
function expected(local: LocalStatus | null, provider: ProviderStatus, otherLive: boolean, stale: boolean): string {
  if (provider === "trialing") return "ignore:trial_not_sold";
  if (local !== null && stale) return "ignore:stale";
  if (local === "trialing" || local === "canceled") return "ignore:not_ours";
  const target = provider === "active" ? "active" : provider === "past_due" ? "past_due" : "expired";
  if (local === null) {
    if (target === "expired") return "insert:expired:ended";
    return otherLive ? "duplicate" : `insert:${target}:activated`;
  }
  if (local === "expired") {
    if (target === "expired") return "ignore:unchanged";
    return otherLive ? "ignore:conflict" : `update:${target}:reactivated`;
  }
  // local is active or past_due
  if (target === "expired") return "update:expired:ended";
  if (local === "active" && target === "past_due") return "update:past_due:payment_failed";
  if (local === "past_due" && target === "active") return "update:active:recovered";
  return "ignore:unchanged";
}

const label = (d: ReturnType<typeof decide>): string =>
  d.kind === "ignore" ? `ignore:${d.reason}` : d.kind === "duplicate" ? "duplicate" : `${d.kind}:${d.status}:${d.event}`;

describe("the paid-subscription rule, every class of case", () => {
  const cases = LOCAL.flatMap((local) =>
    PROVIDER.flatMap((provider) =>
      [false, true].flatMap((otherLive) => (local === null ? [false] : [false, true]).map((stale) => ({ local, provider, otherLive, stale }))),
    ),
  );

  it("covers 110 cases", () => {
    // 5 providers × 2 (no row) + 5 statuses × 5 providers × 2 × 2.
    expect(cases).toHaveLength(110);
  });

  it.each(cases)("row $local · Paddle $provider · other live $otherLive · stale $stale", ({ local, provider, otherLive, stale }) => {
    const r = local === null ? null : row(local, stale ? { providerUpdatedAt: new Date(T1.getTime() + 1) } : {});
    expect(label(decide({ row: r, otherLive, snapshot: snap(provider) }))).toBe(expected(local, provider, otherLive, stale));
  });
});

describe("what changed on a live plan", () => {
  const live = (patch: Partial<LocalRow>, s: Partial<Snapshot>) => label(decide({ row: row("active", patch), otherLive: false, snapshot: snap("active", s) }));

  it("a new month is a renewal", () => {
    expect(live({}, { currentPeriodEnd: MONTH2 })).toBe("update:active:renewed");
  });
  it("a scheduled cancel keeps the plan live to the end of the month", () => {
    expect(live({}, { cancelAtPeriodEnd: true })).toBe("update:active:cancel_scheduled");
    expect(live({ cancelAtPeriodEnd: true }, {})).toBe("update:active:cancel_withdrawn");
  });
  it("another price is a plan change", () => {
    expect(live({}, { planId: "plan-b" })).toBe("update:active:plan_changed");
  });
  it("the same record twice changes nothing", () => {
    expect(live({}, {})).toBe("ignore:unchanged");
  });
  it("a record of the same instant is not stale", () => {
    expect(label(decide({ row: row("active", { providerUpdatedAt: T1 }), otherLive: false, snapshot: snap("active", { currentPeriodEnd: MONTH2 }) }))).toBe(
      "update:active:renewed",
    );
  });
  it("a row with no Paddle time yet takes any record", () => {
    expect(label(decide({ row: row("active", { providerUpdatedAt: null }), otherLive: false, snapshot: snap("canceled") }))).toBe("update:expired:ended");
  });
});

describe("Paddle's statuses onto ours", () => {
  it.each([
    ["active", "active"],
    ["past_due", "past_due"],
    ["paused", "expired"],
    ["canceled", "expired"],
    ["trialing", null],
  ] as const)("%s → %s", (provider, ours) => {
    expect(targetStatus(provider)).toBe(ours);
  });
});
