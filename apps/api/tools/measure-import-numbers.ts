// What an import's member numbers cost at the biggest file (ROADMAP 5e-ii; CLAUDE.md §4
// "Cost at full size"): 10,000 rows against a list of 10,000 current and 2,000 past
// records. No database: the numbers are worked out inside the import's one rule, on the
// server, and that time is the time the server answers nobody.
//
//   corepack pnpm --filter api exec tsx tools/measure-import-numbers.ts
//
// Three files: the same people with no number column and none on the list (everyone is
// given one, every key worked out again); a file of new people whose numbers are every
// number the app gave (every record moved); and a monthly file of the same numbers that
// changes nothing. Each is timed with and without the numbers, so the difference is this
// job's own cost.
import { MEMBER_LIST_MAX_DATA_ROWS, type MemberListRow } from "@app/shared";
import { identityKey } from "../src/modules/orgs/memberList/fields.js";
import { reconcile, type CarriedFields, type ListEntry } from "../src/modules/orgs/memberList/reconcile.js";

const CURRENT = 10_000;
const PAST = 2_000;
const RUNS = 9;

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? Number.NaN;

const who = (i: number, memberNumber: string | null, tag = "p") => ({ fullName: `Person ${tag}${String(i)}`, email: `${tag}${String(i)}@measure.example`, phone: null, memberNumber });
const row = (i: number, w: ReturnType<typeof who>): MemberListRow => ({
  row: i + 2,
  review: [],
  ...w,
  status: "Active",
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  paymentStatus: null,
  dateOfBirth: null,
  extra: [],
  identityKey: identityKey(w),
});
const entry = (i: number, w: ReturnType<typeof who>, former: boolean): ListEntry => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  identityKey: identityKey(w),
  review: { needsReview: [], reviewChecked: [] },
  ...w,
  status: "Active",
  membershipType: null,
  joinedOn: null,
  endsOn: null,
  endsOnKind: null,
  paymentStatus: null,
  dateOfBirth: null,
  extra: {},
  handEdited: [],
  former,
});
const carries = (memberNumber: boolean): CarriedFields => ({
  fullName: true,
  email: true,
  phone: false,
  memberNumber,
  status: true,
  membershipType: false,
  joinedOn: false,
  endsOn: false,
  paymentStatus: false,
  dateOfBirth: false,
});
const number = (i: number) => `M${String(i).padStart(5, "0")}`;
const list = (numbered: boolean) =>
  Array.from({ length: CURRENT + PAST }, (_, i) => entry(i, who(i, numbered ? number(i + 1) : null), i >= CURRENT));

const files: { name: string; rows: MemberListRow[]; entries: ListEntry[]; carriesNumber: boolean }[] = [
  {
    name: "no number column, nobody numbered (all given)",
    rows: Array.from({ length: MEMBER_LIST_MAX_DATA_ROWS }, (_, i) => row(i, who(i, null))),
    entries: list(false),
    carriesNumber: false,
  },
  {
    name: "new people given every number the app gave (all moved)",
    rows: Array.from({ length: MEMBER_LIST_MAX_DATA_ROWS }, (_, i) => row(i, who(i, number(i + 1), "n"))),
    entries: list(true),
    carriesNumber: true,
  },
  {
    name: "the same people and numbers again (nothing changes)",
    rows: Array.from({ length: MEMBER_LIST_MAX_DATA_ROWS }, (_, i) => row(i, who(i, number(i + 1)))),
    entries: list(true),
    carriesNumber: true,
  },
];

console.log(`file: ${String(MEMBER_LIST_MAX_DATA_ROWS)} rows; list: ${String(CURRENT)} current + ${String(PAST)} past; ${String(RUNS)} runs each`);
for (const file of files) {
  const timed = (numbering: boolean): { ms: number[]; given: number; moved: number } => {
    const ms: number[] = [];
    let given = 0;
    let moved = 0;
    for (let run = 0; run < RUNS; run++) {
      const t = performance.now();
      const out = reconcile({
        rows: file.rows,
        entries: file.entries,
        members: [],
        keptFields: [],
        carries: carries(file.carriesNumber),
        endsOnKind: null,
        mode: "add",
        hasList: true,
        ...(numbering ? { numbering: { kept: {} } } : {}),
      });
      ms.push(performance.now() - t);
      given = out.numbers?.given ?? 0;
      moved = out.numbers?.moved.length ?? 0;
    }
    return { ms, given, moved };
  };
  const without = timed(false);
  const withNumbers = timed(true);
  console.log(`${file.name}: given ${String(withNumbers.given)}, moved ${String(withNumbers.moved)}`);
  console.log(`  the import's rule without numbers: median ${median(without.ms).toFixed(1)} ms`);
  console.log(`  with numbers (server answers nobody): median ${median(withNumbers.ms).toFixed(1)} ms, worst ${Math.max(...withNumbers.ms).toFixed(1)} ms`);
}
