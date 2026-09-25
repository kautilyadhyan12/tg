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
  consoleReadOnlyBanner,
  readOnlyNote,
  readOnlyQueueNote,
  SEAT_PRESSURE_RATIO,
  TRIAL_URGENT_DAYS,
  bannerFor,
  bannerIsDismissed,
  biggerPlans,
  nextPaymentText,
  pendingChangeText,
  pendingFit,
  planHeadline,
  sizeDecision,
  sizeFittedText,
  sizeKeptText,
  sizeRows,
  canChangeSize,
  canMakeRoomNow,
  canManageBilling,
  chosenSeatCap,
  nextSizeText,
  canPayDuringTrial,
  firstPaymentText,
  isSubscribed,
  sizeChargeText,
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
    expect(seatLineText(seatMeter(trialing(20, { seatsUsed: 42 })))).toBe('42 of 300 members.');
    expect(seatLineText(seatMeter(trialing(20, { seatsUsed: 300 })))).toBe(
      '300 of 300 members — your gym is full, so nobody else can join yet.',
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
    // A trial's limit cannot grow before the first payment (RULINGS 2026-09-25), so a full
    // trial is told only that it is full.
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

// THE THREE SENTENCES AS A GYM READS THEM. They are functions of the org type
// since roadmap 2b, and every assertion below is about the GYM's wording — which
// is the one that must not move, because it is the server's own (`notOnPlanMessage`).
const READ_ONLY_NOTE = readOnlyNote('gym');
const READ_ONLY_QUEUE_NOTE = readOnlyQueueNote('gym');
const CONSOLE_READ_ONLY_BANNER = consoleReadOnlyBanner('gym');

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

  it('promises the waiting people keep their place — and stops short of confirming them', () => {
    // Kd ruled on 2026-08-29 that a lapsed gym HOLDS its applications and tells
    // the waiting person why. Card A shipped the first sentence alone and this
    // test asserted the second one's ABSENCE, so that the copy could not change
    // until the behaviour did. **It has: `sweep.ts`'s expiry now holds while the
    // gym has no live plan.** The assertion flips with the code, in the same
    // commit, which is the whole reason it was written this way round.
    //
    // **ONE ASSERTION, NOT TWO (T3 round 1, Low-5).** A `.not.toMatch(/keep|
    // place|hold|…/)` stood here under the exact equality below, and could
    // never fail on its own: any change that would trip the matcher has already
    // tripped `toBe`. Two guards, either one sufficient, therefore neither
    // falsifiable — :12343's J11. The exact string IS the pin.
    expect(READ_ONLY_QUEUE_NOTE).toBe(
      'Nobody can be let in until this gym is on a plan. The people waiting keep their place.',
    );
  });

  it('does NOT promise the gym will confirm them later — nothing can un-lapse a gym yet', () => {
    // The line the copy must still not cross, and it is the SAME defect class
    // one card further on. Holding a request is built; RE-STARTING one whose
    // deadline has already passed, on the day a gym pays, is not — nothing in
    // this product can put a lapsed gym back on a plan (measured 2026-08-29),
    // so there is no trigger point for it and it sits on the payment card's
    // `OWED.md` line. A sentence here saying "we'll let them in when you're
    // back" would be :5807's class exactly, which is what the assertion above
    // was protecting against before the hold existed.
    //
    // Independently falsifiable, unlike the pair Low-5 collapsed: this matcher
    // names words the exact string above does NOT contain, so it can go red on
    // a change that leaves that equality passing only if somebody edits both —
    // and it is the screen-level version in `readOnlyConsole.render.test.jsx`
    // that catches a reassurance added anywhere ELSE on the panel.
    expect(READ_ONLY_QUEUE_NOTE).not.toMatch(/confirm|when you|once you|back on|reactivat/i);
  });
});

/** THE STUDIO'S WORDING IS PINNED TOO — round 1's finding 4: `notOnPlanMessage`'s
 *  comment promises the banner and the 409 cannot disagree, and until this test
 *  that was asserted for a gym only. The API side pins the same studio sentence
 *  (`orgs.routes.test.ts`, "tells a studio its STUDIO needs a plan"); here is
 *  the web side of that pair, as a literal so neither can vouch for itself. */
