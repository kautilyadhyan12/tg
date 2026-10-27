import { orgWords } from "@app/shared";

/** The Gym tab's heading, in the words of the places the person joined: "My gyms", "My yoga
 *  studios", "My trainers". None, or more than one kind, is "Where you train", so a yoga or
 *  Pilates member is never told "gyms" (Kd, `rulings/2026-10-23-18u-i.md`). */
const TAB_WORDS: Readonly<Record<string, string>> = {
  gym: "Gym",
  crossfit_box: "Gym",
  studio: "Studio",
  yoga_studio: "Studio",
  pilates_studio: "Studio",
  personal_trainer: "Trainer",
  clinic: "Clinic",
};

/** The fourth tab's word under its icon, short enough for the bar: the kind of place the person
 *  joined ("Gym", "Studio", "Trainer"); "Places" for more than one kind; "Gym" before any. */
export function tabWord(orgTypes: readonly unknown[]): string {
  const words = new Set(orgTypes.map((type) => (typeof type === "string" ? (TAB_WORDS[type] ?? "Gym") : "Gym")));
  const [only] = words;
  return words.size === 0 ? "Gym" : words.size === 1 && only !== undefined ? only : "Places";
}

export function placesHeading(orgTypes: readonly unknown[]): string {
  const kinds = new Set(orgTypes.map((type) => orgWords(type).itToMembersPlural));
  const [only] = kinds;
  return kinds.size === 1 && only !== undefined ? `My ${only}` : "Where you train";
}
