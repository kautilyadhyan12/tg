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
// **2. IT NEVER SAYS A TRIAL HAS ENDED — and the REASON changed on 2026-08-28,
// while the behaviour did not.** This said *"because nothing ends one"*, which
// was :21353's measured Critical/High and stopped being true the same day the
// expiry sweep shipped (:22341): a worker now moves `trialing` → `expired` at
// 04:00. Corrected here rather than only where it was noticed (:5748) — a stale
// reason is worse than none, because the next reader takes it as evidence.
//
// **What is still true is that this file never announces an ended TRIAL**, and
// the reason is that it cannot tell one from a gym that never subscribed. The
// read it draws from serves only the LIVE statuses (`trialing`/`active`/
// `past_due`, §4.1's own set), so once the sweep moves the row the gym arrives
// with `subscription: null` — the same shape a gym that never had a plan
// arrives in. So the words below say *"this gym has no plan"*, which is true of
// both, and never *"your trial ended"*, which is true of one.
//
// **AND THE THIRD PARAGRAPH OF THIS BLOCK IS NOW WRONG TOO, so it is corrected
// rather than stepped over** (:5748, :22782). It said §4.2's "trial expired →
// grace" row and the read-only console "are still deferrals with their own
// `OWED.md` lines". The server half shipped 2026-08-29 (:23711) and the screens
// are this card: `consoleIsReadOnly` below is the state, `bannerFor` draws the
// row, and five panels grey their controls out on it. **The owner still meets
// the unskippable prompt** (`PlanModal`, :22215/:22697) rather than the banner —
// everything this file adds today is what the gym's STAFF see.
//
// **AND "an ended plan and a gym that never started one arrive here
// identically" IS NO LONGER TRUE EITHER.** That identity was :22341 §7's
// finding, and `/v1/orgs/mine` now carries `ownerTrialUsed` to break it
// (:22921) — which is the whole reason `planPromptFor` below can pick an arm.
//
// **3. IT GATES ON `status`, NEVER ON `trialEndsAt` BEING NULL.** That is
// :21353's Low-5, written into the shared schema in as many words: nothing
// clears the column when a subscription leaves `trialing`, so a paying gym
// answers with the date its OLD trial ran out. A reader keying on "is this field
// set" would put "Trial — 0 days left" on a gym that has been paying for a year.
// Unreachable today only because nothing leaves `trialing`; pinned by a test.
import { orgWords, PAID_PLAN_GRACE_DAYS, SMALLER_SIZE_DECIDE_HOURS } from '@app/shared';
import { calendarDaysBetween } from '../../utils/joinClock';
import { getItem, setItem } from '../../utils/storage';
import { viewerPrivileges } from './consoleView';

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

/** IS THIS GYM'S CONSOLE READ-ONLY RIGHT NOW — Part 3 §4.2's *"the console stays
 *  read-only 14 days, then archived"*, and Kd's ruling of 2026-08-29 that it
 *  stops **every member of staff** rather than only whoever can pay (:23711).
 *
 *  **`true` AND NOTHING ELSE, WHICH IS THE ONE LINE TO READ TWICE.**
 *  `consoleReadOnly` is three-state and `null` means *"we could not ask"* — a
 *  plain member, or an api older than this bundle — **never "locked"** (C97's
 *  rule; the shared schema says so in as many words). Greying a control out on
 *  an unknown is a screen refusing something the server would have allowed, with
 *  no way for the person to find out which. So an unknown greys out NOTHING —
 *  safe precisely because **hiding is not the enforcement** (R3.3): a console
 *  that draws every control still cannot change a thing.
 *
 *  **IT IS NOT `!hasLivePlan(org)`.** That null has three causes and two of them
 *  are ignorance (the field above says so), so deriving the lock from it would
 *  grey a trainer's whole console out on a gym that is paying perfectly well. */
export function consoleIsReadOnly(org) {
  return org?.consoleReadOnly === true;
}

