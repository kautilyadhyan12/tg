// THE SCAN RULE (spec Part 3 §12.4): what the desk says about one read. Pure, and the only
// place the answer is decided; `scanRule.unit.test.ts` sweeps every class of case.
//
// It never refuses for a status word, a payment word or the hour. A visit's period is the
// opening period the scan falls in, or the hours status when it falls in none, so a second
// scan in the same period is the same visit and a later period that day counts again.
import type { GymAttendanceHoursStatus } from "@app/shared";
import { slotKeyFor } from "../attendanceSlot.js";

/** What was read. A pass is `fresh` only when it is ours, in its window or the next one,
 *  and not used before; a key tag and staff's pick name a record directly. */
export type ScanRead =
  | { kind: "pass"; pass: "fresh" | "old" | "used" | "garbled" }
  | { kind: "key_tag" }
  | { kind: "staff" };

/** Who the read named at THIS gym: one of its people, nobody it has, or a member number
 *  two of its records share. */
export type ScanPerson = { kind: "member" } | { kind: "not_a_member" } | { kind: "ambiguous" };

export interface ScanPeriod {
  hoursStatus: GymAttendanceHoursStatus;
  opensMinute: number | null;
  closesMinute: number | null;
}

/** This person's visits to this gym today. */
export interface VisitToday {
  slotKey: string;
  markedAt: Date;
}

export type ScanDecision =
  | { result: "fresh_pass_needed" }
  | { result: "not_a_member" }
  | { result: "see_staff" }
  | { result: "checked_in"; slotKey: string }
  | { result: "already"; slotKey: string; firstAt: Date };

export function decideScan(input: {
  read: ScanRead;
  /** Null when the read named nobody (a pass that is not fresh). */
  person: ScanPerson | null;
  period: ScanPeriod;
  visitsToday: readonly VisitToday[];
}): ScanDecision {
  if (input.read.kind === "pass" && input.read.pass !== "fresh") return { result: "fresh_pass_needed" };
  if (input.person === null || input.person.kind === "not_a_member") return { result: "not_a_member" };
  if (input.person.kind === "ambiguous") return { result: "see_staff" };
  const slotKey = slotKeyFor(input.period.hoursStatus, input.period.opensMinute, input.period.closesMinute);
  let firstAt: Date | null = null;
  for (const visit of input.visitsToday) {
    if (visit.slotKey === slotKey && (firstAt === null || visit.markedAt < firstAt)) firstAt = visit.markedAt;
  }
  return firstAt === null ? { result: "checked_in", slotKey } : { result: "already", slotKey, firstAt };
}
