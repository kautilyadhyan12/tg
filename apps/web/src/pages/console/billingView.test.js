// Part 3 §4.2's banner machine and §4.3's seat meter, exercised directly.
//
// The two things this file is really for:
//
//   1. **The banner must never say a trial thing about a gym that is not
//      trialling.** `trialEndsAt` is NEVER cleared when a subscription leaves
//      `trialing`, so a paying gym answers with the date its old trial ran out —
//      a reader keying on "is that field set" would put a countdown under a live
//      plan. Unreachable today only because nothing leaves `trialing`, which is
//      precisely why it needs a test rather than a comment.
//
//   2. **Nothing may be drawn as a number that nobody computed.** A gym on no
//      plan, a capless band and a caller who was not told all arrive as nulls,
//      and every one of them must produce no meter rather than "0 of 0".
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import {
  CONSOLE_READ_ONLY_BANNER,
  READ_ONLY_NOTE,
  READ_ONLY_QUEUE_NOTE,
  SEAT_PRESSURE_RATIO,
  TRIAL_URGENT_DAYS,
  bannerFor,
  bannerIsDismissed,
  canManageBilling,
  consoleIsReadOnly,
  dismissBanner,
  hasLivePlan,
  isTrialing,
  planPriceText,
  planPromptFor,
  planSeatLabel,
  seatLineText,
  seatMeter,
  trialDaysLeft,
  trialEndDateLabel,
} from './billingView';
import { setCurrentUserId } from '../../utils/storage';

/** A fixed instant with plenty of room either side of local midnight, so a
 *  "days left" case cannot land on a boundary and pass or fail by the hour the
 *  suite happens to run at. The suite pins `Asia/Kolkata` (vitest.config.js). */
const NOW = new Date('2026-09-01T06:00:00.000Z').getTime();

/** Days from NOW, at the same time of day, so the CALENDAR difference is the
 *  number asked for and not one either side of it. */
const inDays = (n) => new Date(NOW + n * 86_400_000).toISOString();

const gym = (over = {}) => ({
  id: 'g1',
  staffRole: 'owner',
  privileges: ['members.read', 'billing.manage'],
  subscription: null,
  seatsUsed: null,
  ...over,
});

const trialing = (days, over = {}) =>
  gym({
    subscription: { status: 'trialing', trialEndsAt: inDays(days), seatCap: 300 },
    seatsUsed: 10,
    ...over,
  });

describe('canManageBilling', () => {
  it('asks for the power, not the job title', () => {
    // The whole point of the tick seam: a manager who has been handed billing
    // may press the button, and an owner ticked out of it may not. A screen
    // reading `staffRole === 'owner'` would get both of these backwards.
    expect(canManageBilling(['billing.manage'])).toBe(true);
    expect(canManageBilling(['members.read', 'staff.manage'])).toBe(false);
  });

  it('says no to anything that is not a list of powers', () => {
    expect(canManageBilling(undefined)).toBe(false);
    expect(canManageBilling(null)).toBe(false);
    expect(canManageBilling('billing.manage')).toBe(false);
  });
});

describe('hasLivePlan / isTrialing', () => {
  it('treats an unknown plan and no plan alike', () => {
    expect(hasLivePlan(gym())).toBe(false);
    expect(hasLivePlan(gym({ subscription: undefined }))).toBe(false);
    expect(hasLivePlan(undefined)).toBe(false);
  });

  it('asks the STATUS, not whether an end date exists', () => {
    // THE ONE THAT MATTERS. Both rows carry a trial end date; only one is a
    // trial. If this ever goes green with `active` returning true, a paying gym
    // is about to be shown a countdown.
    const paying = gym({
      subscription: { status: 'active', trialEndsAt: inDays(-200), seatCap: 300 },
      seatsUsed: 4,
    });
    expect(isTrialing(paying)).toBe(false);
    expect(isTrialing(trialing(10))).toBe(true);
  });
});