/** WHAT A GREYED CONTROL SAYS, AND THE ONLY PLACE IT IS WRITTEN.
 *
 *  **It is the SERVER's own sentence, verbatim** — `notOnPlanMessage` in
 *  `apps/api/src/modules/orgs/service.ts`, the message its 409 carries — for the
 *  reason every refusal on this console prints the server's words: the screen
 *  and the door must not come to say different things about one refusal. Five
 *  panels draw it, so it lives here rather than in five string literals
 *  (`seatLineText`'s precedent; :14493's Low-2 is what drift costs).
 *
 *  **No next step, because the product has none.** Nothing can put a gym back on
 *  a plan today — there is no payment path and one trial per OWNER ever — so a
 *  sentence naming one would be a promise with no code behind it (:5807).
 *
 *  **It is true for EVERY staff role, which is what Kd's ruling required of it.**
 *  A trainer reading it cannot subscribe, so it does not tell them to; and it is
 *  not *"ask your gym's owner"*, because the reader may BE the owner. */
export function readOnlyNote(orgType) {
  return `This ${orgWords(orgType).it} needs a plan before anything here can be changed.`;
}

/** THE WAITING QUEUE'S OWN SENTENCE, and it is a DIFFERENT fact from the note
 *  above — which is why it is not that one (:23928's Low-5).
 *
 *  `READ_ONLY_NOTE` is about the CONTROLS. This is about the PEOPLE: a lapsed
 *  gym's Confirm answers 409, so applicants sit in a queue nobody can clear, and
 *  a queue that says nothing is the console half of that dead end.
 *
 *  **THE SECOND SENTENCE ARRIVED 2026-08-30, IN THE COMMIT THAT MADE IT TRUE.**
 *  Card A shipped this constant with one sentence and wrote down why the
 *  obvious second one — *"they keep their place"* — was missing: Kd had ruled it
 *  on 2026-08-29, and it was NOT TRUE YET, because an application still died 14
 *  days after it was made whatever the gym's plan was doing
 *  (`APPLICATION_TTL_DAYS`). **Writing a reassurance before the behaviour exists
 *  is exactly :5807's class**, so two tests held it out — one on this constant
 *  and one at the screen — precisely so that the copy could not change until the
 *  code did. It now has: `sweep.ts`'s expiry holds while the gym has no live
 *  plan, and the waiting person's own card says so.
 *
 *  **AND IT STILL STOPS SHORT OF THE THING THAT IS NOT BUILT.** It does not say
 *  the waiting people will be let in when the gym comes back: nothing in this
 *  product can put a lapsed gym back on a plan, so a held request whose deadline
 *  has already passed needs the PAYMENT card to survive the first sweep after
 *  the gym subscribes (`OWED.md`). "They keep their place" is true today;
 *  "we'll confirm them for you later" would be the same defect one card on. */
export function readOnlyQueueNote(orgType) {
  return `Nobody can be let in until this ${orgWords(orgType).it} is on a plan. The people waiting keep their place.`;
}

/** §4.2's *"Trial expired → grace"* row, in words true of BOTH ways a gym
 *  arrives here.
 *
 *  **The spec's own copy is "Trial ended — members have moved to the free tier"
 *  and it is not used, for two measured reasons.** A gym that NEVER subscribed
 *  reaches this state too, and for them no trial ended and nobody "moved" — they
 *  were never on anything else. One console field answers both (`consoleReadOnly`
 *  asks whether there is a live plan, never how the gym got here), so one
 *  sentence has to be true of both or the banner is lying to half the gyms that
 *  see it.
 *
 *  **AND NO CTA, which is §4.2's other departure and the same one every other
 *  state here makes** — *Reactivate* opens a Billing screen that does not exist
 *  (rule 1 at the top of this file, :19016's sequencing). The sentence is
 *  complete without a button.
 *
 *  The members clause is kept because it is the consequence an owner most needs
 *  and it is Kd's own ruling: a lapsed gym's members fall back to the FREE app
 *  and are **never locked out** (:22215 §3.4). */
export function consoleReadOnlyBanner(orgType) {
  const words = orgWords(orgType);
  return `This ${words.it} has no plan. Nothing here can be changed, and your ${words.people} get the free app only.`;
}

/** The read-only banner when a paid plan's payment is overdue (its grace ended): the fix
 *  is the payment method, which pays what is owed and opens everything again. Staff who
 *  cannot manage billing are told who can, never to press a button they are not shown. */
export function paymentOverdueBanner(orgType, canPay) {
  const words = orgWords(orgType);
  const fix = canPay
    ? 'Update your payment method to pay now; Paddle also tries your card again by itself.'
    : 'Whoever manages billing can update the payment method; Paddle also tries the card again by itself.';
  return `A payment for your ${words.it} is overdue. Nothing here can be changed and your ${words.people} get the free app only until it is paid. ${fix}`;
}

