// Pure view helpers for the gym's OWN details — the Settings screen's form.
// No React, no network; the screen imports these and the tests drive them
// directly, the pattern `consoleView.js`, `codesView.js` and `staffView.js` set.
//
// Everything here exists to stop this form making a claim the server has not
// agreed to. It is a small form and it can do two large things wrong: move a
// gym's day boundary by accident, and turn a rename into a refusal for a gym
// that is paying us.
import { timezoneOptions } from './consoleView';

/** MAY THIS PERSON EDIT THE GYM'S DETAILS?
 *
 *  `org.manage` is Kd's ruling of 2026-08-26, given at the plan gate in one
 *  word: a NEW privilege, "edit gym details", owner only. It was deliberately
 *  NOT folded into `staff.manage` — :13803's precedent, where `codes.manage` was
 *  kept apart from `codes.invite` because two rows that mean different things
 *  get different privileges or one tick silently widens the other's power.
 *
 *  **"Owner only" is owner-only BY DEFAULT, which is what the recommendation he
 *  approved said.** The privilege sits in the owner's role template and in
 *  neither the owner-only nor the last-owner-required list, so an owner may tick
 *  it across to a manager (:11429 rule 3 — ticks may widen, not only narrow).
 *  **That is why this asks for the POWER and never for the job title**: a screen
 *  reading `staffRole === 'owner'` would leave the ticked manager holding a
 *  power with no control anywhere, which is :16095's Critical/High exactly.
 *
 *  Hiding is not the enforcement (R3.3) — `requirePrivilege` answers every
 *  request and still does. This stops the form being drawn at somebody the
 *  server would only refuse. */
export function canManageOrg(privileges) {
  return Array.isArray(privileges) && privileges.includes('org.manage');
}

/** The form's starting values, from the gym row the console already holds.
 *
 *  **`null` becomes an EMPTY BOX, never a made-up value.** `city` is nullable by
 *  design, and `country` is null for every gym created before migration `0014` —
 *  the wizard collected it, the server mapped it to a currency and threw the
 *  answer away. An empty country box on those gyms is TRUE and is not a defect
 *  (:5807's own test: on screen AND wrong is the bar; this is on screen and
 *  right). What the screen must not do is guess one, and the reason is written
 *  into the migration that added the column: `INR` is `currency_display`'s own
 *  default, so inverting the currency would stamp a country onto gyms that never
 *  chose one. */
export function gymDetailsDraft(org) {
  const text = (value) => (typeof value === 'string' ? value : '');
  return {
    name: text(org?.name),
    city: text(org?.city),
    country: text(org?.country),
    timezone: text(org?.timezone),
  };
}

/** ARE THESE THE SAME FOUR BOXES? — the "has anybody typed here yet" test.
 *
 *  **T3 round 1 C/H-1 is what this exists for.** The form was seeded from the
 *  gym row once and never followed it again, on the reasoning that a re-read
 *  must not replace what somebody is halfway through typing. That reasoning is
 *  right and is unchanged; what it missed is that it applied to a form NOBODY
 *  HAD TOUCHED, so a rename made in another tab left these boxes holding the old
 *  name and time zone under a heading showing the new one — and Save, which
 *  compares the draft against the LIVE row, switched itself on and offered to
 *  put the old values back. On the time zone that is the permanent damage this
 *  screen is supposed to be incapable of.
 *
 *  So "pristine" is a comparison, not a flag: the panel keeps the draft it was
 *  last filled from and follows the gym only while the two still match. A flag
 *  would have to be cleared by every edit path and would go stale the day
 *  somebody adds a fifth box (:1239 — the class, not the case). */
export function sameGymDetails(a, b) {
  if (!a || !b) return false;
  return (
    a.name === b.name &&
    a.city === b.city &&
    a.country === b.country &&
    a.timezone === b.timezone
  );
}

/** THE TIME-ZONE PICKER, WITH THE GYM'S OWN ZONE GUARANTEED TO BE IN IT.
 *
 *  This is the one way this form could do permanent damage, so it is a helper
 *  with a test rather than a line in a component. `gyms.timezone` is the only
 *  thing the rollup worker consults when it decides where a gym's day ends
 *  (playbook trap #8), and a picker that does not contain the gym's current zone
 *  selects a DIFFERENT one the moment it is drawn — so an owner who opened
 *  Settings to fix their gym's name would move their gym's day by saving.
 *
 *  **It is not a theoretical alias problem, it is a measured one** (:10402): on
 *  the Node this repo runs, `Intl.supportedValuesOf('timeZone')` contains
 *  `Asia/Calcutta` and NOT `Asia/Kolkata`, and Chrome has been recorded
 *  reporting `Asia/Calcutta` from `resolvedOptions()` on this machine. Which
 *  member of an alias pair a runtime calls canonical is not predictable, and the
 *  gym row holds whatever was stored on the day it was created — possibly by a
 *  different browser on a different machine.
 *
 *  `timezoneOptions` already guarantees the DEVICE's zone is present, for the
 *  same reason at the create door. This adds the second guarantee and reuses
 *  that function rather than re-reading `Intl` — one place decides how this app
 *  enumerates zones.
 *
 *  An empty result is a real answer and is passed straight through: the caller
 *  draws a plain text box, and the server proves whatever is typed names a real
 *  zone. A one-item picker holding only the gym's current zone would be worse
 *  than a text box, because it could not be changed. */