describe('the read-only sentences at a studio', () => {
  it('name the studio and its clients, and match the server word for word', () => {
    expect(readOnlyNote('studio')).toBe('This studio needs a plan before anything here can be changed.');
    expect(readOnlyQueueNote('studio')).toBe(
      'Nobody can be let in until this studio is on a plan. The people waiting keep their place.',
    );
    expect(consoleReadOnlyBanner('studio')).toBe(
      'This studio has no plan. Nothing here can be changed, and your clients get the free app only.',
    );
    // A personal trainer's console is their BUSINESS.
    expect(readOnlyNote('personal_trainer')).toBe(
      'This business needs a plan before anything here can be changed.',
    );
  });

  it('reach the banner off the org row, with nothing else telling it the type', () => {
    const b = bannerFor(gym({ consoleReadOnly: true, orgType: 'studio' }), NOW);
    expect(b?.text).toBe(consoleReadOnlyBanner('studio'));
    expect(b?.text).toMatch(/studio/);
    expect(b?.text).not.toMatch(/gym/);
  });

  it('says a studio is full in its own word', () => {
    expect(seatLineText({ used: 3, cap: 3, full: true, pressure: true }, 'studio')).toBe(
      '3 of 3 clients — your studio is full, so nobody else can join yet.',
    );
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
    expect(b?.text).toContain('95 of 100 members');
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
    // The payment method is updated on Paddle's page from the plan card (1c-i), and the grace is
    // the worker's 2 days (Kd, RULINGS 2026-09-24); it promises no retry of its own.
    expect(b?.text).toBe(
      "A payment for your gym didn't go through. Paddle will try your card again by itself, or you can update your payment method under Plan on the Overview. Your members keep everything for 2 days after a failed payment.",
    );
    expect(b?.text).not.toMatch(/retry|retrying/i);
  });

  it('says a read-only console is owed a payment, not that it has no plan, once the grace has ended', () => {
    const owed = gym({ subscription: null, consoleReadOnly: true, paymentOverdue: true });
    expect(bannerFor(owed, NOW)).toMatchObject({
      key: 'read_only',
      text: 'A payment for your gym is overdue. Nothing here can be changed and your members get the free app only until it is paid. Update your payment method to pay now; Paddle also tries your card again by itself.',
    });
    // Staff who cannot pay are told who can, not to press what they are not shown.
    const trainer = { ...owed, staffRole: 'trainer', privileges: ['members.read'] };
    expect(bannerFor(trainer, NOW)?.text).toBe(
      'A payment for your gym is overdue. Nothing here can be changed and your members get the free app only until it is paid. Whoever manages billing can update the payment method; Paddle also tries the card again by itself.',
    );
    const lateForTrainer = gym({ staffRole: 'trainer', privileges: ['members.read'], subscription: { status: 'past_due', seatCap: 100 } });
    expect(bannerFor(lateForTrainer, NOW)?.text).toBe(
      "A payment for your gym didn't go through. Paddle will try the card again by itself, or whoever manages billing can update the payment method. Your members keep everything for 2 days after a failed payment.",
    );
    // Without the flag (an older api, or a trial that ended) it is the plain read-only line.
    expect(bannerFor(gym({ subscription: null, consoleReadOnly: true }), NOW)?.text).toMatch(/has no plan/);
  });
});