/** HAS THIS GYM CHOSEN AND PAID FOR A PLAN THROUGH US? During a free trial that means its
 *  card is saved and the first payment is taken when the trial ends (Kd, RULINGS
 *  2026-09-25); the server says so, and an api too old to say reads as no. */
export function isSubscribed(org) {
  return org?.subscription?.subscribed === true;
}

/** MAY THIS VIEWER PAY NOW, DURING THE FREE TRIAL? Only billing staff, only in the gym's
 *  own trial (not one already paid for), never on a read-only console, and not in rupees
 *  yet (Razorpay, ROADMAP Stage 3 item 1d). The server refuses anyone else; this only
 *  stops a button it would refuse. */
export function canPayDuringTrial(org) {
  return (
    canManageBilling(viewerPrivileges(org)) &&
    isTrialing(org) &&
    !isSubscribed(org) &&
    !consoleIsReadOnly(org) &&
    org?.currencyDisplay !== 'INR'
  );
}

/** MAY THIS VIEWER CHANGE SIZE (bigger or smaller)? A plan paid through us, in good standing
 *  (a paid trial counts), not set to end. */
export function canChangeSize(org) {
  const sub = org?.subscription;
  return (
    canManageBilling(viewerPrivileges(org)) &&
    isSubscribed(org) &&
    (sub?.status === 'active' || sub?.status === 'trialing') &&
    sub?.cancelAtPeriodEnd !== true &&
    !consoleIsReadOnly(org)
  );
}

/** CAN A BIGGER SIZE MAKE ROOM TODAY? Only on a plan already paying: in a trial, even a
 *  paid one, the limit stays the trial's until the first payment (Kd, RULINGS 2026-09-25). */
export function canMakeRoomNow(org) {
  return canChangeSize(org) && org?.subscription?.status === 'active';
}

/** The size the gym has chosen: in a paid trial, the one that starts with the first payment. */
export function chosenSeatCap(sub) {
  return Number.isFinite(sub?.nextSeatCap) ? sub.nextSeatCap : (sub?.seatCap ?? null);
}

/** "Up to 500 members from 5 Oct, when your first payment is taken." for a paid trial whose
 *  chosen size is bigger than the trial's; without a date once that first charge has failed
 *  (the size still waits for it); null otherwise. */
export function nextSizeText(sub, orgType) {
  if (!Number.isFinite(sub?.nextSeatCap)) return null;
  const date = sub.status === 'trialing' ? trialEndDateLabel(sub.currentPeriodEnd) : null;
  const who = orgWords(orgType).people;
  return date === null
    ? `Up to ${sub.nextSeatCap} ${who} once your first payment is taken.`
    : `Up to ${sub.nextSeatCap} ${who} from ${date}, when your first payment is taken.`;
}

/** The plans bigger than the gym's size, smallest first as the server lists them. None
 *  when the gym's plan has no limit to grow past. */
export function biggerPlans(plans, seatCap) {
  if (!Array.isArray(plans) || !Number.isFinite(seatCap)) return [];
  return plans.filter((p) => p?.seatCap === null || (Number.isFinite(p?.seatCap) && p.seatCap > seatCap));
}

/** A count as a person reads it: "1,000". */
function count(n) {
  return Number(n).toLocaleString();
}

