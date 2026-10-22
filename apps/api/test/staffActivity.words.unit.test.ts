// Every note the server writes has its sentence on Staff activity, or is named as not
// something staff did (ROADMAP 4d). The list of actions is read from the source itself,
// so a new action written without a sentence fails here, not on the owner's screen.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ORG_PRIVILEGES, orgWords } from "@app/shared";
import type { BillingEvent } from "../src/modules/billing/machine.js";
import { NOT_STAFF, STAFF_LINES, dayWords, type Said } from "../src/modules/orgs/staffActivity/words.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** `billing/repo.ts` writes `billing.${event}`: every event, held to the type, so a new
 *  one fails the typecheck until it is listed here. */
const BILLING_EVENTS: Record<BillingEvent, true> = {
  trial_started: true,
  converted: true,
  activated: true,
  payment_failed: true,
  recovered: true,
  plan_changed: true,
  cancel_scheduled: true,
  cancel_withdrawn: true,
  renewed: true,
  updated: true,
  ended: true,
  reactivated: true,
};

/** Every action string in the server's source, less the privilege names that share the
 *  same spelling ("org.manage"), the log's event and queue job names (`event: "billing.applied"`) and
 *  this job's own lists. */
function actionsWritten(): Set<string> {
  const privileges = new Set<string>(ORG_PRIVILEGES);
  const found = new Set<string>(Object.keys(BILLING_EVENTS).map((e) => `billing.${e}`));
  found.add("billing.duplicate");
  for (const file of sourceFiles(SRC)) {
    if (file.includes(join("orgs", "staffActivity"))) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/["'`]((?:org|member|billing|leaderboard|attendance|user)\.[a-z_]+)["'`]/g)) {
      const action = m[1];
      const logEvent = /(event:|_JOB =)\s*$/.test(text.slice(Math.max(0, m.index - 12), m.index));
      if (action !== undefined && !logEvent && !privileges.has(action)) found.add(action);
    }
  }
  return found;
}

