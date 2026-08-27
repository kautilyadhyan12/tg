// Part 3 §4.2's banner state machine, §4.3's seat meter, and who may start a
// trial — pure, so the arithmetic is proven next door and the screens only draw
// it. Same shape as `codesView.js` / `staffView.js` / `gymDetailsView.js`.
//
// ══ WHAT THIS FILE WILL NOT DO, and every line of it follows from these three:
//
// **1. IT NEVER OFFERS A BUTTON THAT GOES NOWHERE.** §4.2's table pairs each
// state with a CTA — *Add payment*, *Choose plan*, *Reactivate*, *Upgrade tier*
// — and every one of them opens a Billing screen that does not exist. :19016 is
// why it does not: Kd sequenced the console so that "only the Billing TAB waits
// for stage 8, while the seat cap, the trial and the banner go live in stage 1",
// which is this card. So the STATES ship and the CTAs do not, and the copy is
// written to be complete without them. A greyed or dead button is the defect
// §2.2's own rules warn about; an absent one states nothing.
//
// **2. IT NEVER SAYS A TRIAL HAS ENDED, because nothing ends one.** :21353's
// Critical/High, measured: `subscriptions` has one writer in the whole API, no
// sweep or worker moves `trialing` → `expired`, and `trial_ends_at` is read by
// nothing that acts on it. Expiry is P3.8. The read this file draws from returns
// only the LIVE statuses (`trialing`/`active`/`past_due`, §4.1's own set), so an
// ended plan and a gym that never started one arrive here identically — which is
// honest today and is exactly why the "trial expired → grace" row of §4.2 is a
// deferral with its own `OWED.md` line rather than an arm below.
//
// **3. IT GATES ON `status`, NEVER ON `trialEndsAt` BEING NULL.** That is
// :21353's Low-5, written into the shared schema in as many words: nothing
// clears the column when a subscription leaves `trialing`, so a paying gym
// answers with the date its OLD trial ran out. A reader keying on "is this field
// set" would put "Trial — 0 days left" on a gym that has been paying for a year.
// Unreachable today only because nothing leaves `trialing`; pinned by a test.
import { calendarDaysBetween } from '../../utils/joinClock';
import { getItem, setItem } from '../../utils/storage';

/** Part 3 §2.2's Billing row is `✔ | — | —` — the owner's alone by default.
 *
 *  **It asks for the POWER, not the job title, and :15534's C/H-1 is the cost of
 *  the alternative.** `billing.manage` is a TICK (migration `0015`, backfilled
 *  onto every owner), so an owner whose office manager handles invoices can hand
 *  it over — and a screen asking `staffRole === 'owner'` would hide the button
 *  from the person the server has just been told may press it. The same seam
 *  `canManageStaff` and `canManageOrg` already sit on.
 *
 *  **Hiding is not the enforcement** (R3.3): `startOrgTrial` calls
 *  `requirePrivilege(..., 'billing.manage')` and answers 403 regardless. This
 *  stops the console drawing a control it knows will be refused. */
export function canManageBilling(privileges) {
  return Array.isArray(privileges) && privileges.includes('billing.manage');
}

/** Is this gym on a plan at all? Null-safe against every unknown the contract
 *  permits — no subscription, a non-staff caller, an api too old to say — all of
 *  which the server collapses into `subscription: null` on purpose. */
export function hasLivePlan(org) {
  return org?.subscription != null;
}

/** Is this gym in its free trial RIGHT NOW?
 *
 *  The `status` question rule 3 at the top of this file exists for. Everything
 *  below that talks about a trial asks this and not "is there an end date". */
export function isTrialing(org) {
  return org?.subscription?.status === 'trialing';
}

/** WHOLE LOCAL CALENDAR DAYS UNTIL THE TRIAL ENDS — 0 on the last day, negative
 *  once the date has passed, null when there is nothing readable to count.
 *
 *  **Calendar days, not elapsed milliseconds**, and `calendarDaysBetween` is
 *  imported rather than rewritten so this repo still has exactly one place a day
 *  comparison happens (`utils/joinClock.js`, whose own header records the four
 *  review rounds that rule cost). Flooring elapsed time here would put "3 days
 *  left" on screen at 3 days and 1 hour and flip the banner to amber a day late
 *  — a false promise about a deadline, which is where this project draws
 *  Critical (:13281).
 *
 *  **Negative is returned rather than clamped.** The date can be in the past —
 *  nothing ends a trial, so a gym sits past its own end date indefinitely — and
 *  a caller that wants to say something about that case needs to be able to see
 *  it. `bannerFor` below is what decides the words. */
export function trialDaysLeft(trialEndsAt, now = Date.now()) {
  const at = new Date(trialEndsAt ?? '');
  if (Number.isNaN(at.getTime()) || !Number.isFinite(now)) return null;
  return calendarDaysBetween(now, at.getTime());
}

/** The date the trial runs out, in the VIEWER's own locale.
 *
 *  The locale argument is left `undefined` deliberately, exactly as
 *  `formatJoinedAt` leaves it: four sites in this app force `'en-IN'` or
 *  `'en-US'` on every user on earth and have their own owed line naming each of
 *  them. This is not the place to add a fifth. */