/** "25 Oct, 10:07 pm" in the viewer's own locale, or null. */
function momentLabel(iso) {
  const at = new Date(iso ?? '');
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** A PAID PLAN'S HEADLINE: "Up to 1,000 members · $199 a month". */
export function planHeadline(sub, orgType) {
  const words = orgWords(orgType);
  const size = Number.isFinite(sub?.seatCap) ? `Up to ${count(sub.seatCap)} ${words.people}` : `No ${words.person} limit`;
  const price = typeof sub?.priceLabel === 'string' && sub.priceLabel !== '' ? sub.priceLabel : null;
  return price === null ? size : `${size} · ${price} a month`;
}

/** "Next payment $199 on 25 Oct" for a plan in good standing, "Ends 25 Oct" for one set to
 *  end; null when a smaller size is waiting (that line says what comes next) or there is no
 *  date. */
export function nextPaymentText(sub) {
  if (sub?.status !== 'active') return null;
  const date = trialEndDateLabel(sub.currentPeriodEnd);
  if (date === null) return null;
  if (sub.cancelAtPeriodEnd === true) return `Ends ${date}`;
  if (sub.pendingSize != null || typeof sub.priceLabel !== 'string') return null;
  return `Next payment ${sub.priceLabel} on ${date}`;
}

/** A smaller size waiting (Kd, RULINGS 2026-09-25): "Changing to 500 members ($129 a month)
 *  on 25 Oct". Null when none waits. */
export function pendingChangeText(sub, orgType) {
  const pending = sub?.pendingSize;
  if (pending == null) return null;
  const date = trialEndDateLabel(pending.from);
  const when = date === null ? 'at your next payment' : `on ${date}`;
  return `Changing to ${count(pending.seatCap)} ${orgWords(orgType).people} (${pending.priceLabel} a month) ${when}`;
}

/** Whether the gym fits the smaller size waiting: how many to remove and by when, or that it
 *  is ready. The members are counted at `decideAt`; until then the gym keeps its whole size.
 *  Null when none waits or the count is not known. */
export function pendingFit(org) {
  const sub = org?.subscription;
  const pending = sub?.pendingSize;
  const used = org?.seatsUsed;
  if (pending == null || !Number.isFinite(used)) return null;
  const who = orgWords(org?.orgType).people;
  if (used <= pending.seatCap) {
    const date = trialEndDateLabel(pending.from);
    return { tooMany: false, text: `You're ready: you'll move to ${count(pending.seatCap)} ${who}${date === null ? '' : ` on ${date}`}.` };
  }
  return { tooMany: true, text: tooManyWarning(used, pending.seatCap, pending.decideAt, sub, org?.orgType) };
}

function tooManyWarning(used, targetCap, decideAt, sub, orgType) {
  const who = orgWords(orgType).people;
  const by = momentLabel(decideAt);
  const stay = Number.isFinite(sub?.seatCap) ? `${count(sub.seatCap)} ${who}` : 'your size';
  const price = typeof sub?.priceLabel === 'string' ? ` at ${sub.priceLabel} a month` : '';
  return `You have ${count(used)} ${who}. Remove ${count(used - targetCap)}${by === null ? '' : ` by ${by}`}, or you'll stay on ${stay}${price}.`;
}

/** The smaller size last chosen was not made: the gym had too many members when it was due. */
export function sizeKeptText(sub, orgType) {
  const kept = sub?.sizeKept;
  if (kept == null) return null;
  const who = orgWords(orgType).people;
  const size = Number.isFinite(sub?.seatCap) ? `${count(sub.seatCap)} ${who}` : 'your size';
  const price = typeof sub?.priceLabel === 'string' ? `, so you pay ${sub.priceLabel} a month` : '';
  return `Your size stayed at ${size}: you had ${count(kept.members)} when it was due to change, more than ${count(kept.seatCap)}${price}. Change size again whenever you're ready.`;
}

/** Every size on the gym's price list, as Change size lists them: the gym's own, one waiting,
 *  and what choosing each other one does. A smaller size on a paying plan starts with the next
 *  payment, and its note says how many members to remove first; in a paid trial it is made at
 *  once, so it cannot be chosen while the gym has more members than it holds. */
export function sizeRows(plans, org) {
  const sub = org?.subscription;
  if (!Array.isArray(plans) || sub == null) return [];
  const trialing = sub.status === 'trialing';
  const onSize = trialing ? chosenSeatCap(sub) : (sub.seatCap ?? null);
  const waiting = sub.pendingSize?.seatCap ?? null;
  const used = org?.seatsUsed;
  const who = orgWords(org?.orgType).people;
  const nextOn = trialEndDateLabel(sub.currentPeriodEnd);
  return plans.map((plan) => {
    const cap = Number.isFinite(plan?.seatCap) ? plan.seatCap : null;
    if (cap === onSize) return { plan, kind: 'current', note: 'Your size', warning: null, disabled: true };
    if (cap !== null && cap === waiting) {
      const on = trialEndDateLabel(sub.pendingSize.from);
      return { plan, kind: 'waiting', note: on === null ? 'Changing to this' : `Changing to this on ${on}`, warning: null, disabled: true };
    }
    if (cap === null || (onSize !== null && cap > onSize)) {
      return { plan, kind: 'bigger', note: trialing ? 'From your first payment' : 'Pay the difference now', warning: null, disabled: false };
    }
    const over = Number.isFinite(used) && used > cap;
    if (trialing) {
      return {
        plan,
        kind: 'smaller',
        note: 'Nothing to pay now',
        warning: over ? `You have ${count(used)} ${who}. Remove ${count(used - cap)} to choose this size.` : null,
        disabled: over,
      };
    }
    const decideAt = nextDecideAt(sub.currentPeriodEnd);
    return {
      plan,
      kind: 'smaller',
      note: nextOn === null ? 'From your next payment' : `From ${nextOn}`,
      warning: over ? tooManyWarning(used, cap, decideAt, sub, org?.orgType) : null,
      disabled: false,
    };
  });
}

/** When a smaller size chosen now would be decided: its members counted, before the next payment. */
function nextDecideAt(periodEnd) {
  const at = new Date(periodEnd ?? '');
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getTime() - SMALLER_SIZE_DECIDE_HOURS * 60 * 60 * 1000).toISOString();
}