// ── WHICH FACE THE UNSKIPPABLE PROMPT SHOWS ────────────────────────────────
//
// Every case here is a Kd ruling rather than a preference, and TWO of them are
// about NOT drawing a prompt that cannot be closed. Read the function's own
// header before changing any expectation in this block.
describe('planPromptFor', () => {
  it('offers the trial to an owner who has never used one', () => {
    expect(planPromptFor(gym({ ownerTrialUsed: false }))).toBe('trial');
  });

  it('offers the PLANS to an owner whose one trial is spent', () => {
    // Kd, :22697: a second gym's owner is shown "the real plans at their real
    // prices" — never a button whose only possible answer is a 409.
    expect(planPromptFor(gym({ ownerTrialUsed: true }))).toBe('subscribe');
  });

  it('draws NOTHING for a gym that is already on a plan', () => {
    // And it decides that on the STATUS. Both rows below carry a trial end date
    // in the past; both are live plans, and a prompt over either would lock a
    // paying gym out of its own console.
    expect(
      planPromptFor(
        gym({
          ownerTrialUsed: true,
          subscription: { status: 'trialing', trialEndsAt: inDays(-1), seatCap: 300 },
        }),
      ),
    ).toBeNull();
    expect(
      planPromptFor(
        gym({
          ownerTrialUsed: true,
          subscription: { status: 'active', trialEndsAt: inDays(-200), seatCap: 300 },
        }),
      ),
    ).toBeNull();
  });

  it('draws NOTHING for somebody who cannot pay', () => {
    // Kd, :22921 §1: the prompt stops only whoever holds `billing.manage`. A
    // trainer or manager without it uses the console as normal, because
    // blocking somebody who cannot subscribe is a brick wall pointed at the
    // wrong person.
    const trainer = gym({ ownerTrialUsed: false, staffRole: 'trainer', privileges: ['members.read'] });
    expect(planPromptFor(trainer)).toBeNull();
  });

  it('draws NOTHING when the server did not say whether the trial is spent', () => {
    // THE ONE THAT SEALS SOMEBODY OUT IF IT GOES WRONG. `ownerTrialUsed` is
    // `.nullable().default(null)` — null is "we could not ask" (a non-staff
    // caller, or an api older than this bundle), never "no". A prompt that
    // cannot be closed must never be drawn on a guess.
    expect(planPromptFor(gym({ ownerTrialUsed: null }))).toBeNull();
    expect(planPromptFor(gym())).toBeNull();
    expect(planPromptFor(gym({ ownerTrialUsed: 'yes' }))).toBeNull();
    expect(planPromptFor(undefined)).toBeNull();
  });
});

describe('the price list’s words', () => {
  it('names a plan by the only human fact its row carries', () => {
    expect(planSeatLabel(300)).toBe('Up to 300 members');
  });

  it('says a capless band has no limit rather than a limit of zero', () => {
    // :5807 — "0 members" is a number nobody computed, printed against a plan
    // that limits nobody.
    expect(planSeatLabel(null)).toBe('No member limit');
    expect(planSeatLabel(undefined)).toBe('No member limit');
    expect(planSeatLabel(0)).toBe('No member limit');
  });

  it('prints the server’s own price string and says how often it is charged', () => {
    expect(planPriceText({ priceLabel: '$35', interval: 'month' })).toBe('$35 a month');
    expect(planPriceText({ priceLabel: '₹1,500', interval: 'month' })).toBe('₹1,500 a month');
    // The interval is PRINTED, not assumed: a yearly row must not read as a
    // monthly one the day an annual tier is seeded.
    expect(planPriceText({ priceLabel: '$390', interval: 'year' })).toBe('$390 a year');
  });

  it('draws no row at all for a plan with no price string', () => {
    expect(planPriceText({ priceLabel: '', interval: 'month' })).toBeNull();
    expect(planPriceText({ interval: 'month' })).toBeNull();
    expect(planPriceText(undefined)).toBeNull();
  });
});

