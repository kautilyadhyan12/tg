// Nobody the gym's list says is under 18 is invited (RULINGS 2026-09-24): the app is
// for 18 and over, and a gym's list can hold younger people on a family plan. The rule
// is shared with the console, which says so on a person's page; the day is the gym's.
import { underAgeOn } from "@app/shared";
import { dayInTz } from "../../gamification/streak.js";

export { underAgeOn };

/** `underAgeOn` for the gym's own calendar day at `at`. */
export function underAgeAt(dateOfBirth: string | null, at: Date, timeZone: string): boolean {
  return underAgeOn(dateOfBirth, dayInTz(at, timeZone));
}
