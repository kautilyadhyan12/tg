import { orgWords } from "@app/shared";

/** The Gym tab's heading, in the words of the places the person joined: "My gyms", "My yoga
 *  studios", "My trainers". None, or more than one kind, is "Where you train", so a yoga or
 *  Pilates member is never told "gyms" (Kd, `rulings/2026-10-23-18u-i.md`). */
export function placesHeading(orgTypes: readonly unknown[]): string {
  const kinds = new Set(orgTypes.map((type) => orgWords(type).itToMembersPlural));
  const [only] = kinds;
  return kinds.size === 1 && only !== undefined ? `My ${only}` : "Where you train";
}