describe('trialDaysLeft', () => {
  it('counts calendar days, not elapsed milliseconds', () => {
    expect(trialDaysLeft(inDays(27), NOW)).toBe(27);
    expect(trialDaysLeft(inDays(1), NOW)).toBe(1);
    expect(trialDaysLeft(inDays(0), NOW)).toBe(0);
  });

  it('goes negative past the date rather than clamping', () => {
    // Nothing ends a trial, so a gym genuinely sits past its own end date and
    // the caller has to be able to see that rather than reading "0 days left"
    // for ever.
    expect(trialDaysLeft(inDays(-3), NOW)).toBe(-3);
  });

  it('is null for anything it cannot read', () => {
    expect(trialDaysLeft(null, NOW)).toBeNull();
    expect(trialDaysLeft('not a date', NOW)).toBeNull();
    expect(trialDaysLeft(inDays(3), Number.NaN)).toBeNull();
  });

  it('does not round a few hours up into a whole day', () => {
    // The defect this repo found four times in `joinClock.js`: a calendar word
    // computed from floored elapsed time. Nineteen hours that cross a local
    // midnight are ONE calendar day, not zero.
    const lateEvening = new Date('2026-09-01T17:00:00.000Z').getTime(); // 22:30 IST
    const nextMorning = new Date('2026-09-02T03:30:00.000Z').getTime(); // 09:00 IST
    expect(trialDaysLeft(new Date(nextMorning).toISOString(), lateEvening)).toBe(1);
  });
});

describe('trialEndDateLabel', () => {
  it('is null rather than a fabricated date', () => {
    expect(trialEndDateLabel(null)).toBeNull();
    expect(trialEndDateLabel('nonsense')).toBeNull();
  });

  it('renders a real date', () => {
    expect(trialEndDateLabel(inDays(3))).toMatch(/\d/);
  });
});

describe('seatMeter', () => {
  it('reports the server’s count against the plan’s cap', () => {
    const m = seatMeter(trialing(20, { seatsUsed: 42 }));
    expect(m).toEqual({ used: 42, cap: 300, pressure: false, full: false });
  });

  it('fires at exactly §4.2’s 90 % and stays fired above it', () => {
    // The threshold is quoted from the spec, so the boundary is asserted with
    // the constant AND with a literal — an assertion made only against the
    // exported constant moves whenever the constant does and proves nothing
    // (:19960's tautological-golden-string finding).
    expect(SEAT_PRESSURE_RATIO).toBe(0.9);
    expect(seatMeter(trialing(20, { seatsUsed: 269 }))?.pressure).toBe(false);
    expect(seatMeter(trialing(20, { seatsUsed: 270 }))?.pressure).toBe(true);
    expect(seatMeter(trialing(20, { seatsUsed: 299 }))?.full).toBe(false);
    expect(seatMeter(trialing(20, { seatsUsed: 300 }))?.full).toBe(true);
    // The door refuses at `used >= cap`, so an over-full gym (staff comped out
    // of the count after the fact, a cap lowered) is still full, never "fine".
    expect(seatMeter(trialing(20, { seatsUsed: 305 }))?.full).toBe(true);
  });

  it('is null for every unknown, and NEVER a zero', () => {
    expect(seatMeter(gym())).toBeNull(); // no plan
    expect(
      seatMeter(gym({ subscription: { status: 'active', trialEndsAt: null, seatCap: null }, seatsUsed: 7 })),
    ).toBeNull(); // capless band
    expect(seatMeter(trialing(20, { seatsUsed: null }))).toBeNull(); // not told
    expect(seatMeter(undefined)).toBeNull();
  });

  it('refuses a cap of zero or less rather than drawing a meter over it', () => {
    // PLANTED FIXTURES, because the contract forbids this shape: `seatCap` is
    // `z.number().int().positive().nullable()` and every console read is parsed
    // through it, so a finite cap at or below zero cannot arrive from today's
    // server. The `cap <= 0` clause was therefore a guard nothing could
    // falsify — the same shape C88 was deleted for one round earlier, in this
    // very function.
    //
    // IT IS KEPT RATHER THAN DELETED, and the difference from C88 is the whole
    // reason: C88's `typeof` line was LOGICALLY subsumed by the `Number.isFinite`
    // below it, so it decided nothing. `cap <= 0` is not subsumed by anything —
    // `Number.isFinite(0)` is true — and it is unreachable only because a schema
    // in another package says so. That is defence in depth against a contract
    // changing out from under this file, so it takes C91's resolution from the
    // same round: keep the guard, plant the fixture that makes it observable.
    //
    // Without it: `{ used: 0, cap: 0, pressure: true, full: true }`, i.e. "0 of 0
    // places used — your gym is full, so nobody else can join yet" over a gym
    // nothing is limiting.
    const capped = (seatCap, seatsUsed) =>
      gym({ subscription: { status: 'trialing', trialEndsAt: inDays(20), seatCap }, seatsUsed });
    expect(seatMeter(capped(0, 0))).toBeNull();
    expect(seatMeter(capped(-5, 2))).toBeNull();
  });
});

