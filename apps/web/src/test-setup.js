// THE DUPLICATE-KEY GUARD — the permanent instrument for the class that cost a
// day on 2026-08-26 (:5348 rule 5, T3 round 5 L-1; the case is at :20867).
//
// WHAT HAPPENED, so nobody removes this without knowing what it is for.
// `Settings.jsx` gave two sibling panels the SAME `key`. React keeps only the
// last of a duplicate pair in its child map, so the FIRST panel's fiber is
// dropped WITHOUT a deletion ever being scheduled — it stays in the document,
// fully typeable, with a live Save button wired to the gym the owner had already
// left. An owner saw their previous gym's form under their current gym's name
// and could silently write to the wrong one.
//
// **React announced it on every single render** — `Encountered two children with
// the same key` — and it went past four review rounds unread, because a warning
// on stderr costs nothing to ignore and a green suite says "fine". Round 3's fix
// CAUSED it, and round 3's own test could not see it. This file is what makes
// the next one of these impossible to ignore: the warning now FAILS the run.
//
// KNOWN BLIND SPOT, stated rather than papered over: a test that replaces
// `console.error` with its own silent mock (today, exactly one does —
// `xpDisplay.render.test.jsx`) takes this guard out for the duration of that
// test. Recorded in BACKLOG.md rather than fixed here, because widening the
// guard means touching a test whose subject is something else entirely.
//
// SECOND LIMIT, equally deliberate: React de-duplicates its own warnings, so a
// second offence with an identical key inside one tree may not be re-reported.
// This is therefore a FLOOR — every failure it reports is real; it does not
// promise to report every occurrence.
import { afterEach, beforeEach } from 'vitest';

const DUPLICATE_KEY = 'two children with the same key';

const original = console.error;
let offences = [];

// Installed ONCE, at module scope, and left in place — not a `vi.spyOn`, so a
// test that installs its own spy stacks on top of this rather than racing it,
// and `mockRestore()` elsewhere cannot silently uninstall the guard.
console.error = (...args) => {
  const text = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
  if (text.includes(DUPLICATE_KEY)) offences.push(text);
  // Everything still reaches the terminal. A guard that HIDES output would trade
  // one unread warning for another.
  original(...args);
};

beforeEach(() => {
  offences = [];
});

afterEach(() => {
  if (offences.length === 0) return;
  const seen = offences;
  offences = [];
  throw new Error(
    `React reported ${seen.length} duplicate sibling key(s) during this test.\n\n` +
      `Two siblings sharing a \`key\` means React drops one WITHOUT removing it from\n` +
      `the DOM — it stays on screen, stale and interactive. See DECISIONS :20867.\n` +
      `Give each sibling a key unique among ITS OWN siblings (prefix per component,\n` +
      `e.g. \`gym-\${id}\` / \`staff-\${id}\`, or combine id with position).\n\n` +
      seen.map((s) => `  · ${s.split('\n')[0]}`).join('\n'),
  );
});
