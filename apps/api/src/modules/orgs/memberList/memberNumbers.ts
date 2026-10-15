// THE NEXT MEMBER NUMBER (ROADMAP 5e-i; Kd, 2026-10-15).
//
// A number is a prefix and the digits at its end: "M0041" is "M" and 0041, "2024-0045"
// is "2024-" and 0045, "1042" is "" and 1042. Numbers with the same prefix, case folded,
// are one sequence. The gym's sequence is the one most of its members' numbers are in (a
// tie goes to the one with the larger number, then the prefix first in the alphabet), and
// the next number is one more than its highest, as wide as its widest so zeros in front
// are kept. A gap is never filled. A number with no digits at its end ("GOLD", "17B") is
// in no sequence; a gym with none starts at "1".
//
// THE KEPT NUMBERS: the highest number of EACH sequence that has had a number go (deleted
// for good, changed, merged away) or given, one per sequence. They never choose the
// sequence, which is the members' to choose; they only raise its highest, so a number that
// went is not given again whichever sequence the gym uses later. A gym whose members hold
// no number in a sequence continues the kept sequence with the largest number.
//
// The number is always above every number and every kept number of its sequence, so
// nobody holds it, in any case. Pure: the same numbers in, in any order, give the same
// number out.
import { MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS } from "@app/shared";

interface Parsed {
  prefix: string;
  /** The prefix folded, which is what makes two numbers one sequence. */
  folded: string;
  digits: string;
  value: bigint;
}

// ASCII digits only: \d without the u flag is [0-9].
const ENDS_IN_DIGITS = /^(.*?)([0-9]+)$/s;

function parse(number: string): Parsed | null {
  const parts = ENDS_IN_DIGITS.exec(number);
  if (parts === null) return null;
  const prefix = parts[1] ?? "";
  const digits = parts[2] ?? "";
  return { prefix, folded: prefix.toLowerCase(), digits, value: BigInt(digits) };
}

interface Sequence {
  folded: string;
  /** How many members' numbers are in it. */
  size: number;
  highest: bigint;
  /** The prefix as the highest number writes it, for a tie of spellings. */
  highestPrefix: string;
  /** Each spelling of the prefix, and how many numbers write it so. */
  spellings: Map<string, number>;
  /** The most digits any of its numbers has. */
  width: number;
}

function add(sequences: Map<string, Sequence>, number: Parsed, counted: boolean): void {
  const seen = sequences.get(number.folded);
  if (seen === undefined) {
    sequences.set(number.folded, {
      folded: number.folded,
      size: counted ? 1 : 0,
      highest: number.value,
      highestPrefix: number.prefix,
      spellings: new Map([[number.prefix, counted ? 1 : 0]]),
      width: number.digits.length,
    });
    return;
  }
  if (counted) {
    seen.size += 1;
    seen.spellings.set(number.prefix, (seen.spellings.get(number.prefix) ?? 0) + 1);
  }
  seen.width = Math.max(seen.width, number.digits.length);
  // Equal values in two spellings: the one first in code-point order, so the order the
  // numbers come in never decides.
  if (number.value > seen.highest || (number.value === seen.highest && number.prefix < seen.highestPrefix)) {
    seen.highest = number.value;
    seen.highestPrefix = number.prefix;
  }
}

/** Every sequence: the members' numbers counted, the kept ones only raising. */
function sequencesOf(numbers: readonly string[], kept: readonly string[]): Map<string, Sequence> {
  const sequences = new Map<string, Sequence>();
  for (const number of numbers) {
    const parsed = parse(number);
    if (parsed !== null) add(sequences, parsed, true);
  }
  for (const number of kept) {
    const parsed = parse(number);
    if (parsed !== null) add(sequences, parsed, false);
  }
  return sequences;
}

/** The gym's sequence: the most members' numbers, else (a gym whose members hold none) the
 *  kept one with the largest number. */
function chosen(sequences: Map<string, Sequence>): Sequence | null {
  let best: Sequence | null = null;
  for (const sequence of sequences.values()) {
    if (
      best === null ||
      sequence.size > best.size ||
      (sequence.size === best.size && sequence.highest > best.highest) ||
      (sequence.size === best.size && sequence.highest === best.highest && sequence.folded < best.folded)
    ) {
      best = sequence;
    }
  }
  return best;
}

/** The prefix as most of the sequence's numbers write it; a tie, as its highest does. */
function spellingOf(sequence: Sequence): string {
  const most = Math.max(...sequence.spellings.values());
  if (sequence.spellings.get(sequence.highestPrefix) === most) return sequence.highestPrefix;
  const tied = [...sequence.spellings].filter(([, count]) => count === most).map(([spelling]) => spelling);
  return tied.sort()[0] ?? sequence.highestPrefix;
}

/** The number the app gives the gym's next member, or null where it would be longer than
 *  a member number may be. `numbers` are the members' (current and past), `kept` the
 *  highest kept of each sequence. */
export function nextMemberNumber(numbers: readonly string[], kept: readonly string[] = []): string | null {
  const sequence = chosen(sequencesOf(numbers, kept));
  if (sequence === null) return "1";
  const next = `${spellingOf(sequence)}${(sequence.highest + 1n).toString().padStart(sequence.width, "0")}`;
  return next.length > MEMBER_LIST_MAX_MEMBER_NUMBER_CHARS ? null : next;
}

/** The kept numbers once `number` has been given or has gone: its own sequence's kept
 *  number raised to it where it is higher (as wide as the wider of the two), every other
 *  sequence's left as it was. Null where nothing changes (`number` is in no sequence, or
 *  not above what is kept). Keyed by the folded prefix. */
export function keptWith(kept: Readonly<Record<string, string>>, number: string): Record<string, string> | null {
  const going = parse(number);
  if (going === null) return null;
  const before = kept[going.folded];
  const was = before === undefined ? null : parse(before);
  if (was !== null && was.value > going.value) return null;
  const width = Math.max(going.digits.length, was?.digits.length ?? 0);
  const written = `${going.prefix}${going.value.toString().padStart(width, "0")}`;
  if (written === before) return null;
  return { ...kept, [going.folded]: written };
}