describe('seatLineText', () => {
  // §4.3's meter sentence had THREE homes — the banner in this file, the
  // Overview's trial card and the Members header — and the full-gym clause was
  // spelled out twice with nothing keeping the copies equal. This is the one
  // owner; these are what notice if a copy comes back.
  it('is the sentence itself, asserted as a literal', () => {
    // A LITERAL rather than a comparison against the function that produces it.
    // An assertion made only against its own source moves whenever the source
    // does and proves nothing — :19960's tautological-golden-string finding,
    // which cost that round a second fix.
    expect(seatLineText(seatMeter(trialing(20, { seatsUsed: 42 })))).toBe('42 of 300 places used.');
    expect(seatLineText(seatMeter(trialing(20, { seatsUsed: 300 })))).toBe(
      '300 of 300 places used — your gym is full, so nobody else can join yet.',
    );
  });

  it('hands every caller nothing to draw when there is no meter', () => {
    // Null in, null out, so a gym with no meter draws no line rather than each
    // of the three callers being handed an empty string to render.
    expect(seatLineText(null)).toBeNull();
    expect(seatLineText(undefined)).toBeNull();
  });

  it('is exactly what the banner says, so the strip and the roster cannot disagree', () => {
    // The banner is a READER of that sentence, not its author. Re-inline a copy
    // here that drifts by one word and this fails; re-inline an identical copy
    // and nothing is lost, which is the honest limit of what this can catch.
    const full = trialing(20, { seatsUsed: 300 });
    expect(bannerFor(full, NOW)?.text).toBe(seatLineText(seatMeter(full)));
  });
});

describe('consoleIsReadOnly', () => {
  // THE THREE STATES, AND TWO OF THEM MEAN THE SAME THING ON SCREEN. The field
  // is `true` / `false` / `null`, and `null` is "we could not ask" — an api
  // older than this bundle, or a plain member — never "locked" (C97's rule,
  // :23711). Greying a console out on an unknown refuses somebody something the
  // server would have allowed, and they have no way to find out which.
  it('locks only on a definite true', () => {
    expect(consoleIsReadOnly(gym({ consoleReadOnly: true }))).toBe(true);
  });

  it('does NOT lock on false, on null, on a missing field, or on no org at all', () => {
    expect(consoleIsReadOnly(gym({ consoleReadOnly: false }))).toBe(false);
    expect(consoleIsReadOnly(gym({ consoleReadOnly: null }))).toBe(false);
    // The whole fixture set in this repo predates the field, which is exactly
    // the older-api shape — so this case is not hypothetical, it is what every
    // other test in the console suite is passing in today.
    expect(consoleIsReadOnly(gym())).toBe(false);
    expect(consoleIsReadOnly(null)).toBe(false);
    expect(consoleIsReadOnly(undefined)).toBe(false);
  });

  it('is NOT derived from the subscription, in either direction', () => {
    // The tempting one-liner is `!hasLivePlan(org)`, and it is wrong twice.
    // A gym with no subscription whose caller was not told greys nothing:
    expect(hasLivePlan(gym({ subscription: null }))).toBe(false);
    expect(consoleIsReadOnly(gym({ subscription: null }))).toBe(false);
    // And the field is what decides, not the absence of the row — this is the
    // shape a lapsed gym's STAFF actually receive.
    expect(consoleIsReadOnly(gym({ subscription: null, consoleReadOnly: true }))).toBe(true);
  });
});

