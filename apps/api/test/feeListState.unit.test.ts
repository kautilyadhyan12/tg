// One answer about a fee on a class's list and a personal training session (18d-iv-b-i): every class of case.
import { describe, expect, it } from "vitest";
import { feeListState } from "../src/modules/orgs/memberships/feesRepo.js";

describe("what a list says of a fee", () => {
  it.each([
    ["waived, whatever else", { fee_waived: true, fee_status: "void", fee_refund: null }, "waived"],
    ["owed", { fee_waived: false, fee_status: "open", fee_refund: null }, "owed"],
    ["paid", { fee_waived: false, fee_status: "paid", fee_refund: null }, "paid"],
    ["part of it back", { fee_waived: false, fee_status: "paid", fee_refund: "part" }, "part_refunded"],
    ["all of it back", { fee_waived: false, fee_status: "refunded", fee_refund: null }, "refunded"],
    ["all of it with Square", { fee_waived: false, fee_status: "refunded", fee_refund: "pending" }, "refund_pending"],
    ["part of it with Square", { fee_waived: false, fee_status: "paid", fee_refund: "pending" }, "refund_pending"],
    ["no waive recorded", { fee_waived: null, fee_status: "paid", fee_refund: null }, "paid"],
  ])("%s", (_case, row, state) => {
    expect(feeListState(row)).toBe(state);
  });
});
