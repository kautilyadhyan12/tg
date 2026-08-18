// Pure view helpers for the gym console. No React, no network — the screens
// import these and the tests exercise them directly, which is the pattern
// `exerciseLibraryView.js` and `progressClamp.js` already set here.
//
// Everything in this file exists to stop the console asserting something it
// does not know: a country the server would refuse, a timezone that is not the
// user's own, a member count taken off one page of a cursor walk, or a join
// code printed as usable when the join path will turn it away.
import { SUPPORTED_COUNTRIES } from '@app/shared';

/** Region names from the browser's own database rather than a table typed here.
 *  A hand-written name table is a second place to be wrong about a country's
 *  name, and it goes stale; `Intl` already ships one. Falls back to the raw
 *  two-letter code, which is plainer but never fewer options. */
function regionNamer() {
  let dn;
  try {
    dn = new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return (code) => code;
  }
  return (code) => {
    try {
      return dn.of(code) ?? code;
    } catch {
      return code;
    }
  };
}

/** The country picker's options — built from the SERVER'S OWN supported list.
 *
 *  This is the whole point of the helper. `SUPPORTED_COUNTRIES` is the same
 *  export the API's `currencyForCountry` is built on, so the picker cannot
 *  offer a country that org-create then refuses with "we're not open there
 *  yet". A list sourced from anywhere else — a copy, a fuller ISO list, a
 *  guess — reintroduces exactly that dead end, and it is why `OWED.md` says
 *  this in as many words.
 *
 *  Sorted by the NAME a person reads, not by the code they never see. */
export function countryOptions() {
  const name = regionNamer();
  return SUPPORTED_COUNTRIES.map((value) => ({ value, label: name(value) })).sort((a, b) =>
    a.label.localeCompare(b.label, 'en'),
  );
}

/** The device's IANA zone, or null when the environment cannot say.
 *
 *  NEVER a guess. Assuming a zone is precisely the defect the user-timezone
 *  card was written to fix, and here it would decide what "today" means for a
 *  whole gym's daily figures — permanently, since the value is written into the
 *  org row at creation. */
export function detectTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Every IANA zone this runtime knows, with `detected` GUARANTEED to be in it.
 *
 *  The guarantee is measured, not defensive habit: on the Node this repo runs,
 *  `Intl.supportedValuesOf('timeZone')` contains `Asia/Calcutta` and NOT
 *  `Asia/Kolkata`, while Chrome has been recorded reporting `Asia/Calcutta`
 *  from `resolvedOptions()` on this machine. Which member of an alias pair a
 *  runtime calls canonical is not something this code can predict — and a
 *  picker that quietly lacks the user's own zone selects somebody else's
 *  instead, which is the wrong-day-boundary bug arriving through the front
 *  door.
 *
 *  An empty result is a real answer, not an error: the caller renders a plain
 *  text box instead of a picker, and the server validates whatever is typed. */
export function timezoneOptions(detected) {
  let zones;
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  if (!Array.isArray(zones)) zones = [];
  if (typeof detected === 'string' && detected !== '' && !zones.includes(detected)) {
    return [detected, ...zones];
  }
  return zones;
}

/** Part 3 §2.2: the console shows only the gyms the caller is STAFF of.
 *
 *  A row with `staffRole: null` is somewhere the caller is merely a member —
 *  the server answers 404 to every console read on it (membership is not
 *  staffing), so listing it here would hand an owner a door that opens onto an
 *  error. The member-facing view of "gyms I belong to" is a different screen
 *  and is not built. */
export function manageableOrgs(orgs) {
  return (orgs ?? []).filter((o) => o?.staffRole != null);
}

/** The org with this slug, or null. The console's URLs are `/console/:orgSlug`
 *  (Part 3 §3.1) while the API is keyed by uuid, so the slug is resolved
 *  against the caller's own org list — which means an unknown slug and a gym
 *  the caller does not staff are indistinguishable here, exactly as the server
 *  intends them to be. */
export function findOrgBySlug(orgs, slug) {
  return manageableOrgs(orgs).find((o) => o.slug === slug) ?? null;
}

/** Can a member actually join with this code RIGHT NOW?
 *
 *  The three refusals mirror the join path's, statement for statement (paused ·
 *  expired · uses at max_uses). A console that printed a code under "share this
 *  with your members" when the server will refuse it is promising something
 *  untrue, which is the severity rule's own example.
 *
 *  `now` is injected so a test does not race the clock. A malformed
 *  `expiresAt` compares false and leaves the code live — the server writes ISO
 *  instants, and guessing that an unreadable date means "expired" would take a
 *  working code away from a gym. */
export function codeState(code, now = Date.now()) {
  if (!code) return { live: false, reason: 'unknown', label: 'Unknown' };
  if (code.paused) return { live: false, reason: 'paused', label: 'Paused' };
  const expiresAt = code.expiresAt == null ? null : new Date(code.expiresAt).getTime();
  if (expiresAt !== null && !Number.isNaN(expiresAt) && expiresAt <= now) {
    return { live: false, reason: 'expired', label: 'Expired' };
  }
  if (code.maxUses != null && code.uses >= code.maxUses) {
    return { live: false, reason: 'exhausted', label: 'Fully used' };
  }
  return { live: true, reason: null, label: 'Active' };
}

/** What to print for "how many members", given ONE page of the cursor walk.
 *
 *  With `nextCursor` set, the rows in hand are not the whole roster, so the
 *  length of `items` is not the member count — printing it as one would put a
 *  wrong number in front of a gym owner. A bound is the honest thing to say. */
export function memberCountLabel(page) {
  if (!page || !Array.isArray(page.items)) return null;
  const n = page.items.length;
  if (page.nextCursor != null) return `${n}+ members`;
  return n === 1 ? '1 member' : `${n} members`;
}

/** How many people have JOINED, as opposed to how many memberships exist.
 *
 *  The owner is member #1 by construction (Part 3 §4.0 step 6) and carries the
 *  complimentary flag, so a brand-new gym has one membership and nobody has
 *  joined it. Returns null when the page is truncated, because then the answer
 *  is not knowable from what is in hand. */
export function joinedCount(page) {
  if (!page || !Array.isArray(page.items)) return null;
  if (page.nextCursor != null) return null;
  return page.items.filter((m) => m?.complimentary !== true).length;
}

/** A join date, in the VIEWER's own locale.
 *
 *  The locale argument is deliberately left `undefined`. Four sites in this app
 *  force `'en-IN'` or `'en-US'` on every user on earth and have their own owed
 *  line naming each of them; this is not the place to add a fifth. */
export function formatJoinedAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The label of the code somebody joined through — Part 3 §2.1's group
 *  mechanism. Nullable in the contract, so an em dash rather than a fabricated
 *  "Front Desk". */
export function groupLabelText(member) {
  const label = member?.groupLabel;
  return typeof label === 'string' && label !== '' ? label : '—';
}

/** Part 3 §4.0 step 1's org-type picker. `clinic` is absent by Kd's ruling of
 *  2026-08-18 — *"no click will be there only gyms and fitness centers"* — and
 *  the create schema is narrowed to match, so an added option here would be
 *  refused by the server. `studio` stays: a PT or boutique studio is a fitness
 *  business, not a medical one. */
export const ORG_TYPE_CHOICES = [
  { value: 'gym', label: 'Gym', hint: 'A gym or fitness centre with members' },
  { value: 'studio', label: 'Studio', hint: 'A boutique or personal-training studio' },
];