describe('the read-only sentences', () => {
  // THE WORDS ARE PINNED, and the reason is that all three are drawn at a gym
  // owner and two of them are the SERVER's own. `READ_ONLY_NOTE` is verbatim
  // `GYM_NOT_ON_PLAN_MESSAGE` from `apps/api/src/modules/orgs/service.ts` — if
  // somebody reworks one side, the screen and the 409 start saying different
  // things about one refusal, which is what this repo keeps auditing for.
  it('says what the server says, word for word', () => {
    expect(READ_ONLY_NOTE).toBe('This gym needs a plan before anything here can be changed.');
  });

  it('never blames the reader and never promises a next step', () => {
    // "Ask your gym's owner" is wrong because the reader may BE the owner; a
    // CTA is wrong because nothing in the product can put a gym back on a plan
    // (no payment, one trial per owner ever), so it would be a promise with no
    // code behind it (:5807).
    for (const sentence of [READ_ONLY_NOTE, READ_ONLY_QUEUE_NOTE, CONSOLE_READ_ONLY_BANNER]) {
      expect(sentence).not.toMatch(/ask your|contact|reactivate|subscribe|upgrade|pay/i);
    }
  });

  it('never says a TRIAL ended, because half the gyms reading it never had one', () => {
    // §4.2's own copy is "Trial ended — members have moved to the free tier",
    // and it cannot be used: a gym that never subscribed reaches this state too,
    // and one field answers for both (`consoleReadOnly` asks whether there is a
    // live plan, never how the gym got here).
    for (const sentence of [READ_ONLY_NOTE, READ_ONLY_QUEUE_NOTE, CONSOLE_READ_ONLY_BANNER]) {
      expect(sentence).not.toMatch(/trial|expired|ended|moved/i);
    }
  });

  it('does NOT promise the waiting people keep their place — that is not true yet', () => {
    // Kd ruled on 2026-08-29 that a lapsed gym HOLDS its applications and tells
    // the waiting person why. That is the next card. Until it ships an
    // application still dies 14 days after it was made whatever the gym's plan
    // is doing, so the sentence here stops at what is true today. **Writing the
    // reassurance before the behaviour exists is exactly :5807's class**, and
    // this assertion is what makes the copy change when the behaviour does.
    //
    // **ONE ASSERTION, NOT TWO (T3 round 1, Low-5).** A `.not.toMatch(/keep|
    // place|hold|…/)` stood here under the exact equality above it, and could
    // never fail on its own: any change that would trip the matcher has already
    // tripped `toBe`. Two guards, either one sufficient, therefore neither
    // falsifiable — :12343's J11, which `StaffPanel.jsx` names four lines from
    // where this round found it. The exact string IS the pin.
    //
    // The independently meaningful version of that matcher is at the SCREEN, in
    // `readOnlyConsole.render.test.jsx`, where it searches everything rendered
    // rather than the constant it was just compared against — so a reassurance
    // added anywhere else on that panel still goes red.
    expect(READ_ONLY_QUEUE_NOTE).toBe('Nobody can be let in until this gym is on a plan.');
  });
});