/** A PAID TRIAL'S NEXT STEP: "Your first payment of $79 is on 3 Oct." Null for anything
 *  else, or when the server has not said the price or the date. */
export function firstPaymentText(sub) {
  if (sub?.status !== 'trialing' || sub?.subscribed !== true) return null;
  const date = trialEndDateLabel(sub.currentPeriodEnd);
  const price = typeof sub.priceLabel === 'string' && sub.priceLabel !== '' ? sub.priceLabel : null;
  if (date === null || price === null) return null;
  return `Your first payment of ${price} is on ${date}.`;
}

/** WHAT A BIGGER SIZE COSTS, IN ONE SENTENCE, from the server's preview of Paddle's own
 *  sums: now (with the tax shown when there is some) and from when. */
export function sizeChargeText(preview) {
  if (preview == null) return null;
  const price = `${preview.priceLabel} a month`;
  const due = preview.dueNow;
  const from = trialEndDateLabel(preview.nextPaymentAt);
  if (due == null) {
    return from === null ? `Nothing to pay now. Then ${price}.` : `Nothing to pay now. ${price} from ${from}.`;
  }
  const breakdown = due.taxLabel === null ? '' : ` (${due.subtotalLabel} plus ${due.taxLabel} tax)`;
  const then = from === null ? `then ${price}` : `then ${price} from ${from}`;
  return `You pay ${due.totalLabel} now${breakdown} for the rest of this month, ${then}.`;
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
 *  **Negative is returned rather than clamped**, and the window it covers is now
 *  BOUNDED where it once was not. This said "nothing ends a trial, so a gym sits
 *  past its own end date indefinitely"; since 2026-08-28 the 04:00 sweep ends one
 *  (:22341), so a gym is past its end date only until that job next runs. The
 *  case is smaller and it is not gone, so the negative is still returned and
 *  `bannerFor` below still decides the words. */
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
 *  meter that reads "42 of 300 members." on the roster and in the banner
 *  is the same true sentence in both places. */
export function seatLineText(meter, orgType) {
  if (meter === null || meter === undefined) return null;
  return meter.full
    ? `${meter.used.toLocaleString()} of ${meter.cap.toLocaleString()} ${orgWords(orgType).people} — your ${orgWords(orgType).it} is full, so nobody else can join yet.`
    : `${meter.used.toLocaleString()} of ${meter.cap.toLocaleString()} ${orgWords(orgType).people}.`;
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
 *  else | no banner"*. `tone` is `'info' | 'warn' | 'danger'`; the screen owns
 *  the colours.
 *
 *  Every string here is complete without a button — see rule 1 at the top. */
export function bannerFor(org, now = Date.now()) {
  const sub = org?.subscription;
  const meter = seatMeter(org);
  // THE WORDS COME OFF THE ORG THIS BANNER IS ABOUT, so no caller has to know
  // there is a vocabulary at all (roadmap 2b).
  const words = orgWords(org?.orgType);

  // §4.2's "Trial expired → grace" row, FIRST — and the position is
  // explicitness rather than a tie-break, which is worth saying plainly because
  // every other branch here IS a tie-break.
  //
  // It cannot collide with the four below: the server computes this field and
  // `subscription` off ONE lateral over the same three live statuses (:23711),
  // so `consoleReadOnly === true` means `subscription === null`, and `past_due`,
  // both trial branches and the seat meter all need a subscription to fire. It
  // is first because it is the most serious thing true of this gym, which is
  // where a reader expects to find it.
  if (consoleIsReadOnly(org)) {
    return {
      key: 'read_only',
      tone: 'danger',
      text:
        org?.paymentOverdue === true
          ? paymentOverdueBanner(org?.orgType, canManageBilling(viewerPrivileges(org)))
          : consoleReadOnlyBanner(org?.orgType),
      // §4.2 gives this row no dismissal and it would be wrong to invent one:
      // the only dismissible state is `trial_info`, where putting the notice
      // away for a day costs the owner nothing. This one is about something the
      // gym cannot do until it acts.
      dismissible: false,
    };
  }

  if (sub?.status === 'past_due') {
    // Paddle retries the card by itself; the days are the grace the worker gives a
    // paying gym before its members lose the plan (Part 5 §8, ROADMAP 1c-i).
    return {
      key: 'past_due',
      tone: 'warn',
      text: canManageBilling(viewerPrivileges(org))
        ? `A payment for your ${words.it} didn't go through. Paddle will try your card again by itself, or you can update your payment method under Plan on the Overview. Your ${words.people} keep everything for ${PAID_PLAN_GRACE_DAYS} days after a failed payment.`
        : `A payment for your ${words.it} didn't go through. Paddle will try the card again by itself, or whoever manages billing can update the payment method. Your ${words.people} keep everything for ${PAID_PLAN_GRACE_DAYS} days after a failed payment.`,
      dismissible: false,
    };
  }

  // A trial the gym has paid for needs no warning: the plan it chose starts by itself.
  if (isTrialing(org) && !isSubscribed(org)) {
    const days = trialDaysLeft(sub.trialEndsAt, now);
    if (days !== null && days <= TRIAL_URGENT_DAYS) {
      const date = trialEndDateLabel(sub.trialEndsAt);
      // §4.2: "amber, not dismissible". The second sentence is the spec's own
      // ("Members keep Pro features only if a plan is active") in the words this
      // product actually uses — nothing on this surface is called Pro, and a
      // gym owner reading an invented product name learns nothing.
      //
      // PAST THE DATE IS ITS OWN SENTENCE and it is deliberately not "your trial
      // has ended". **The sentence is unchanged and its reason is not** (rule 2
      // at the top): it used to be that nothing ended a trial, and since
      // 2026-08-28 the sweep does — but this branch is reached only while the
      // row still says `trialing`, i.e. in the window between the end date and
      // the next 04:00 run, and in that window the gym's members really do still
      // have the features. Once the sweep moves the row there is no live
      // subscription, so this function draws nothing and the owner meets the
      // unskippable prompt instead. Saying it had ended HERE would be false in
      // the direction that costs a gym its members' trust.
      const text =
        days < 0
          ? `Your trial is past its end date. Your ${words.people} keep your ${words.it}'s features while it is still running.`
          : `Trial ends ${date ?? 'soon'}. Your ${words.people} keep your ${words.it}'s features only while a plan is active.` +
            (canPayDuringTrial(org) ? ' Choose a plan under Plan on the Overview; you pay when the trial ends.' : '');
      return { key: 'trial_urgent', tone: 'warn', text, dismissible: false };
    }
  }

  if (meter?.pressure === true) {
    return {
      key: 'seat_pressure',
      tone: 'warn',
      // The sentence comes from `seatLineText` — the banner is one of its three
      // readers, not its author.
      text:
        seatLineText(meter, org?.orgType) +
        (canMakeRoomNow(org) ? ' Press Change size under Plan on the Overview.' : ''),
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
    // A free trial's last three days returned above; a paid trial's reach here, so
    // one day and the last day have their own words.
    const left = days <= 0 ? 'Free trial — last day.' : days === 1 ? 'Free trial — 1 day left.' : `Free trial — ${days} days left.`;
    const first = firstPaymentText(sub);
    return {
      key: 'trial_info',
      tone: 'info',
      text: first === null ? left : `${left} ${first}`,
      dismissible: true,
    };
  }

  return null;
}

/** WHICH FACE THE UNSKIPPABLE PROMPT SHOWS THIS GYM, OR `null` FOR NO PROMPT AT
 *  ALL — Kd's ruling of 2026-08-28 (:22215, :22697): *"whenver a gym is created
 *  there is trial pop up and they can not skip that after the trail ends there
 *  is subscription plan pop up they can not skip it"*, and the correction that
 *  settled its shape — *"a pop up in the middle of the screen is needed for free
 *  trial not a button"*.
 *
 *  Three answers, and every one of the four lines below is a ruling rather than
 *  a preference:
 *
 *  **`null` FOR ANYBODY WHO CANNOT PAY.** Kd ruled 2026-08-28 (:22921 §1) that
 *  the prompt stops only whoever holds `billing.manage` — a trainer or manager
 *  without it uses the console as normal. Blocking somebody who has no way to
 *  subscribe is :22215 §4's brick wall pointed at the wrong person. It asks the
 *  POWER through `viewerPrivileges` and never `staffRole === 'owner'`, which is
 *  :15534 C/H-1's shape and the seam `canManageBilling` already sits on.
 *
 *  **`null` FOR A GYM ON A LIVE PLAN, DECIDED BY STATUS AND NEVER BY A DATE.**
 *  `hasLivePlan` reads `subscription`, which the server builds from §4.1's three
 *  granting statuses only — so a trialling gym is past this line and a gym whose
 *  trial the 04:00 sweep has ended is not. That is :21580's rule (c) and it is
 *  also the whole answer to :22697 §4's second open question (what a gym sees
 *  between its trial ending and the sweep running): until the row moves, the gym
 *  still has its console, and §4.2's banner already says the trial is past its
 *  end date. **A reader keying on `trialEndsAt` instead would seal a PAYING gym
 *  out of its own console the day billing exists.**
 *
 *  **`'trial'` vs `'subscribe'` IS `ownerTrialUsed` AND NOTHING ELSE.** One
 *  trial per OWNER ever (Part 5 §12), so the owner of a second gym is shown the
 *  real plans rather than a button that can only answer 409 — Kd's ruling at
 *  :22697 §1, *"they will be showed subscription option that they can take and
 *  say that they alreday ahd a free trial"*.
 *
 *  **AND `null` FOR ANY OTHER VALUE, WHICH IS THE MOST IMPORTANT LINE HERE.**
 *  `ownerTrialUsed` is `.nullable().default(null)`: null means *"we could not
 *  ask"* — a non-staff caller, or an api older than this bundle — never "no".
 *  For every other field on that row an unknown state costs a sentence; behind a
 *  prompt that cannot be closed it would seal a person out of their own console
 *  over a field their server is simply too old to send. **So the test is for the
 *  two definite answers, and everything else draws nothing at all.** */
export function planPromptFor(org) {
  if (!canManageBilling(viewerPrivileges(org))) return null;
  if (hasLivePlan(org)) return null;
  // A paid plan owed money: the card pays it, and a new plan would charge twice.
  if (org?.paymentOverdue === true) return 'overdue';
  if (org?.ownerTrialUsed === false) return 'trial';
  if (org?.ownerTrialUsed === true) return 'subscribe';
  return null;
}

/** HOW MANY MEMBERS ONE PLAN ADMITS, as a sentence.
 *
 *  **The plan is identified by its seat cap because that is the only human fact
 *  its row carries** — `plans.name_key` holds `plan.org_b1_us_m` and this
 *  product has no translation table to resolve it against, so a name here would
 *  be a chat naming Kd's products (the shared schema says so in as many words).
 *
 *  **A null cap is a WORD and never a zero** (:5807): `plans.seat_cap` is
 *  nullable and a capless tier is a real shape in the price book, so "0 members"
 *  would be a number nobody computed printed against a plan that limits nobody. */
export function planSeatLabel(seatCap, orgType) {
  const words = orgWords(orgType);
  if (!Number.isFinite(seatCap) || seatCap <= 0) return `No ${words.person} limit`;
  return `Up to ${seatCap.toLocaleString()} ${words.people}`;
}

/** THE PRICE, AS THE SERVER WROTE IT, PLUS HOW OFTEN IT IS CHARGED.
 *
 *  `priceLabel` arrives already formatted and is the ONLY money field on the
 *  wire — there is deliberately no minor-unit integer beside it, so there is
 *  nothing here to divide by 100 (R10.4, R6.1). This function does no
 *  arithmetic; it puts two server facts in one sentence.
 *
 *  Every org row in today's book is monthly, and the list route filters to
 *  `interval = 'month'` for that reason — but the interval is PRINTED rather
 *  than assumed, because a price whose period is silent means something
 *  different the day an annual tier is seeded. */
export function planPriceText(plan) {
  const price = typeof plan?.priceLabel === 'string' ? plan.priceLabel : null;
  if (price === null || price === '') return null;
  return plan?.interval === 'year' ? `${price} a year` : `${price} a month`;
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