describe("Staff activity's sentences", () => {
  const written = actionsWritten();

  it("reads a real number of actions from the source", () => {
    expect(written.size).toBeGreaterThan(150);
    expect(written.has("org.member_removed")).toBe(true);
    expect(written.has("member.pt_booked")).toBe(true);
  });

  it("every action written has a sentence or is named as not staff's, and none is both", () => {
    const missing = [...written].filter((a) => STAFF_LINES[a] === undefined && !NOT_STAFF.has(a)).sort();
    expect(missing).toEqual([]);
    const both = Object.keys(STAFF_LINES).filter((a) => NOT_STAFF.has(a));
    expect(both).toEqual([]);
  });

  it("no sentence is kept for an action nothing writes any more", () => {
    const stale = [...Object.keys(STAFF_LINES), ...NOT_STAFF].filter((a) => !written.has(a)).sort();
    expect(stale).toEqual([]);
  });

  const said = (over: Partial<Said> = {}): Said => ({ meta: {}, about: null, words: orgWords("gym"), currency: "INR", ...over });

  it("every sentence reads as a whole sentence with nothing known, and names nobody unknown", () => {
    for (const [action, say] of Object.entries(STAFF_LINES)) {
      const line = say(said());
      expect(line, action).toMatch(/^[A-Z]/);
      expect(line, action).not.toMatch(/undefined|null|NaN|\$\{|“”|\s{2}|\s$|list's/);
    }
  });

  it("every sentence that is about somebody names them when they are known", () => {
    for (const [action, say] of Object.entries(STAFF_LINES)) {
      const unknown = say(said());
      const known = say(said({ about: "Priya Shah" }));
      if (unknown.includes("no longer on your list") || unknown.includes("since deleted")) expect(known, action).toContain("Priya Shah");
    }
  });

  it("says money, roles, dates and statuses in the gym's words", () => {
    const cases: [string, Partial<Said>, string][] = [
      ["org.member_payment_recorded", { about: "Amit Rao", meta: { amountMinor: "100000", currency: "INR", method: "cash" } }, "Recorded a payment of ₹1,000.00 from Amit Rao (Cash)"],
      ["org.membership_type_updated", { meta: { before: "Gold monthly", after: "Gold monthly", priceBefore: "100000", priceAfter: "120000" } }, "Changed the price of “Gold monthly” from ₹1,000.00 to ₹1,200.00"],
      ["org.membership_type_updated", { meta: { before: "Gold", after: "Gold monthly", priceBefore: "100000", priceAfter: "100000" } }, "Renamed the membership “Gold” to “Gold monthly”"],
      ["org.product_updated", { currency: "USD", meta: { before: "Water", after: "Water", priceBefore: "150", priceAfter: "200" } }, "Changed the price of “Water” from $1.50 to $2.00"],
      ["org.staff_added", { about: "Ravi", meta: { role: "trainer" } }, "Added Ravi to the staff as Trainer"],
      ["org.staff_role_changed", { about: "Ravi", meta: { from: "trainer", to: "manager", toName: "Front desk" } }, "Changed Ravi's role to Front desk"],
      ["org.staff_removed", { about: "Ravi", meta: { removedWith: "account_deleted" } }, "Left the staff by deleting their account"],
      ["org.day_closed", { meta: { day: "2026-10-02" } }, "Marked the gym closed on 2 Oct 2026"],
      ["org.pt_marked", { about: "Amit Rao", meta: { status: "no_show" } }, "Marked Amit Rao's personal training session as a no-show"],
      ["org.lead_changed", { about: "Sam Lee", meta: { status: "on_trial" } }, "Marked the lead Sam Lee as On trial"],
      ["org.trainer_time_off_added", { about: "Tara", meta: { from: "2026-10-20", to: "2026-10-22" } }, "Added time off for Tara from 20 Oct 2026 to 22 Oct 2026"],
      ["org.sale_recorded", { about: "Amit Rao", meta: { product: "Protein bar", quantity: "2", totalMinor: "20000", currency: "INR", method: "card_at_desk" } }, "Sold 2 × Protein bar for ₹200.00 to Amit Rao (Card at the desk)"],
      // A sale of several products (18q) names the first and counts the rest.
      ["org.sale_recorded", { about: null, meta: { product: "Protein bar", quantity: "1", others: "2", totalMinor: "66900", currency: "INR", method: "cash" } }, "Sold 1 × Protein bar and 2 more products for ₹669.00 (Cash)"],
      ["org.sale_undone", { meta: { product: "Water", quantity: "2", others: "1" } }, "Undid the sale of 2 × Water and 1 more product"],
      ["org.member_list_unlisted_removed", { meta: { removed: "12" } }, "Removed 12 members who are no longer on the list from the app"],
      ["org.group_message_sent", { meta: { people: "1" } }, "Sent a message to 1 member"],
      ["org.waiver_signed", { about: "Riya", meta: { via: "desk", signer: "guardian" } }, "Had Riya's parent or guardian sign the waiver at the desk"],
      ["org.referrals_changed", { meta: { on: "false", memberGift: "true", friendGift: "true" } }, "Switched off Refer a friend"],
      // A bare paid mark taken back (`undoMark`), and one moved on.
      ["org.held_membership_paid", { about: "Amit Rao", meta: { type: "Gold", paidBefore: "2", paidAfter: "1" } }, "Took back a paid mark on Amit Rao's Gold membership"],
      ["org.held_membership_paid", { about: "Amit Rao", meta: { type: "Gold", paidBefore: "1", paidAfter: "2" } }, "Marked Amit Rao's Gold membership as paid"],
      // A size change only started, or chosen for the next bill, is not a change made.
      ["billing.size_change_started", {}, "Started changing the size of your plan"],
      ["billing.size_change_scheduled", {}, "Chose a smaller plan from the next bill"],
      ["billing.size_scheduled", {}, "Chose a smaller plan from the next bill"],
      // Nobody named: no "a member no longer on your list's".
      ["attendance.visit_removed", { meta: { day: "2026-10-15" } }, "Removed the visit of a member no longer on your list on 15 Oct 2026"],
      ["org.member_list_entry_changed", {}, "Changed the details of a member no longer on your list"],
      ["org.referrals_changed", { meta: { on: "true", memberGift: "true", friendGift: "false" } }, "Changed Refer a friend"],
      // Money Square took on the Terminal that is not on a bill: a bill changed, or a fee no longer owed (18d-vi-b-i).
      ["org.terminal_payment_not_recorded", { about: "Amit Rao", currency: "USD", meta: { amountMinor: "4999", currency: "USD" } }, "Took a payment of $49.99 from Amit Rao on a Square Terminal, but the bill had changed, so it isn't recorded. Check it in Square"],
      ["org.terminal_payment_not_recorded", { about: "Amit Rao", currency: "USD", meta: { amountMinor: "1000", currency: "USD", feeBillId: "6cc6acd4-0000-4000-8000-000000000001" } }, "Took a payment of $10.00 from Amit Rao on a Square Terminal for a fee no longer owed, so it isn't recorded. Refund it in Square"],
    ];
    for (const [action, over, line] of cases) expect(STAFF_LINES[action]?.(said(over)), action).toBe(line);
    // A studio's people are clients.
    expect(STAFF_LINES["org.member_removed"]?.(said({ words: orgWords("studio") }))).toBe("Removed a client no longer on your list from the app");
  });

  it("reads a day only when it is one", () => {
    expect(dayWords("2026-01-05")).toBe("5 Jan 2026");
    expect(dayWords("2026-13-05")).toBeNull();
    expect(dayWords("soon")).toBeNull();
    expect(dayWords(null)).toBeNull();
  });
});