describe('bannerFor', () => {
  it('draws nothing for a gym on no plan whose caller was not told', () => {
    // `consoleReadOnly` absent is the older-api / plain-member shape, and the
    // honest banner for a state we cannot read is no banner.
    expect(bannerFor(gym(), NOW)).toBeNull();
  });

  it('draws §4.2’s read-only row for a gym with no plan, red and undismissable', () => {
    const b = bannerFor(gym({ consoleReadOnly: true }), NOW);
    expect(b?.key).toBe('read_only');
    expect(b?.tone).toBe('danger');
    expect(b?.dismissible).toBe(false);
    expect(b?.text).toBe(CONSOLE_READ_ONLY_BANNER);
    // Kd's ruling (:22215 §3.4): a lapsed gym's members fall back to the FREE
    // app and are never locked out. The banner has to say the consequence,
    // because that is the thing an owner most needs to know.
    expect(b?.text).toMatch(/free app/i);
  });

  it('is NOT drawn on a false or an unknown, which is the direction that seals people out', () => {
    expect(bannerFor(gym({ consoleReadOnly: false }), NOW)).toBeNull();
    expect(bannerFor(gym({ consoleReadOnly: null }), NOW)).toBeNull();
  });

  it('leaves a TRIALLING gym’s own banner alone — the read-only row is ranked first', () => {
    // The ranking is only observable if something else would otherwise have
    // fired, so this is the control for putting `read_only` at the top of the
    // machine: the same gym, one field apart, produces two different banners
    // and the trial one is NOT swallowed.
    expect(bannerFor(trialing(27), NOW)?.key).toBe('trial_info');
    expect(bannerFor(trialing(2), NOW)?.key).toBe('trial_urgent');
    expect(bannerFor(trialing(27, { consoleReadOnly: false }), NOW)?.key).toBe('trial_info');
  });

  it('draws nothing for a healthy paying gym', () => {
    const paying = gym({
      subscription: { status: 'active', trialEndsAt: inDays(-40), seatCap: 300 },
      seatsUsed: 12,
    });
    // §4.2: "Healthy | else | no banner" — and the row carries a PAST trial end
    // date, which must not be read as a trial.
    expect(bannerFor(paying, NOW)).toBeNull();
  });

  it('counts down while the trial is comfortable, and lets it be dismissed', () => {
    const b = bannerFor(trialing(27), NOW);
    expect(b?.key).toBe('trial_info');
    expect(b?.tone).toBe('info');
    expect(b?.dismissible).toBe(true);
    expect(b?.text).toContain('27 days left');
  });

  it('never has to say "1 day left", because one day is urgent', () => {
    // This test began life asserting a singular and went RED, which is how the
    // singular branch was found to be unreachable: everything at or under three
    // days has already become `trial_urgent`, so the smallest countdown this
    // arm can print is four. Kept pointed at the BOUNDARY so that moving
    // `TRIAL_URGENT_DAYS` fails here rather than quietly re-opening a plural
    // bug at "1 days left".
    expect(bannerFor(trialing(1), NOW)?.key).toBe('trial_urgent');
    expect(bannerFor(trialing(4), NOW)?.text).toContain('4 days left');
  });

  it('turns urgent at §4.2’s three days and cannot be dismissed', () => {
    expect(TRIAL_URGENT_DAYS).toBe(3);
    expect(bannerFor(trialing(4), NOW)?.key).toBe('trial_info');
    const urgent = bannerFor(trialing(3), NOW);
    expect(urgent?.key).toBe('trial_urgent');
    expect(urgent?.tone).toBe('warn');
    expect(urgent?.dismissible).toBe(false);
    expect(urgent?.text).toContain('Trial ends');
  });

  it('does NOT claim a trial has ended once the date has passed', () => {
    // Nothing in the product ends a trial, so the members still have the gym's
    // features and saying otherwise would be false in the direction that costs
    // a gym its members' trust. The banner reports the date has passed and
    // nothing more.
    const b = bannerFor(trialing(-2), NOW);
    expect(b?.key).toBe('trial_urgent');
    expect(b?.text).toContain('past its end date');
    expect(b?.text).not.toMatch(/ended|expired/i);
  });

  it('never offers a button, because there is nowhere for one to go', () => {
    // The CTAs §4.2 pairs with each state all open a Billing screen that does
    // not exist. If a later card adds one it should add it deliberately, not by
    // this test quietly going green over a `cta` field nobody noticed.
    for (const org of [trialing(27), trialing(2), trialing(20, { seatsUsed: 290 })]) {
      const b = bannerFor(org, NOW);
      expect(b).not.toBeNull();
      expect(Object.keys(b)).toEqual(['key', 'tone', 'text', 'dismissible']);
    }
  });

  it('warns at seat pressure even on a healthy paid plan', () => {
    const full = gym({
      subscription: { status: 'active', trialEndsAt: null, seatCap: 100 },
      seatsUsed: 95,
    });
    const b = bannerFor(full, NOW);
    expect(b?.key).toBe('seat_pressure');
    expect(b?.text).toContain('95 of 100 places used');
  });

  it('says why nobody else can join once the gym is full', () => {
    const full = gym({
      subscription: { status: 'active', trialEndsAt: null, seatCap: 100 },
      seatsUsed: 100,
    });
    expect(bannerFor(full, NOW)?.text).toContain('full');
  });

  it('puts a closing deadline ABOVE a full gym, and a distant one below it', () => {
    // The ranking the spec does not make. Both conditions hold in each case
    // here, so this is the only thing standing between one slot and two
    // answers.
    const closing = trialing(2, { seatsUsed: 295 });
    expect(bannerFor(closing, NOW)?.key).toBe('trial_urgent');

    const roomy = trialing(25, { seatsUsed: 295 });
    expect(bannerFor(roomy, NOW)?.key).toBe('seat_pressure');
  });

  it('puts a failed payment above everything', () => {
    const late = gym({
      subscription: { status: 'past_due', trialEndsAt: inDays(-10), seatCap: 100 },
      seatsUsed: 99,
    });
    const b = bannerFor(late, NOW);
    expect(b?.key).toBe('past_due');
    // It promises no retry and offers no way to update a card, because v1 §10's
    // dunning is unbuilt and there is no billing screen.
    expect(b?.text).not.toMatch(/retry|retrying|update/i);
  });
});