describe('planPromptFor, a payment owed', () => {
  it('asks for the card, not a plan, and only of whoever can pay', () => {
    const owed = gym({ subscription: null, consoleReadOnly: true, paymentOverdue: true, ownerTrialUsed: true });
    expect(planPromptFor(owed)).toBe('overdue');
    expect(planPromptFor({ ...owed, ownerTrialUsed: false })).toBe('overdue');
    expect(planPromptFor({ ...owed, privileges: ['members.read'] })).toBeNull();
    expect(planPromptFor({ ...owed, paymentOverdue: null })).toBe('subscribe');
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

// ── Paying during the trial, and a bigger size (ROADMAP Stage 3 item 1c-ii) ─────

describe('who is offered which choice', () => {
  const paidTrial = (over = {}) =>
    trialing(6, {
      ...over,
      subscription: { status: 'trialing', trialEndsAt: inDays(6), seatCap: 500, subscribed: true, priceLabel: '$129', currentPeriodEnd: inDays(6), ...over.subscription },
    });
  const paying = (sub = {}, over = {}) =>
    gym({ subscription: { status: 'active', trialEndsAt: null, seatCap: 500, subscribed: true, priceLabel: '$129', currentPeriodEnd: inDays(20), ...sub }, seatsUsed: 20, ...over });
  const trainer = { staffRole: 'trainer', privileges: ['members.read'] };

  it.each([
    ['the gym’s own free trial', trialing(6), { subscribed: false, pay: true, bigger: false }],
    ['a free trial in rupees (Razorpay is not built)', trialing(6, { currencyDisplay: 'INR' }), { subscribed: false, pay: false, bigger: false }],
    ['a trial the gym has paid for', paidTrial(), { subscribed: true, pay: false, bigger: true }],
    ['a paid plan in good standing', paying(), { subscribed: true, pay: false, bigger: true }],
    ['a paid plan set to end', paying({ cancelAtPeriodEnd: true }), { subscribed: true, pay: false, bigger: false }],
    ['a failed payment', paying({ status: 'past_due' }), { subscribed: true, pay: false, bigger: false }],
    ['a read-only console', paying({}, { consoleReadOnly: true }), { subscribed: true, pay: false, bigger: false }],
    ['a trainer at a paying gym', paying({}, trainer), { subscribed: true, pay: false, bigger: false }],
    ['a trainer in a free trial', trialing(6, trainer), { subscribed: false, pay: false, bigger: false }],
    ['an api too old to say it was paid for', trialing(6, { subscription: { status: 'trialing', trialEndsAt: inDays(6), seatCap: 200 } }), { subscribed: false, pay: true, bigger: false }],
    ['no plan at all', gym(), { subscribed: false, pay: false, bigger: false }],
  ])('%s', (_name, org, want) => {
    expect({ subscribed: isSubscribed(org), pay: canPayDuringTrial(org), bigger: canChangeSize(org) }).toEqual(want);
    // Room now only on a plan already paying: a trial, paid or not, keeps its limit.
    expect(canMakeRoomNow(org)).toBe(want.bigger && org.subscription?.status === 'active');
  });
});

describe('a paid trial’s chosen size', () => {
  const sub = { status: 'trialing', subscribed: true, seatCap: 200, nextSeatCap: 500, priceLabel: '$129', currentPeriodEnd: inDays(6) };
  it('is the size that starts with the first payment, not the trial’s', () => {
    expect(chosenSeatCap(sub)).toBe(500);
    expect(chosenSeatCap({ ...sub, nextSeatCap: null })).toBe(200);
  });
  it('says when the chosen size starts, and nothing once it has', () => {
    expect(nextSizeText(sub, 'gym')).toBe(`Up to 500 members from ${trialEndDateLabel(inDays(6))}, when your first payment is taken.`);
    expect(nextSizeText({ ...sub, nextSeatCap: null }, 'gym')).toBeNull();
    expect(nextSizeText({ ...sub, status: 'active', nextSeatCap: null }, 'gym')).toBeNull();
    // The first charge failed: the size still waits for it, and the trial's date has passed.
    expect(nextSizeText({ ...sub, status: 'past_due' }, 'gym')).toBe('Up to 500 members once your first payment is taken.');
  });
});

describe('biggerPlans', () => {
  const list = [
    { code: 'b1', seatCap: 200 },
    { code: 'b2', seatCap: 500 },
    { code: 'b3', seatCap: 1000 },
    { code: 'custom', seatCap: null },
  ];
  it('lists only the sizes above the gym’s own, a capless one included', () => {
    expect(biggerPlans(list, 500).map((p) => p.code)).toEqual(['b3', 'custom']);
    expect(biggerPlans(list, 200).map((p) => p.code)).toEqual(['b2', 'b3', 'custom']);
  });
  it('lists nothing past no limit, or for a list it cannot read', () => {
    expect(biggerPlans(list, null)).toEqual([]);
    expect(biggerPlans(null, 200)).toEqual([]);
  });
});

describe('the words for money', () => {
  it('names the first payment of a paid trial, and nothing for a free one', () => {
    const on = trialEndDateLabel(inDays(6));
    expect(firstPaymentText({ status: 'trialing', subscribed: true, priceLabel: '$129', currentPeriodEnd: inDays(6) })).toBe(`Your first payment of $129 is on ${on}.`);
    expect(firstPaymentText({ status: 'trialing', trialEndsAt: inDays(6) })).toBeNull();
    expect(firstPaymentText({ status: 'active', subscribed: true, priceLabel: '$129', currentPeriodEnd: inDays(6) })).toBeNull();
    expect(firstPaymentText({ status: 'trialing', subscribed: true, priceLabel: null, currentPeriodEnd: inDays(6) })).toBeNull();
  });

  it('says what a bigger size costs now, with the tax shown, and from when', () => {
    const from = trialEndDateLabel(inDays(20));
    expect(
      sizeChargeText({ priceLabel: '$129', dueNow: { totalLabel: '$53.52', subtotalLabel: '$49.15', taxLabel: '$4.37' }, nextPaymentAt: inDays(20) }),
    ).toBe(`You pay $53.52 now ($49.15 plus $4.37 tax) for the rest of this month, then $129 a month from ${from}.`);
    expect(sizeChargeText({ priceLabel: '$129', dueNow: { totalLabel: '$49.15', subtotalLabel: '$49.15', taxLabel: null }, nextPaymentAt: inDays(20) })).toBe(
      `You pay $49.15 now for the rest of this month, then $129 a month from ${from}.`,
    );
  });

  it('says nothing is charged during a trial', () => {
    expect(sizeChargeText({ priceLabel: '$129', dueNow: null, nextPaymentAt: inDays(6) })).toBe(`Nothing to pay now. $129 a month from ${trialEndDateLabel(inDays(6))}.`);
    expect(sizeChargeText(null)).toBeNull();
  });
});

describe('the banner for a trial the gym has paid for', () => {
  const paidTrial = (days) =>
    trialing(days, { subscription: { status: 'trialing', trialEndsAt: inDays(days), seatCap: 500, subscribed: true, priceLabel: '$129', currentPeriodEnd: inDays(days) } });

  it('is never urgent: the plan it chose starts by itself', () => {
    for (const days of [3, 1, 0]) {
      expect(bannerFor(paidTrial(days), NOW)?.key).toBe('trial_info');
    }
  });

  it('counts down in good English and names the first payment', () => {
    const on = (days) => trialEndDateLabel(inDays(days));
    expect(bannerFor(paidTrial(6), NOW)?.text).toBe(`Free trial — 6 days left. Your first payment of $129 is on ${on(6)}.`);
    expect(bannerFor(paidTrial(1), NOW)?.text).toBe(`Free trial — 1 day left. Your first payment of $129 is on ${on(1)}.`);
    expect(bannerFor(paidTrial(0), NOW)?.text).toBe(`Free trial — last day. Your first payment of $129 is on ${on(0)}.`);
  });

  it('tells a free trial’s billing staff, near the end, that they can pay now', () => {
    expect(bannerFor(trialing(2), NOW)?.text).toContain('Choose a plan under Plan on the Overview; you pay when the trial ends.');
    expect(bannerFor(trialing(2, { staffRole: 'trainer', privileges: ['members.read'] }), NOW)?.text).not.toContain('Choose a plan');
  });

  it('never points a full trial at a bigger size, paid for or not', () => {
    const full = (sub) => gym({ subscription: { status: 'trialing', trialEndsAt: inDays(6), seatCap: 100, ...sub }, seatsUsed: 100 });
    expect(bannerFor(full({}), NOW)?.text).not.toContain('Choose');
    expect(bannerFor(full({ subscribed: true, priceLabel: '$79', currentPeriodEnd: inDays(6) }), NOW)?.text).not.toContain('Choose');
  });

  it('points a full paying gym at a bigger size', () => {
    const full = gym({ subscription: { status: 'active', trialEndsAt: null, seatCap: 100, subscribed: true, priceLabel: '$79', currentPeriodEnd: inDays(20) }, seatsUsed: 95 });
    expect(bannerFor(full, NOW)?.text).toBe('95 of 100 members. Press Change size under Plan on the Overview.');
  });
});

describe('a smaller size and the Plan card (1c-iii)', () => {
  const PLANS = [
    { code: 'b1', seatCap: 200, priceLabel: '$79' },
    { code: 'b2', seatCap: 500, priceLabel: '$129' },
    { code: 'b3', seatCap: 1000, priceLabel: '$199' },
  ];
  const END = '2026-10-25T06:00:00.000Z';
  const paying = { status: 'active', seatCap: 1000, priceLabel: '$199', currentPeriodEnd: END, cancelAtPeriodEnd: false, subscribed: true, pendingSize: null, sizeKept: null };
  const waiting = {
    ...paying,
    pendingSize: { seatCap: 500, priceLabel: '$129', from: END, decideAt: '2026-10-25T03:00:00.000Z', ifTooMany: null },
  };
  const gym = (sub, seatsUsed) => ({ orgType: 'gym', seatsUsed, subscription: sub });

  it('heads the card with the size and the price, and says the next payment', () => {
    expect(planHeadline(paying, 'gym')).toBe(`Up to ${(1000).toLocaleString()} members · $199 a month`);
    expect(planHeadline({ ...paying, seatCap: null }, 'gym')).toBe('No member limit · $199 a month');
    expect(nextPaymentText(paying)).toBe(`Next payment $199 on ${trialEndDateLabel(END)}`);
    expect(nextPaymentText({ ...paying, cancelAtPeriodEnd: true })).toBe(`Ends ${trialEndDateLabel(END)}`);
    // With a smaller size waiting, the change's own line says what comes next.
    expect(nextPaymentText(waiting)).toBeNull();
    expect(nextPaymentText({ ...paying, status: 'past_due' })).toBeNull();
  });

  it('says what will change and whether the members fit, with how many to remove and by when', () => {
    expect(pendingChangeText(waiting, 'gym')).toBe(`Changing to 500 members ($129 a month) on ${trialEndDateLabel(END)}`);
    expect(pendingChangeText(paying, 'gym')).toBeNull();
    const by = new Date('2026-10-25T03:00:00.000Z').toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    expect(pendingFit(gym(waiting, 1100))).toEqual({
      tooMany: true,
      text: `You have ${(1100).toLocaleString()} members. Remove 600 by ${by} to move to 500. Otherwise you'll stay on ${(1000).toLocaleString()} members at $199 a month.`,
    });
    // A smaller size that fits them: the server's fallback is named.
    const withFallback = { ...waiting, pendingSize: { ...waiting.pendingSize, ifTooMany: { planCode: 'b2', seatCap: 800, priceLabel: '$169' } } };
    expect(pendingFit(gym(withFallback, 620))?.text).toBe(`You have 620 members. Remove 120 by ${by} to move to 500. Otherwise you'll move to 800 members at $169 a month.`);
    expect(pendingFit(gym(waiting, 500))).toEqual({ tooMany: false, text: `You're ready: you'll move to 500 members on ${trialEndDateLabel(END)}.` });
    expect(pendingFit(gym(waiting, undefined))).toBeNull();
    expect(pendingFit(gym(paying, 620))).toBeNull();
  });

  it('says a size that was not made, and why', () => {
    expect(sizeKeptText({ ...paying, sizeKept: { seatCap: 500, members: 620 } }, 'gym')).toBe(
      `Your size stayed at ${(1000).toLocaleString()} members: you had 620 when it was due to change, more than 500, so you pay $199 a month. Change size again whenever you're ready.`,
    );
    expect(sizeKeptText(paying, 'gym')).toBeNull();
  });

  it('lists every size: the gym’s own, one waiting, bigger paid now, smaller from the next payment with how many to remove', () => {
    const rows = sizeRows(PLANS, gym(waiting, 620));
    expect(rows.map((r) => [r.plan.code, r.kind, r.note, r.disabled])).toEqual([
      ['b1', 'smaller', `From ${trialEndDateLabel(END)}`, false],
      ['b2', 'waiting', `Changing to this on ${trialEndDateLabel(END)}`, true],
      ['b3', 'current', 'Your size', true],
    ]);
    // 620 do not fit 200; the smallest size under 1,000 that holds them is none here (500 < 620).
    expect(rows[0]?.warning).toMatch(/^You have 620 members\. Remove 420 by .* to move to 200\. Otherwise you'll stay on /);
    const fallbackRows = sizeRows(PLANS, gym(waiting, 300));
    expect(fallbackRows[0]?.warning).toMatch(/^You have 300 members\. Remove 100 by .* to move to 200\. Otherwise you'll move to 500 members at \$129 a month\.$/);
    const fits = sizeRows(PLANS, gym({ ...paying, seatCap: 500 }, 100));
    expect(fits.map((r) => [r.kind, r.note, r.warning])).toEqual([
      ['smaller', `From ${trialEndDateLabel(END)}`, null],
      ['current', 'Your size', null],
      ['bigger', 'Pay the difference now', null],
    ]);
  });

  it('in a paid trial a smaller size is made at once, so one the members do not fit cannot be chosen', () => {
    const trial = { status: 'trialing', subscribed: true, seatCap: 200, nextSeatCap: 1000, priceLabel: '$199', currentPeriodEnd: END };
    const rows = sizeRows(PLANS, gym(trial, 300));
    expect(rows.map((r) => [r.kind, r.note, r.disabled])).toEqual([
      ['smaller', 'Nothing to pay now', true],
      ['smaller', 'Nothing to pay now', false],
      ['current', 'Your size', true],
    ]);
    expect(rows[0]?.warning).toBe('You have 300 members. Remove 100 to choose this size.');
    expect(sizeRows(PLANS, gym({ ...trial, nextSeatCap: 200 }, 10)).map((r) => [r.kind, r.note])).toEqual([
      ['current', 'Your size'],
      ['bigger', 'From your first payment'],
      ['bigger', 'From your first payment'],
    ]);
  });
});

describe('the last days’ question (1c-iii)', () => {
  const NOW = Date.parse('2026-10-23T12:00:00.000Z');
  const OWNER_PRIVS = ['members.read', 'billing.manage'];
  const pending = { seatCap: 200, priceLabel: '$79', from: '2026-10-25T06:00:00.000Z', decideAt: '2026-10-25T03:00:00.000Z', ifTooMany: { planCode: 'b2', seatCap: 500, priceLabel: '$129' } };
  const org = (over = {}) => ({
    orgType: 'gym',
    staffRole: 'owner',
    privileges: OWNER_PRIVS,
    seatsUsed: 250,
    consoleReadOnly: false,
    subscription: { status: 'active', subscribed: true, seatCap: 1000, priceLabel: '$199', currentPeriodEnd: pending.from, cancelAtPeriodEnd: false, pendingSize: pending },
    ...over,
  });

  it('asks billing staff of a gym with too many members, in the 3 days before, with the three choices', () => {
    const d = sizeDecision(org(), NOW);
    expect(d?.question).toBe(`You asked to move to 200 members on ${trialEndDateLabel(pending.from)}, but you have 250. What would you like to do?`);
    expect(d?.remove).toBe('Remove 50 members');
    expect(d?.moveInstead).toEqual({ planCode: 'b2', label: 'Move to 500 instead ($129 a month)' });
    expect(d?.stay).toBe(`Stay on ${(1000).toLocaleString()} ($199 a month)`);
    expect(d?.ifNothing).toBe(`If you don't choose, on ${trialEndDateLabel(pending.from)} you'll move to 500 members ($129 a month).`);
    // Nothing smaller fits: no "move instead", and staying is what happens.
    const none = sizeDecision(org({ subscription: { ...org().subscription, pendingSize: { ...pending, ifTooMany: null } } }), NOW);
    expect(none?.moveInstead).toBeNull();
    expect(none?.ifNothing).toBe(`If you don't choose, you'll stay on ${(1000).toLocaleString()} members.`);
  });

  it('asks nothing when the members fit, too early, once decided, of a trainer, or with nothing waiting', () => {
    expect(sizeDecision(org({ seatsUsed: 200 }), NOW)).toBeNull();
    expect(sizeDecision(org(), Date.parse('2026-10-21T12:00:00.000Z'))).toBeNull();
    expect(sizeDecision(org(), Date.parse('2026-10-25T03:00:00.000Z'))).toBeNull();
    expect(sizeDecision(org({ staffRole: 'trainer', privileges: ['members.read'] }), NOW)).toBeNull();
    expect(sizeDecision(org({ subscription: { ...org().subscription, pendingSize: null } }), NOW)).toBeNull();
  });

  it('says a bigger size was made instead, and why', () => {
    expect(sizeFittedText({ seatCap: 500, sizeFitted: { askedSeatCap: 200, members: 250 } }, 'gym')).toBe(
      "You had 250 members when your size changed, more than 200, so you moved to 500 members, the smallest size that fits. Change size again whenever you're ready.",
    );
    expect(sizeFittedText({ seatCap: 500, sizeFitted: null }, 'gym')).toBeNull();
  });
});

describe('round one (1c-iii): the paid size heads the card, and one member is one member', () => {
  it('heads with the plan the gym pays for while a smaller limit holds for a moment', () => {
    const held = { status: 'active', seatCap: 50, planSeatCap: 5000, priceLabel: '$20', currentPeriodEnd: '2026-11-01T00:00:00.000Z' };
    expect(planHeadline(held, 'gym')).toBe(`Up to ${(5000).toLocaleString()} members · $20 a month`);
    // The Change size list marks the plan it pays for as its own, not as a bigger size.
    const rows = sizeRows([{ code: 'a', seatCap: 50 }, { code: 'b', seatCap: 5000 }], { orgType: 'gym', seatsUsed: 3, subscription: held });
    expect(rows.map((r) => r.kind)).toEqual(['smaller', 'current']);
  });

  it('says "1 member", not "1 members"', () => {
    const now = Date.parse('2026-10-23T12:00:00.000Z');
    const sub = {
      status: 'active',
      subscribed: true,
      seatCap: 50,
      priceLabel: '$15',
      currentPeriodEnd: '2026-10-25T06:00:00.000Z',
      cancelAtPeriodEnd: false,
      pendingSize: { seatCap: 1, priceLabel: '$10', from: '2026-10-25T06:00:00.000Z', decideAt: '2026-10-25T03:00:00.000Z', ifTooMany: null },
    };
    const d = sizeDecision({ orgType: 'gym', staffRole: 'owner', privileges: ['billing.manage'], seatsUsed: 2, consoleReadOnly: false, subscription: sub }, now);
    expect(d?.remove).toBe('Remove 1 member');
    expect(d?.question).toMatch(/^You asked to move to 1 member on /);
    expect(pendingChangeText(sub, 'gym')).toMatch(/^Changing to 1 member \(\$10 a month\)/);
  });
});

describe('re-check N2 (1c-iii): no remove-by time once it has passed', () => {
  it('names the time before it, and none after it', () => {
    const pending = { seatCap: 50, priceLabel: '$15', from: '2026-11-01T00:00:00.000Z', decideAt: '2026-10-31T21:00:00.000Z', ifTooMany: null };
    const org = { orgType: 'gym', seatsUsed: 52, subscription: { status: 'active', seatCap: 5000, planSeatCap: 5000, priceLabel: '$20', pendingSize: pending } };
    expect(pendingFit(org, Date.parse('2026-10-31T20:00:00.000Z'))?.text).toMatch(/^You have 52 members\. Remove 2 by .+ to move to 50\. /);
    expect(pendingFit(org, Date.parse('2026-10-31T21:05:00.000Z'))?.text).toBe(
      `You have 52 members. Remove 2 to move to 50. Otherwise you'll stay on ${(5000).toLocaleString()} members at $20 a month.`,
    );
  });
});