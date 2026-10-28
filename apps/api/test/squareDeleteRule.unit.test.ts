// The rule that decides whether the customer Square shows is the one the app made and may delete (ROADMAP
// 18d-iii-b-ii-b-ii-b-ii): a table over every kind of customer, each as Square's own answer shapes it. The forms come from
// Square, not from the code: a customer made through the API reads `THIRD_PARTY` with version 0 (Square's test area, 2026-10-28,
// `.cost/18d-iii-b-ii-b-ii-b-ii/probe-delete.mts`), one the business typed in its Dashboard or at a till has a source of its own and
// no reference id, one made by a merge reads `MERGE` and carries a reference id of one of the customers merged
// (`.cost/18d-iii-b-ii-b-ii-a`), and Square's pages name other sources the app has never seen.
import { describe, expect, it } from "vitest";
import { decideDelete, type DeleteDecision, type KeepWhy } from "../src/modules/orgs/payments/squareDeleteRule.js";

const RECORD = "cf2c9324-ad6a-4c8e-a694-3fd603cc521e";
const OTHER = "0b9a4f8e-2a53-4f7c-9a0b-5d6c1f2e3a44";
const owed = { customerId: "CUS1", referenceId: RECORD };
const keep = (why: KeepWhy): DeleteDecision => ({ kind: "keep", why });

describe("decideDelete", () => {
  const cases: { name: string; now: Parameters<typeof decideDelete>[0]; used?: boolean; charged?: boolean; want: DeleteDecision }[] = [
    { name: "the customer the app made, never changed", now: { id: "CUS1", reference_id: RECORD, creation_source: "THIRD_PARTY", version: 0 }, want: { kind: "delete", version: 0 } },
    { name: "the customer the app made, changed since (the version read is sent)", now: { id: "CUS1", reference_id: RECORD, creation_source: "THIRD_PARTY", version: 4 }, want: { kind: "delete", version: 4 } },
    { name: "Square sent no version: none is sent", now: { id: "CUS1", reference_id: RECORD, creation_source: "THIRD_PARTY" }, want: { kind: "delete", version: null } },
    { name: "Square sent no source at all", now: { id: "CUS1", reference_id: RECORD, version: 0 }, want: { kind: "delete", version: 0 } },
    { name: "a source the app has never seen (a business can edit what it made)", now: { id: "CUS1", reference_id: RECORD, creation_source: "DIRECTORY", version: 2 }, want: { kind: "delete", version: 2 } },
    { name: "Square answered with another customer: this one was merged into it", now: { id: "CMERGED", reference_id: RECORD, creation_source: "MERGE", version: 0 }, want: keep("answered_as_another") },
    { name: "another customer, though it carries the same reference id", now: { id: "CPAT", reference_id: RECORD, creation_source: "THIRD_PARTY", version: 0 }, want: keep("answered_as_another") },
    { name: "the id asked for, made by a merge, carrying one of the old customers' reference ids", now: { id: "CUS1", reference_id: RECORD, creation_source: "MERGE", version: 0 }, want: keep("made_by_merge") },
    { name: "the id asked for, made by a merge, as Square's pages spell it", now: { id: "CUS1", reference_id: RECORD, creation_source: "MERGED", version: 0 }, want: keep("made_by_merge") },
    { name: "a customer the business had before, with no reference id", now: { id: "CUS1", creation_source: "DIRECTORY", version: 0 }, want: keep("not_made_by_app") },
    { name: "a customer with an empty reference id", now: { id: "CUS1", reference_id: "", creation_source: "OTHER", version: 0 }, want: keep("not_made_by_app") },
    { name: "a customer with a null reference id", now: { id: "CUS1", reference_id: null, version: 0 }, want: keep("not_made_by_app") },
    { name: "a customer another app made, with its own reference id", now: { id: "CUS1", reference_id: "member-1234", creation_source: "THIRD_PARTY", version: 0 }, want: keep("not_made_by_app") },
    { name: "a customer carrying another record's id", now: { id: "CUS1", reference_id: OTHER, creation_source: "THIRD_PARTY", version: 0 }, want: keep("not_made_by_app") },
    { name: "the reference id in capitals is not the one the app gave", now: { id: "CUS1", reference_id: RECORD.toUpperCase(), creation_source: "THIRD_PARTY", version: 0 }, want: keep("not_made_by_app") },
    { name: "the customer the app made, but another record here uses it", now: { id: "CUS1", reference_id: RECORD, creation_source: "THIRD_PARTY", version: 0 }, used: true, want: keep("used_by_another") },
    { name: "the customer the app made, which one of Square's own subscriptions still charges", now: { id: "CUS1", reference_id: RECORD, creation_source: "THIRD_PARTY", version: 0 }, charged: true, want: keep("charged_by_square") },
    { name: "used by another record and charged: the first reason stands", now: { id: "CUS1", reference_id: RECORD, creation_source: "THIRD_PARTY", version: 0 }, used: true, charged: true, want: keep("used_by_another") },
    { name: "charged, but Square answered with another customer: that reason stands", now: { id: "CPAT", reference_id: RECORD, creation_source: "THIRD_PARTY", version: 0 }, charged: true, want: keep("answered_as_another") },
  ];
  it.each(cases)("$name", ({ now, used, charged, want }) => {
    expect(decideDelete(now, owed, used ?? false, charged ?? false)).toEqual(want);
  });
});