/** A browser's storage, in node.
 *
 *  `vitest.config.js` says in as many words that only `*.render.test.jsx` gets a
 *  DOM, and this file is pure arithmetic that has no business paying for jsdom
 *  to check a countdown. So the ONE browser API these four functions touch is
 *  supplied here instead.
 *
 *  **What is stubbed is the browser and not the subject.** `utils/storage.js`
 *  runs for real on top of it — which is what makes the literal key assertion
 *  below a claim about `userKey()` rather than about this object — and the
 *  behaviour under test (which key, which day, which banner) is entirely ours.
 *  A stub that answered the question would be :21487's rule-4 finding, a test
 *  asserting its own fixture. */
function installStorage() {
  const map = new Map();
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
  };
  globalThis.localStorage = store;
  return store;
}

describe('dismissal', () => {
  let store;
  beforeEach(() => {
    store = installStorage();
    setCurrentUserId('u1');
    vi.restoreAllMocks();
  });
  afterEach(() => {
    delete globalThis.localStorage;
    setCurrentUserId(null);
  });

  it('stays dismissed for the rest of the day and comes back tomorrow', () => {
    expect(bannerIsDismissed('g1', 'trial_info', NOW)).toBe(false);
    dismissBanner('g1', 'trial_info', NOW);
    expect(bannerIsDismissed('g1', 'trial_info', NOW)).toBe(true);
    // Later the same local day.
    expect(bannerIsDismissed('g1', 'trial_info', NOW + 6 * 3_600_000)).toBe(true);
    // §4.2 says "dismissible/day", so tomorrow it is back.
    expect(bannerIsDismissed('g1', 'trial_info', NOW + 86_400_000)).toBe(false);
  });

  it('does not silence a DIFFERENT sentence', () => {
    // Putting away "27 days left" must not also hide the amber notice three
    // weeks later — a different sentence is a different claim on the owner's
    // attention.
    dismissBanner('g1', 'trial_info', NOW);
    expect(bannerIsDismissed('g1', 'trial_urgent', NOW)).toBe(false);
  });

  it('is remembered per gym', () => {
    dismissBanner('g1', 'trial_info', NOW);
    expect(bannerIsDismissed('g2', 'trial_info', NOW)).toBe(false);
  });

  it('is remembered per ACCOUNT, so a shared front desk cannot leak it', () => {
    // `utils/storage.js` prefixes every key with the signed-in account's id,
    // and that is the whole reason this uses it rather than `localStorage`
    // directly — a gym's front-desk browser is used by more than one person
    // (:618 T3 F1). Asserted through the REAL helper, on the real key.
    dismissBanner('g1', 'trial_info', NOW);
    expect(store.getItem('user_u1_console_banner_dismissed_g1')).not.toBeNull();

    setCurrentUserId('u2');
    expect(bannerIsDismissed('g1', 'trial_info', NOW)).toBe(false);
  });

  it('treats unreadable storage as NOT dismissed', () => {
    // The safe direction: a banner that appears when it need not is an
    // annoyance; one that stays hidden while a trial ends is the defect.
    store.setItem('user_u1_console_banner_dismissed_g1', 'not json');
    expect(bannerIsDismissed('g1', 'trial_info', NOW)).toBe(false);

    vi.spyOn(store, 'getItem').mockImplementation(() => {
      throw new Error('storage is off');
    });
    expect(bannerIsDismissed('g1', 'trial_info', NOW)).toBe(false);
  });

  it('does nothing at all without a gym', () => {
    expect(() => dismissBanner(null, 'trial_info', NOW)).not.toThrow();
    expect(bannerIsDismissed(null, 'trial_info', NOW)).toBe(false);
  });
});
