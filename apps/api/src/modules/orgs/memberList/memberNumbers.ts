// THE NEXT MEMBER NUMBER (ROADMAP 5e-i; Kd, 2026-10-15).
//
// A number is a prefix and the digits at its end: "M0041" is "M" and 0041, "2024-0045"
// is "2024-" and 0045, "1042" is "" and 1042. Numbers with the same prefix, case folded,
// are one sequence. The gym's sequence is the one most of its numbers are in (a tie goes
// to the one with the larger number, then the prefix first in the alphabet), and the
// next number is one more than its highest, as wide as its widest so zeros in front are
// kept. A gap is never filled. A number with no digits at its end ("GOLD", "17B") is in
// no sequence; a gym with none starts at "1".
//
// The number is always above every number of its sequence, so nobody holds it, in any
// case. Pure: the same numbers in, in any order, give the same number out.
import { MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS } from "@app/shared";

interface Sequence {
  /** The prefix folded, which is what makes two numbers one sequence. */
  folded: string;
  /** How many numbers are in it. */
  size: number;
  highest: bigint;
  /** The prefix as the highest number writes it, for a tie of spellings. */
  highestPrefix: string;
  /** Each spelling of the prefix, and how many numbers write it so. */
  spellings: Map<string, number>;
  /** The most digits any of its numbers has. */
  width: number;
}

// ASCII digits only: \d without the u flag is [0-9].
const ENDS_IN_DIGITS = /^(.*?)([0-9]+)$/s;

/** The gym's sequence, or null where no number is in one. */
function sequenceOf(numbers: readonly string[]): Sequence | null {
  const sequences = new Map<string, Sequence>();
  for (const number of numbers) {
    const parts = ENDS_IN_DIGITS.exec(number);
    if (parts === null) continue;
    const prefix = parts[1] ?? "";
    const digits = parts[2] ?? "";
    const value = BigInt(digits);
    const folded = prefix.toLowerCase();
    const seen = sequences.get(folded);
    if (seen === undefined) {
      sequences.set(folded, { folded, size: 1, highest: value, highestPrefix: prefix, spellings: new Map([[prefix, 1]]), width: digits.length });
      continue;
    }
    seen.size += 1;
    seen.spellings.set(prefix, (seen.spellings.get(prefix) ?? 0) + 1);
    seen.width = Math.max(seen.width, digits.length);
    // Equal values in two spellings: the one first in code-point order, so the order the
    // numbers come in never decides.
    if (value > seen.highest || (value === seen.highest && prefix < seen.highestPrefix)) {
      seen.highest = value;
      seen.highestPrefix = prefix;
    }
  }
  let chosen: Sequence | null = null;
  for (const sequence of sequences.values()) {
    if (
      chosen === null ||
      sequence.size > chosen.size ||
      (sequence.size === chosen.size && sequence.highest > chosen.highest) ||
      (sequence.size === chosen.size && sequence.highest === chosen.highest && sequence.folded < chosen.folded)
    ) {
      chosen = sequence;
    }
  }
  return chosen;
}

/** The prefix as most of the sequence's numbers write it; a tie, as its highest does. */
function spellingOf(sequence: Sequence): string {
  const most = Math.max(...sequence.spellings.values());
  if (sequence.spellings.get(sequence.highestPrefix) === most) return sequence.highestPrefix;
  const tied = [...sequence.spellings].filter(([, count]) => count === most).map(([spelling]) => spelling);
  return tied.sort()[0] ?? sequence.highestPrefix;
}

const written = (sequence: Sequence, value: bigint): string => `${spellingOf(sequence)}${value.toString().padStart(sequence.width, "0")}`;

/** The number the app gives the gym's next member, or null where it would be longer than
 *  a member number may be. */
export function nextMemberNumber(numbers: readonly string[]): string | null {
  const sequence = sequenceOf(numbers);
  if (sequence === null) return "1";
  const next = written(sequence, sequence.highest + 1n);
  return next.length > MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS ? null : next;
}

/** The highest number of the gym's sequence, as wide as its widest and spelled as most of
 *  it is: kept when a number goes (a record deleted for good, a number changed), so
 *  `nextMemberNumber` over it and the numbers left never gives that number again. */
export function highestMemberNumber(numbers: readonly string[]): string | null {
  const sequence = sequenceOf(numbers);
  return sequence === null ? null : written(sequence, sequence.highest);
}