export function trialEndDateLabel(trialEndsAt) {
  const at = new Date(trialEndsAt ?? '');
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** §4.2's own threshold, quoted not recalled: *"Seat pressure | members ≥ 90 %
 *  of cap"* (`03-part3-org-console.md:303`). */
export const SEAT_PRESSURE_RATIO = 0.9;

/** §4.2's other one: *"Trial urgent | ≤ 3 days"* (`03-part3-org-console.md:296`). */
export const TRIAL_URGENT_DAYS = 3;

/** §4.3's header meter — `members / cap` — or null when there is no meter to
 *  draw.
 *
 *  **Null has to stay null and must never become a zero.** Three separate
 *  unknowns land here: the gym is on no plan (so nothing caps it — a tracked
 *  deferral, not an oversight), the plan is a capless tier (`plans.seat_cap` is
 *  nullable and a capless band is a real shape in the price book), or the caller
 *  was not told (`seatsUsed` is a staff fact). "0 of 0 seats" is a number nobody
 *  computed, which is the one thing the severity rule names outright.
 *
 *  `used` comes from the SERVER — the same count the seat cap refuses joins by —
 *  and is never derived from a roster page here. A page is fifty rows; a gym can
 *  have six hundred. */
export function seatMeter(org) {
  const cap = org?.subscription?.seatCap;
  const used = org?.seatsUsed;
  // ONE LINE CARRIES THIS, AND IT USED TO BE TWO. The first draft checked
  // `typeof x !== 'number'` and then checked `Number.isFinite` underneath it —
  // two guards, either sufficient, neither falsifiable, so mutant C88 came back
  // ALIVE against code that was perfectly correct. `Number.isFinite` does not
  // coerce, so it already answers false for null, undefined, a string and NaN
  // alike, and the typeof line was doing nothing at all.
  //
  // Deleted rather than kept as belt-and-braces, and the mutant moved onto the
  // line that does the work — :17676's standard, and :12343's J11 before it:
  // when a mutant survives, ask whether the guarantee is OBSERVABLE before
  // assuming the test is missing.
  if (!Number.isFinite(cap) || !Number.isFinite(used) || cap <= 0) return null;
  return {
    used,
    cap,
    /** True at §4.2's 90 % and at everything above it, full included. */
    pressure: used >= cap * SEAT_PRESSURE_RATIO,
    /** The gym cannot admit anybody else — `claimSeat` refuses at `used >= cap`,
     *  so this is the screen saying the same thing the door does. */
    full: used >= cap,
  };
}

/** THE SEAT METER'S SENTENCE, AND THE ONLY PLACE IT IS WRITTEN.
 *
 *  It had three homes — this file's banner, the Overview's trial card and the
 *  Members header — and the full-gym clause was spelled out twice with nothing
 *  anchoring the copies. Two of the three could drift into saying different
 *  things about the same gym on the same screen, which is :14493's Low-2 in
 *  copy rather than in SQL. The prefix was a third copy of the same shape.
 *
 *  Null in, null out, so every caller keeps drawing nothing for a gym with no
 *  meter rather than being handed an empty string to render.
 *
 *  **The trailing full stop now appears on all three surfaces.** Two of them
 *  had none; unifying the sentence is what makes one owner possible, and a
 *  meter that reads "42 of 300 places used." on the roster and in the banner
 *  is the same true sentence in both places. */
export function seatLineText(meter) {
  if (meter === null || meter === undefined) return null;
  return meter.full
    ? `${meter.used} of ${meter.cap} places used — your gym is full, so nobody else can join yet.`
    : `${meter.used} of ${meter.cap} places used.`;
}

/** Part 3 §4.2, the persistent slot above every console screen. One banner or
 *  none.
 *
 *  **THE ORDER IS A DECISION AND §4.2 DOES NOT MAKE IT.** Its table lists states
 *  without saying which wins when two hold at once, and two routinely do — a gym
 *  three days from the end of its trial can also be at 95 % of its seats. One
 *  slot means one answer, so the ranking is: something has already gone wrong
 *  (`past_due`) · a deadline is close (`trial_urgent`) · something is happening
 *  now that stops people joining (`seat_pressure`) · a deadline is far
 *  (`trial_info`). The rule underneath it is "soonest thing the owner can do
 *  nothing about later", and it is recorded here so the next card does not
 *  re-derive a different one.
 *
 *  Returns `{ key, tone, text, dismissible }`, or null for §4.2's *"Healthy |
 *  else | no banner"*. `tone` is `'info' | 'warn'`; the screen owns the colours.
 *
 *  Every string here is complete without a button — see rule 1 at the top. */
export function bannerFor(org, now = Date.now()) {
  const sub = org?.subscription;
  const meter = seatMeter(org);

  if (sub?.status === 'past_due') {
    // TRUE AND NOTHING MORE. §4.2's copy promises "retrying" and offers *Update
    // payment method*; v1 §10's dunning is unbuilt and there is nowhere to
    // update a card, so a sentence about retries would be a promise the app
    // cannot keep (:5807). Unreachable today — nothing writes this status — and
    // written anyway, because the alternative the day it becomes reachable is
    // silence, and Kd ruled on silence at :12660: fixing a false sentence by
    // removing the sentence is a quieter defect, not a fix.
    return {
      key: 'past_due',
      tone: 'warn',
      text: "A payment for your gym didn't go through.",
      dismissible: false,
    };
  }

  if (isTrialing(org)) {
    const days = trialDaysLeft(sub.trialEndsAt, now);
    if (days !== null && days <= TRIAL_URGENT_DAYS) {
      const date = trialEndDateLabel(sub.trialEndsAt);
      // §4.2: "amber, not dismissible". The second sentence is the spec's own
      // ("Members keep Pro features only if a plan is active") in the words this
      // product actually uses — nothing on this surface is called Pro, and a
      // gym owner reading an invented product name learns nothing.
      //
      // PAST THE DATE IS ITS OWN SENTENCE and it is deliberately not "your trial
      // has ended": nothing ends a trial (rule 2 at the top), so the gym is
      // still `trialing` and its members still have the features. Saying it had
      // ended would be false in the direction that costs a gym its members'
      // trust the day it turns out to be wrong.
      const text =
        days < 0
          ? "Your trial is past its end date. Your members keep your gym's features while it is still running."
          : `Trial ends ${date ?? 'soon'}. Your members keep your gym's features only while a plan is active.`;
      return { key: 'trial_urgent', tone: 'warn', text, dismissible: false };
    }
  }

  if (meter?.pressure === true) {
    return {
      key: 'seat_pressure',
      tone: 'warn',
      // The sentence comes from `seatLineText` — the banner is one of its three
      // readers, not its author.
      text: seatLineText(meter),
      dismissible: false,
    };
  }

  if (isTrialing(org)) {
    const days = trialDaysLeft(sub.trialEndsAt, now);
    if (days === null) return null;
    // §4.2: "(dismissible/day)". The only dismissible state, and the only one
    // where dismissing is honest — the other three are about something the
    // owner is losing or is already unable to do.
    //
    // **NO SINGULAR, AND THE FIRST DRAFT HAD ONE.** `days === 1 ? '1 day left'`
    // looks obviously right and is unreachable: anything at or under
    // `TRIAL_URGENT_DAYS` has already returned above, so the smallest number
    // that reaches this line is four. Found by the test written for it going
    // red, and DELETED rather than kept as belt-and-braces — a branch that
    // cannot fire is a claim nothing can check (:17676's standard). Restoring
    // it means the urgent threshold has moved, and then the guard below it
    // needs re-reading too.
    return {
      key: 'trial_info',
      tone: 'info',
      text: `Free trial — ${days} days left.`,
      dismissible: true,
    };
  }

  return null;
}

/** WHERE A DISMISSAL IS REMEMBERED.
 *
 *  Per GYM, because an owner with two gyms is told about each of them
 *  separately, and per USER by construction — `utils/storage.js` prefixes every
 *  key with the signed-in account's id, which is what stops a gym's shared
 *  front-desk browser carrying one person's dismissal into the next person's
 *  session (:618 T3 F1's own lesson, and the reason that helper exists). */
function dismissKey(gymId) {
  return `console_banner_dismissed_${gymId}`;
}

/** Has this gym's dismissible banner been put away TODAY?
 *
 *  **It stores the INSTANT and compares calendar days, rather than storing a day
 *  number.** Both work; this one keeps every day comparison in the repo going
 *  through `calendarDaysBetween`, which is the rule `joinClock.js` spent four
 *  review rounds arriving at. "Dismissed today stays dismissed, tomorrow it
 *  comes back" is then the same arithmetic the rest of the app uses for the word
 *  "today".
 *
 *  Storage that cannot be read is "not dismissed" — the safe direction. A banner
 *  that appears when it need not is a small annoyance; one that stays hidden
 *  when a trial is ending is the thing this whole file exists to prevent. */
export function bannerIsDismissed(gymId, key, now = Date.now()) {
  if (typeof gymId !== 'string' || gymId === '') return false;
  const saved = getItem(dismissKey(gymId), null);
  if (saved === null || typeof saved !== 'object') return false;
  if (saved.key !== key) return false;
  const at = Number(saved.at);
  if (!Number.isFinite(at)) return false;
  const days = calendarDaysBetween(at, now);
  // A stored instant in the FUTURE (a clock that moved backwards) reads as
  // dismissed today rather than as a reason to throw the record away.
  return days !== null && days <= 0;
}

/** Put it away until tomorrow. The banner's KEY is stored beside the instant so
 *  dismissing "27 days left" does not also silence the amber notice three weeks
 *  later — a different sentence is a different claim on the owner's attention. */
export function dismissBanner(gymId, key, now = Date.now()) {
  if (typeof gymId !== 'string' || gymId === '') return;
  setItem(dismissKey(gymId), { key, at: now });
}