export function timezoneChoices(detected, current) {
  const zones = timezoneOptions(detected);
  if (zones.length === 0) return zones;
  const held = typeof current === 'string' ? current.trim() : '';
  if (held !== '' && !zones.includes(held)) return [held, ...zones];
  return zones;
}

/** WHAT IS WRONG WITH THIS FORM, IN WORDS, BEFORE THE SERVER IS ASKED.
 *
 *  The two bounds mirrored here are the two the server enforces with a schema
 *  rather than a sentence: `name` is `.min(1)` and `timezone` is `.min(1)`. Sent
 *  empty, they come back as the raw `name: too_small`, which `errorText` then
 *  prints at a gym owner verbatim — the defect the Staff form's own length
 *  mirrors were added for (:14840, :15007 L-4). Mirroring them means the only
 *  thing on screen is a sentence somebody wrote.
 *
 *  **The COUNTRY is deliberately not here.** An empty country is not an error at
 *  all: it is what every pre-`0014` gym holds, and the patch simply leaves the
 *  field out. Refusing to save a name because a gym has never been asked where
 *  it is would be this screen inventing a requirement the server does not have.
 *
 *  Nothing here checks a LENGTH ceiling: the boxes carry `maxLength`, which is
 *  where the create wizard puts the same bound. */
export function gymDetailsProblem(draft) {
  if ((draft?.name ?? '').trim() === '') {
    return 'Your gym needs a name — it is what your members see.';
  }
  if ((draft?.timezone ?? '').trim() === '') {
    return "Your gym needs a time zone — it decides when your gym's day ends.";
  }
  return null;
}

/** WHAT TO SEND — only the boxes that actually moved, or `null` for nothing.
 *
 *  **This is the whole reason the route is a PATCH.** An absent key is left
 *  alone and `city: null` clears it, so a form that restated every field it drew
 *  could blank something nobody touched — and for the country it is worse than
 *  that. A gym on a subscription is refused (409 `currency_locked`) when the
 *  country it sends resolves to a DIFFERENT currency; the first version of the
 *  server guard asked whether the country was MENTIONED and refused a rename
 *  over an untouched one (:19656 C/H-1). The guard was fixed; a client that
 *  always sends the country would still be putting the gym's money on the table
 *  every time somebody corrects a typo. Sending the diff means the country
 *  travels only when somebody chose a different one.
 *
 *  **Everything is compared TRIMMED, because the server trims on the way in.**
 *  Without that, a trailing space typed into the name box is a change this
 *  screen believes in and the database does not, so Save would light up for a
 *  save that stores nothing.
 *
 *  **An empty country is left OUT rather than sent as `''`.** The field is
 *  `.length(2)`, so an empty string is a 400 — and there is nothing to say: the
 *  gym has no country recorded and the owner has not picked one.
 *
 *  **The country is compared upper-cased**, matching the server's own
 *  normalisation at the boundary. Otherwise `in` and `IN` read as a change,
 *  which would send a country nobody altered — the exact thing this function
 *  exists to avoid. It is SENT upper-cased for the same reason: the column's
 *  CHECK is two capitals, and a lower-case write is a 23514, i.e. a 500 where an
 *  owner should see their country saved.
 *
 *  `null` for "nothing moved" rather than `{}`: an empty patch is a 400 server
 *  side (:13803's precedent — a request that asks for nothing is a client bug),
 *  and a caller holding `null` cannot accidentally send it. */
export function gymDetailsPatch(draft, org) {
  const patch = {};

  const name = (draft?.name ?? '').trim();
  if (name !== '' && name !== (typeof org?.name === 'string' ? org.name : '')) {
    patch.name = name;
  }

  const typedCity = (draft?.city ?? '').trim();
  const nextCity = typedCity === '' ? null : typedCity;
  const storedCity = typeof org?.city === 'string' ? org.city : null;
  if (nextCity !== storedCity) patch.city = nextCity;

  const country = (draft?.country ?? '').trim().toUpperCase();
  const storedCountry = typeof org?.country === 'string' ? org.country.trim().toUpperCase() : '';
  if (country !== '' && country !== storedCountry) patch.country = country;

  const timezone = (draft?.timezone ?? '').trim();
  if (timezone !== '' && timezone !== (typeof org?.timezone === 'string' ? org.timezone : '')) {
    patch.timezone = timezone;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}
