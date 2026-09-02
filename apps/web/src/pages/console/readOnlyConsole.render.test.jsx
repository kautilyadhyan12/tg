// THE LAPSED GYM'S CONSOLE, ON SCREEN — Part 3 §4.2's read-only console and
// Kd's ruling of 2026-08-29 that it stops EVERY member of staff (:23711).
//
// `billingView.test.js` next door proves the RULES from an org row alone. This
// file proves the separate claim that the rules reach a control: that a lapsed
// gym's staff meet buttons they cannot press with a sentence saying why, rather
// than live buttons whose press is a 409 with no explanation — which is what
// they met before this card and is the whole of what it fixes.
//
// **EVERY CASE HERE RUNS IN BOTH DIRECTIONS, AND THAT IS THE POINT.** A gate
// whose only tested failure is "it did not fire" is satisfied by a door that is
// permanently shut (:7104's PG1), and a console permanently shut is a paying
// gym robbed of its own controls — the worse of the two defects, because the
// gym is a customer. So every "greyed on a lapsed gym" assertion is paired with
// the SAME control live on a gym that is paying.
//
// **THE OWNER IS NOT THE SUBJECT OF THIS FILE.** An owner on a gym with no plan
// meets `PlanModal`, the prompt they cannot skip (:23257), and never reaches
// these screens. Everything below is what a MANAGER sees — which is why Kd's
// ruling matters at all, and why the browser sheet needs a second account.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getCodes: vi.fn(),
      getApplications: vi.fn(),
      getStaff: vi.fn(),
      getPlans: vi.fn(),
      startTrial: vi.fn(),
      updateOrg: vi.fn(),
      /** ADDED 2026-09-01 WHEN `Settings` GAINED THE OPENING-HOURS PANEL.
       *  Not a courtesy: that panel READS on mount, so without an entry here
       *  `orgService.getHours` is `undefined` and every test in this file dies
       *  on the call rather than on its own subject. **A fixture goes stale
       *  because the FUTURE ARRIVES** (:21157's own audit finding), and the
       *  honest default is `unset` — a gym in these fixtures has never been
       *  asked when it is open, so the panel draws its "you haven't said yet"
       *  arm and interferes with nothing. */
      getHours: vi.fn(() =>
        Promise.resolve({ data: { hours: { mode: 'unset', timezone: 'UTC', week: [], closures: [] } } }),
      ),
      setHours: vi.fn(),
      closeDay: vi.fn(),
      removeClosure: vi.fn(),
    },
  };
});

const logout = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-manager' }, logout }),
}));

const { orgService } = await import('../../api/orgsApi');
const { resetConsoleOrgs } = await import('./consoleOrgs');
const { setCurrentUserId } = await import('../../utils/storage');
const { CONSOLE_READ_ONLY_BANNER, READ_ONLY_NOTE, READ_ONLY_QUEUE_NOTE } = await import(
  './billingView'
);
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const Overview = (await import('./Overview')).default;
const Members = (await import('./Members')).default;
const Settings = (await import('./Settings')).default;

const GYM_ID = '11111111-1111-1111-1111-111111111111';
const MEMBER_ID = '22222222-2222-2222-2222-222222222222';

/** A MANAGER, and the choice of role is load-bearing rather than incidental.
 *
 *  An OWNER holds `billing.manage`, so on a gym with no plan `planPromptFor`
 *  answers `'trial'` or `'subscribe'` and the unskippable prompt covers the
 *  whole console — they never see a greyed button in their lives. A manager is
 *  the person Kd's ruling is actually about: the one who can still reach these
 *  screens and would otherwise be pressing dead controls.
 *
 *  **FIVE OF THE SEVEN ARE WHAT A REAL MANAGER HOLDS; TWO ARE NOT, AND THE
 *  FIRST DRAFT OF THIS COMMENT SAID OTHERWISE (T3 round 1, Low-4).** It claimed
 *  a manager "holds every console power EXCEPT billing".
 *  `ROLE_PRIVILEGES.manager` is `members.read`, `codes.invite`, `codes.manage`,
 *  `members.confirm`, `members.remove` — and stops there.
 *
 *  **`staff.manage` and `org.manage` are here to MOUNT the two Settings panels**,
 *  which `Settings.jsx` does not draw without them — and neither is a tick a
 *  real manager can carry. `staff.manage` is in `OWNER_ONLY_PRIVILEGES`, so the
 *  server answers 409 `owner_only_privilege` on a non-owner row. `org.manage`
 *  is grantable in principle (:11429 rule 3) but **has no tick box on the Staff
 *  screen** — `PRIVILEGE_COPY` offers six values and that is not one of them, a
 *  gap :21157 recorded and nothing has closed since.
 *
 *  **So the component logic below is real and the PRINCIPAL is a fixture, which
 *  changes what each case is evidence OF.** The Overview and Members cases
 *  describe somebody a browser can produce; the two Settings cases rest on this
 *  file alone, and the smoke sheet says so rather than sending Kd to a tab he
 *  cannot open. Both become browser-reachable the day a second owner or a
 *  delegated `org.manage` ships, and both have live `OWED.md` lines. */
const MANAGER_PRIVILEGES = [
  'members.read',
  'codes.invite',
  'codes.manage',
  'members.confirm',
  'members.remove',
  'staff.manage',
  'org.manage',
];

const baseOrg = {
  id: GYM_ID,
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  country: 'US',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'manager',
  privileges: MANAGER_PRIVILEGES,
  seatsUsed: 12,
  ownerTrialUsed: null,
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
  // `.default(true)` in `myOrgSchema`, so every parsed row carries it — the
  // attendance switch reads the boolean rather than coercing one (T3 round 1,
  // L-5).
  manualAttendanceEnabled: true,
};

/** The gym after its trial ended: no live subscription, and the server's own
 *  answer to "may this console change anything". */
const LAPSED = { ...baseOrg, subscription: null, consoleReadOnly: true };

/** THE POSITIVE CONTROL, one field apart. Everything else about the two gyms is
 *  identical, so any difference a test observes can only be the read-only
 *  state — the point :7104's PG1 makes about doors that are simply shut. */
const PAYING = {
  ...baseOrg,
  subscription: { status: 'active', trialEndsAt: null, seatCap: 300 },
  consoleReadOnly: false,
};

/** An api older than this bundle, or any other reason the server could not
 *  answer. `null` is "we could not ask" and must grey out NOTHING (C97's rule,
 *  :23711) — the direction where guessing wrong seals a person out of a console
 *  they are entitled to use. */
const UNKNOWN = { ...baseOrg, subscription: null, consoleReadOnly: null };

const mineIs = (org) => ({ data: { orgs: [org], formerOrgs: [] } });

const CODE = {
  code: 'K7QM2X',
  label: 'Front Desk',
  paused: false,
  expiresAt: null,
  maxUses: null,
  joined: 4,
};

/** **THE CLOCK STANDS STILL FOR THE TWO COUNTDOWN CASES BELOW — T3 ROUND 2,
 *  Low-1.** Both fixtures carry fixed deadline strings, so on the real clock the
 *  BRANCH each one takes depends on the morning the suite runs. `APPLICANT`'s
 *  10 September deadline read `Expires in 11 days` on the day it was written and
 *  reads `Due to expire` from 10 September onwards — at which point both rows say
 *  the same thing, the positive control's `getByText(/due to expire/i)` throws on
 *  the pair, and the "BOTH DIRECTIONS" the lapsed case is named for quietly stops
 *  being true without anything going red.
 *
 *  **`joinGym.render.test.jsx` wrote this lesson down first, about this same
 *  countdown**: *"A test whose expected string depends on the day it runs is one
 *  that will fail some morning for a reason nobody can find."* This file asserts
 *  that countdown and did not apply it. Same helper as that file and as
 *  `console.render.test.jsx`, deliberately, rather than a third mechanism.
 *
 *  **`shouldAdvanceTime` is load-bearing, not decoration**: `findBy*` and
 *  `waitFor` poll on real timers, so a frozen clock hangs them until the suite's
 *  own timeout.
 *
 *  **THE INSTANT IS THE DAY THE TWO CASES WERE WRITTEN**, so every assertion in
 *  them keeps exactly the meaning it was verified to have — `Waiting 3 days` and
 *  `Waiting 60 days`, `Expires in 11 days` and `Due to expire` — permanently,
 *  instead of for eleven more days. 09:30Z is 15:00 in the zone the suite pins
 *  (`vitest.config.js`, Asia/Kolkata), nowhere near the local midnight a
 *  calendar-day count turns on. */
const NOW = new Date('2026-08-30T09:30:00.000Z');
const standAt = (when) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(when);
};

const APPLICANT = {
  id: 'app-1',
  displayName: 'Priya Sharma',
  appliedAt: '2026-08-27T09:00:00.000Z',
  // 14 days after `appliedAt`, which is the server's own rule for this column,
  // and AHEAD of `NOW` — so this row takes `Expires in N days` while the row
  // below takes the other branch.
  expiresAt: '2026-09-10T09:00:00.000Z',
  nudgedAt: null,
  gymNotifiedAt: null,
};

/** A second waiting person whose deadline is already BEHIND us, so
 *  `expiresInLabel` returns its other branch — `Due to expire` rather than
 *  `Expires in N days`.
 *
 *  **It is a FIXED PAST DATE on purpose**, 14 days after its own `appliedAt`
 *  like every real row. A date computed from `Date.now()` would make the fixture
 *  and its subject share a source, which proves only that the source is
 *  self-consistent (:3610's standing lesson). This is also the state Kd's own
 *  smoke left the database in — C pending with the deadline nearly a month gone
 *  (:25326 round log).
 *
 *  **THE SENTENCE THAT USED TO SIT HERE — "the suite runs on the real clock (no
 *  fake timers anywhere in this file), so past has to be past for good" — WAS
 *  TRUE WHEN WRITTEN AND IS NOT NOW** (T3 round 2, Low-1). The two countdown
 *  cases stand the clock at `NOW`. Worth leaving the correction rather than a
 *  silent rewrite: that sentence reasoned correctly about THIS date and never
 *  applied the mirror of it to the FUTURE one above, which is the whole of what
 *  the round found. */
const OVERDUE_APPLICANT = {
  id: 'app-2',
  displayName: 'Sunil Menon',
  appliedAt: '2026-07-01T09:00:00.000Z',
  expiresAt: '2026-07-15T09:00:00.000Z',
  nudgedAt: null,
  gymNotifiedAt: null,
};

/** Every string `expiresInLabel` can produce, so an assertion about the
 *  countdown cannot pass merely because today's date took a different branch.
 *  `joinClock.js:176-184` — `Due to expire`, `Expires today`, `Expires
 *  tomorrow`, `Expires in N days`. */
const ANY_COUNTDOWN = /due to expire|expires (today|tomorrow|in \d+ days?)/i;

const MEMBER = {
  userId: MEMBER_ID,
  displayName: 'Rahul Das',
  joinedAt: '2026-08-20T09:00:00.000Z',
  groupLabel: 'Front Desk',
  complimentary: false,
};

const STAFF = [
  {
    userId: 'u-owner',
    displayName: 'Aisha Khan',
    email: 'aisha@example.com',
    role: 'owner',
    since: '2026-08-01T09:00:00.000Z',
    isYou: false,
    privileges: null,
  },
  {
    userId: 'u-trainer',
    displayName: 'Dev Roy',
    email: 'dev@example.com',
    role: 'trainer',
    since: '2026-08-15T09:00:00.000Z',
    isYou: false,
    privileges: null,
  },
];

function quietTheRestOfTheScreen() {
  orgService.getCodes.mockResolvedValue({ data: { codes: [CODE] } });
  orgService.getMembers.mockResolvedValue({ data: { items: [MEMBER], nextCursor: null } });
  orgService.getApplications.mockResolvedValue({
    data: { items: [APPLICANT], nextCursor: null, pendingCount: 1 },
  });
  orgService.getStaff.mockResolvedValue({ data: { staff: STAFF } });
  orgService.getPlans.mockResolvedValue({ data: { plans: [] } });
}

/** The console as a person meets it: the shell — which owns §4.2's banner —
 *  around the screen. Rendering a screen alone would skip the banner entirely,
 *  and the banner is half of what this card ships. */
function renderConsole(Screen, path = '/console/iron-house') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/console/:orgSlug"
          element={
            <ConsoleLayout>
              <Screen />
            </ConsoleLayout>
          }
        />
        <Route
          path="/console/:orgSlug/members"
          element={
            <ConsoleLayout>
              <Screen />
            </ConsoleLayout>
          }
        />
        <Route
          path="/console/:orgSlug/settings"
          element={
            <ConsoleLayout>
              <Screen />
            </ConsoleLayout>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Put a value into a controlled React input the way a person's keystroke does.
 *  Assigning `.value` alone is invisible to React — it overwrites the property
 *  the renderer tracks — so the native setter is called and an `input` event
 *  dispatched, which is React's own documented route. */
function typeInto(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Open a collapsed Settings section the way a person does — every section on
 *  that screen is shut until tapped (:20338). */
async function openSection(name) {
  const heading = await screen.findByRole('button', { name: new RegExp(name, 'i') });
  heading.click();
}

/** The body of ONE section, through the handle `ConsoleSection` already
 *  publishes: its heading points at its own body with `aria-controls`. See the
 *  class guard at the foot of this file for why every note assertion needs
 *  scoping. */
async function sectionBody(name) {
  const heading = await screen.findByRole('button', { name: new RegExp(name, 'i') });
  const bodyId = heading.getAttribute('aria-controls');
  expect(bodyId).toBeTruthy();
  const body = document.getElementById(bodyId);
  expect(body).toBeTruthy();
  return within(body);
}

beforeEach(() => {
  resetConsoleOrgs();
  localStorage.clear();
  setCurrentUserId('u-manager');
  vi.clearAllMocks();
  quietTheRestOfTheScreen();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  setCurrentUserId(null);
  // **UNCONDITIONAL, AND NEVER AS A TEST'S LAST STATEMENT.** A failing assertion
  // never reaches the end of its own body, so a red countdown case would leave
  // every case after it frozen at `NOW` — a flake generator inside the fix for a
  // flake. `console.render.test.jsx` learned this as its round-3 Low-4 and the
  // placement is copied rather than re-derived.
  vi.useRealTimers();
});

// ── §4.2's banner ───────────────────────────────────────────────────────────

describe('the read-only banner', () => {
  it('tells a lapsed gym’s manager what is wrong, on every console screen', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Members, '/console/iron-house/members');

    const banner = await screen.findByTestId('console-banner');
    expect(banner.textContent).toBe(CONSOLE_READ_ONLY_BANNER);
    // §4.2 pairs this row with a *Reactivate* CTA and there is nowhere to send
    // anybody — no payment path, and one trial per owner ever. A button here
    // would promise something with no code behind it (:5807).
    expect(within(banner).queryByRole('button')).toBeNull();
  });

  it('is NOT drawn on a paying gym — the control that makes the case above mean something', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Members, '/console/iron-house/members');

    await screen.findByText('Rahul Das');
    expect(screen.queryByTestId('console-banner')).toBeNull();
  });

  it('is NOT drawn when the server could not tell us', async () => {
    // The whole existing fixture set in this repo is this shape, and an older
    // api is the real-world case. Drawing a red "this gym has no plan" over a
    // gym that is paying perfectly well is the defect this direction prevents.
    orgService.getMine.mockResolvedValue(mineIs(UNKNOWN));
    renderConsole(Members, '/console/iron-house/members');

    await screen.findByText('Rahul Das');
    expect(screen.queryByTestId('console-banner')).toBeNull();
  });
});

// ── The join codes ──────────────────────────────────────────────────────────

describe('the join codes', () => {
  it('are still SHOWN and still copyable — read-only seals nobody out', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Overview);

    // Kd's ruling is that staff still SEE everything (:23711). The code an
    // existing member might need is not hidden because the gym stopped paying,
    // and the Copy button is a read.
    const card = await screen.findByTestId('join-code-card');
    expect(within(card).getByText('K7QM2X')).toBeTruthy();
    expect(within(card).getByRole('button', { name: /copy/i }).disabled).toBe(false);
  });

  it('cannot be minted, paused, replaced or removed, and the panel says why', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Overview);

    // TWICE on this screen, deliberately: the big card an owner reads out, and
    // the row inside the managing panel under it. `findByText` would throw on
    // the pair, which is the existing suite's own idiom at `console.render`.
    await screen.findAllByText('K7QM2X');
    expect(screen.getByRole('button', { name: /new code/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /switch off/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /^limits$/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /^replace$/i }).disabled).toBe(true);
    // The greyed control is explained where it sits, not only in the strip at
    // the top of the page — a disabled button with no nearby sentence states
    // nothing at all.
    expect(screen.getAllByText(READ_ONLY_NOTE).length).toBeGreaterThan(0);
  });

  it('are fully live on a paying gym, with no note — the positive control', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Overview);

    // TWICE on this screen, deliberately: the big card an owner reads out, and
    // the row inside the managing panel under it. `findByText` would throw on
    // the pair, which is the existing suite's own idiom at `console.render`.
    await screen.findAllByText('K7QM2X');
    expect(screen.getByRole('button', { name: /new code/i }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /switch off/i }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^limits$/i }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^replace$/i }).disabled).toBe(false);
    expect(screen.queryByText(READ_ONLY_NOTE)).toBeNull();
  });

  it('stay live when the server could not tell us', async () => {
    orgService.getMine.mockResolvedValue(mineIs(UNKNOWN));
    renderConsole(Overview);

    // TWICE on this screen, deliberately: the big card an owner reads out, and
    // the row inside the managing panel under it. `findByText` would throw on
    // the pair, which is the existing suite's own idiom at `console.render`.
    await screen.findAllByText('K7QM2X');
    expect(screen.getByRole('button', { name: /new code/i }).disabled).toBe(false);
    expect(screen.queryByText(READ_ONLY_NOTE)).toBeNull();
  });
});

// ── The waiting queue — :23928's Low-5, and the one thing here about PEOPLE ──

describe('the waiting queue', () => {
  it('says nobody can be let in, and stops telling the desk to confirm anyone', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Members, '/console/iron-house/members');

    expect(await screen.findByText(READ_ONLY_QUEUE_NOTE)).toBeTruthy();
    // The standing sentence tells the front desk to do the one thing the server
    // now refuses. The COUNT stays — those people are really waiting.
    expect(screen.queryByText(/confirm the ones you recognise/i)).toBeNull();
    expect(screen.getByText(/1 person waiting/i)).toBeTruthy();
  });

  it('greys BOTH taps, because refusing somebody is refused too', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Members, '/console/iron-house/members');

    await screen.findByText('Priya Sharma');
    // `members.confirm` gates confirm AND reject on the server (:23711), so a
    // live "Not this person" would be the same 409 wearing a kinder label.
    expect(screen.getByRole('button', { name: /^confirm$/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /not this person/i }).disabled).toBe(true);
  });

  it('is untouched on a paying gym — the positive control', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Members, '/console/iron-house/members');

    await screen.findByText('Priya Sharma');
    expect(screen.getByRole('button', { name: /^confirm$/i }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /not this person/i }).disabled).toBe(false);
    expect(screen.getByText(/confirm the ones you recognise/i)).toBeTruthy();
    expect(screen.queryByText(READ_ONLY_QUEUE_NOTE)).toBeNull();
  });

  it('drops every applicant countdown on a lapsed gym, in BOTH directions', async () => {
    // T3 ROUND 1 ON THIS CARD, C/H-1. The card removed the false countdown from
    // the waiting person's OWN screen (`GymMembershipCard`) and left the
    // identical one here, on the gym's queue, directly under the sentence this
    // same commit added — *"The people waiting keep their place."* Both cannot
    // be true: the expiry's `gymOnPlan` guard means the row is held for as long
    // as the gym is off a plan, so no deadline applies to it (:25092 §1(a)).
    //
    // **BOTH BRANCHES OF `expiresInLabel` ARE ON SCREEN AT ONCE**, because the
    // defect was one expression covering them both and a fixture with only a
    // future date would leave `Due to expire` unobserved — which is the row Kd's
    // smoke actually produced.
    standAt(NOW);
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    orgService.getApplications.mockResolvedValue({
      data: { items: [APPLICANT, OVERDUE_APPLICANT], nextCursor: null, pendingCount: 2 },
    });
    renderConsole(Members, '/console/iron-house/members');

    // Both people are still listed — the hold keeps their place, it does not
    // hide them. The countdown is the only thing that goes.
    expect(await screen.findByText('Priya Sharma')).toBeTruthy();
    expect(screen.getByText('Sunil Menon')).toBeTruthy();
    // **`queryAllByText`, NOT `queryByText` — T3 round 2, Low-2.** With two
    // people on screen the singular form THROWS on a pair before it can return
    // anything, so C131 — the mutant that puts the countdown back — went red as
    // an opaque DOM error instead of as this assertion. It failed for the right
    // cause and said the wrong thing, which is :1620's `xpBar()` lesson: a
    // failure has to name what broke.
    expect(screen.queryAllByText(ANY_COUNTDOWN)).toHaveLength(0);
    // **AND THE HONEST CLOCK STAYS.** How long somebody has been waiting is true
    // whatever the plan is doing, so a fix that blanked the whole line would
    // pass the assertion above while destroying something true — this is what
    // separates "the deadline went" from "the line went".
    expect(screen.getAllByText(/waiting \d+ days?/i).length).toBe(2);
  });

  it('keeps the countdown on a PAYING gym — the positive control for the fix above', async () => {
    // Without this, a component that never printed a deadline at all would
    // satisfy the test above completely (:7104's PG1 — a guard has two failure
    // directions and a door that is simply shut passes the half you checked).
    standAt(NOW);
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    orgService.getApplications.mockResolvedValue({
      data: { items: [APPLICANT, OVERDUE_APPLICANT], nextCursor: null, pendingCount: 2 },
    });
    renderConsole(Members, '/console/iron-house/members');

    await screen.findByText('Priya Sharma');
    // **BOTH BRANCHES ARE NAMED, and that is the half the count below cannot
    // see** — two rows reading `Due to expire` also satisfy a length of 2, which
    // is exactly the state the real clock would have produced from 10 September
    // (T3 round 2, Low-1). Each of these is a single match only because the
    // clock stands at `NOW`.
    expect(screen.getByText(/due to expire/i)).toBeTruthy();
    expect(screen.getByText(/expires in 11 days/i)).toBeTruthy();
    expect(screen.getAllByText(ANY_COUNTDOWN).length).toBe(2);
  });

  it('tells the front desk the waiting people keep their place, and promises nothing beyond it', async () => {
    // Kd ruled on 2026-08-29 that a lapsed gym HOLDS its applications and tells
    // the waiting person why. Card A shipped this panel asserting the ABSENCE of
    // that reassurance, because an application still died 14 days after it was
    // made whatever the gym's plan was doing. **The hold is built now**, so the
    // sentence is here — and this test flipped in the commit that built it,
    // which is what it existed for.
    //
    // **THE NEGATIVE HALF SURVIVES AND MOVED ON TO THE NEXT UNTRUE THING.**
    // Nothing can put a lapsed gym back on a plan yet, so a held request whose
    // deadline has passed still needs the payment card to survive the first
    // sweep after the gym subscribes (`OWED.md`). Copy promising the gym will
    // confirm these people later is :5807's class, and this searches everything
    // the panel renders rather than the constant — so a reassurance added
    // anywhere else on the screen still goes red.
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Members, '/console/iron-house/members');

    await screen.findByText(READ_ONLY_QUEUE_NOTE);
    expect(screen.getByText(/keep their place/i)).toBeTruthy();
    expect(
      screen.queryByText(/when the gym|once the gym|we'll confirm|will be confirmed|reactivat/i),
    ).toBeNull();
  });
});

// ── The roster ──────────────────────────────────────────────────────────────

describe('the roster', () => {
  it('still lists everybody, and greys Remove', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Members, '/console/iron-house/members');

    expect(await screen.findByText('Rahul Das')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^remove$/i }).disabled).toBe(true);
    expect(screen.getAllByText(READ_ONLY_NOTE).length).toBeGreaterThan(0);
  });

  it('keeps Remove live on a paying gym — the positive control', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Members, '/console/iron-house/members');

    await screen.findByText('Rahul Das');
    expect(screen.getByRole('button', { name: /^remove$/i }).disabled).toBe(false);
    expect(screen.queryByText(READ_ONLY_NOTE)).toBeNull();
  });

  it('still draws the seat meter — a fact, not a control', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Members, '/console/iron-house/members');

    expect(await screen.findByTestId('seat-meter')).toBeTruthy();
  });
});

// ── Settings — the gym's details and the staff list ──────────────────────────

describe('the gym’s details', () => {
  it('cannot be saved, and the reason is above the boxes rather than beside the button', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('gym details');
    const save = await screen.findByRole('button', { name: /save changes/i });
    expect(save.disabled).toBe(true);
    expect(screen.getAllByText(READ_ONLY_NOTE).length).toBeGreaterThan(0);
  });

  // **THIS PAIR EXISTS BECAUSE MUTANT C116 SURVIVED THE FIRST RUN OF THIS FILE.**
  // The case above asserts the SAVE BUTTON is disabled, and that is genuinely
  // all it asserts — delete `readOnly` from the submit guard and it stays green,
  // because a `<form>` submits on ENTER without going through its button. The
  // guarantee was real and had no observer, which is :17676's question asked in
  // the right order: observable first, then a missing test rather than an
  // unfalsifiable guard.
  it('does not save when the form is SUBMITTED, which the greyed button cannot stop', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('gym details');
    const name = await screen.findByLabelText(/gym name/i);
    typeInto(name, 'Iron House Gym');
    // Something HAS changed, so the only thing standing between this submit and
    // a request is the read-only guard.
    fireEvent.submit(name.closest('form'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i }).disabled).toBe(true);
    });
    expect(orgService.updateOrg).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Saved\.$/)).toBeNull();
  });

  it('DOES save on the same submit when the gym is paying — the positive control', async () => {
    // Without this, the case above is satisfied by a form that never submits at
    // all, which is :7104's PG1 in miniature.
    orgService.updateOrg.mockResolvedValue({ data: { org: { ...PAYING, name: 'Iron House Gym' } } });
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('gym details');
    const name = await screen.findByLabelText(/gym name/i);
    typeInto(name, 'Iron House Gym');
    fireEvent.submit(name.closest('form'));

    await waitFor(() => {
      expect(orgService.updateOrg).toHaveBeenCalledWith(GYM_ID, { name: 'Iron House Gym' });
    });
  });

  it('is still readable — the name, the city and the currency are all on screen', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('gym details');
    expect((await screen.findByLabelText(/gym name/i)).value).toBe('Iron House');
    expect(screen.getByLabelText(/city/i).value).toBe('Austin');
    expect(screen.getByText(/billed in USD/i)).toBeTruthy();
  });

  it('saves normally on a paying gym once something changes — the positive control', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('gym details');
    const name = await screen.findByLabelText(/gym name/i);
    // Save is off until something moves, on BOTH gyms — so the control has to
    // move something, or it would be asserting the wrong disabled-ness.
    typeInto(name, 'Iron House Gym');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i }).disabled).toBe(false);
    });
    expect(screen.queryByText(READ_ONLY_NOTE)).toBeNull();
  });
});

describe('the staff list', () => {
  it('is still readable, and every way of changing it is greyed', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('staff');
    expect(await screen.findByText('Dev Roy')).toBeTruthy();
    expect(screen.getByRole('button', { name: /add someone/i }).disabled).toBe(true);
    // The trainer's row carries both: a role change and a removal.
    expect(screen.getByRole('button', { name: /make manager/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /^remove$/i }).disabled).toBe(true);
    expect(screen.getAllByText(READ_ONLY_NOTE).length).toBeGreaterThan(0);
  });

  it('greys the tick boxes as well, since saving them is refused too', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('staff');
    await screen.findByText('Dev Roy');
    // **THE TRAINER'S ROW, NEVER THE FIRST ONE ON SCREEN.** The first row is the
    // OWNER's, whose ticks are permanently read-only for an unrelated reason — a
    // gym has to keep somebody who can hand out the keys. A draft of this test
    // took `[0]` and PASSED against code with the read-only prop deleted, which
    // is a green liar of my own making (:5348 rule 4) and the reason both
    // tick-box cases below are scoped to a row that has no other lock on it.
    const trainerRow = screen.getByTestId('staff-u-trainer');
    within(trainerRow).getByRole('button', { name: /what they can do/i }).click();

    const boxes = within(await screen.findByTestId('privileges-u-trainer')).getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box.disabled).toBe(true);
    // And the way to save them is gone too, not merely the boxes.
    expect(
      within(screen.getByTestId('privileges-u-trainer')).getByRole('button', {
        name: /save permissions/i,
      }).disabled,
    ).toBe(true);
  });

  it('leaves all of it live on a paying gym — the positive control', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('staff');
    await screen.findByText('Dev Roy');
    expect(screen.getByRole('button', { name: /add someone/i }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /make manager/i }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^remove$/i }).disabled).toBe(false);
    expect(screen.queryByText(READ_ONLY_NOTE)).toBeNull();

    // The TRAINER's row again, for the reason spelled out in the lapsed case.
    within(screen.getByTestId('staff-u-trainer'))
      .getByRole('button', { name: /what they can do/i })
      .click();
    const boxes = within(await screen.findByTestId('privileges-u-trainer')).getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box.disabled).toBe(false);
  });

  it('keeps the OWNER’s ticks read-only on a PAYING gym, which is a different lock', async () => {
    // Two locks now live in one component and they must not be confused: the
    // owner's row can never be edited (a gym has to keep somebody who can hand
    // out the keys), and that is true whatever the gym's plan is doing. If the
    // rename of the local `readOnly` had gone wrong, this is what would catch it.
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('staff');
    await screen.findByText('Aisha Khan');
    const ownerRow = screen.getByTestId('staff-u-owner');
    within(ownerRow).getByRole('button', { name: /what they can do/i }).click();

    const ownerTicks = await screen.findByTestId('privileges-u-owner');
    for (const box of within(ownerTicks).getAllByRole('checkbox')) {
      expect(box.disabled).toBe(true);
    }
    expect(within(ownerTicks).getByText(/hand out the keys/i)).toBeTruthy();
    expect(within(ownerTicks).queryByRole('button', { name: /save permissions/i })).toBeNull();
  });
});

// ── The gym lapses while somebody is holding a step open ────────────────────
//
// **T3 ROUND 1's Critical/High, AND EVERY CASE ABOVE WAS STRUCTURALLY BLIND TO
// IT.** They all render a gym that is ALREADY lapsed, so they only ever meet the
// controls a closed panel draws — the openers. Behind each opener is a second
// control that actually sends the request, and three of them (Save, Replace it,
// Remove it) plus the new-code form's Make the code carried `busy` alone. The
// panel's own comment said the prop reached "every control below", which is how
// a reviewer reading the file would have been reassured rather than alerted.
//
// **THE PATH IS NOT HYPOTHETICAL AND THE APP WALKS IT ITSELF.** `consoleOrgs`
// re-reads `/v1/orgs/mine` on `focus` and on `visibilitychange`; a code row is
// keyed on the CODE and the panels on `org.id`, neither of which changes when a
// plan ends; and whether a step is open is local state. So a manager who opens
// "Replace it?" on a gym that is paying, switches tabs while the trial expiry
// sweep runs, and comes back, lands on a red strip, a panel note saying nothing
// can be changed, and a live full-colour destructive button underneath both.
// One of those three was false, and it was the button.
//
// Every case below drives the REAL listener with a real `focus` event rather
// than calling the store's re-read directly — the wiring is half of what makes
// the journey reachable, and a test that skipped it would prove the guard
// without proving the path.

/** Paying when the step is opened, lapsed by the time it could be pressed. */
async function theGymLapsesUnderTheScreen() {
  orgService.getMine.mockResolvedValue(mineIs(LAPSED));
  window.dispatchEvent(new Event('focus'));
  // The banner is the observable proof the new answer reached the screen; every
  // assertion after this is about a panel that did NOT remount around it.
  await screen.findByTestId('console-banner');
}

describe('a step already open when the gym lapses', () => {
  it('greys the limits editor Save, and the boxes above it', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Overview);

    await screen.findAllByText('K7QM2X');
    screen.getByRole('button', { name: /^limits$/i }).click();

    // THE POSITIVE CONTROL IS THE FIRST HALF OF THIS TEST, not a separate case:
    // without it the assertion below is satisfied by an editor whose Save is
    // never pressable at all (:7104's PG1).
    const save = await screen.findByRole('button', { name: /^save$/i });
    expect(save.disabled).toBe(false);

    await theGymLapsesUnderTheScreen();

    expect(screen.getByRole('button', { name: /^save$/i }).disabled).toBe(true);
    // The fields are their own surface: typing into a live box on a gym that
    // cannot be changed is a smaller version of the same false promise.
    expect(screen.getByLabelText(/maximum people/i).disabled).toBe(true);
    expect(screen.getAllByText(READ_ONLY_NOTE).length).toBeGreaterThan(0);
  });

  it('greys Replace it inside the confirm step', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Overview);

    await screen.findAllByText('K7QM2X');
    screen.getByRole('button', { name: /^replace$/i }).click();

    const replaceIt = await screen.findByRole('button', { name: /^replace it$/i });
    expect(replaceIt.disabled).toBe(false);

    await theGymLapsesUnderTheScreen();

    expect(screen.getByRole('button', { name: /^replace it$/i }).disabled).toBe(true);
    // **AND "Keep it" IS STILL PRESSABLE, which is the other direction.** Backing
    // out of a step is not a change, and a console that froze somebody inside a
    // confirmation they cannot leave would be a worse screen than the one this
    // card replaced.
    expect(screen.getByRole('button', { name: /^keep it$/i }).disabled).toBe(false);
  });

  it('greys Remove it inside the confirm step', async () => {
    // A code is only removable once it is switched off, so this row is paused —
    // which is also why it draws "Switch on" rather than "Switch off".
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...CODE, code: 'P4USED', paused: true }] },
    });
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Overview);

    await screen.findAllByText('P4USED');
    screen.getByRole('button', { name: /^remove$/i }).click();

    const removeIt = await screen.findByRole('button', { name: /^remove it$/i });
    expect(removeIt.disabled).toBe(false);

    await theGymLapsesUnderTheScreen();

    expect(screen.getByRole('button', { name: /^remove it$/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /^keep it$/i }).disabled).toBe(false);
  });

  it('greys Make the code inside the new-code form', async () => {
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Overview);

    await screen.findAllByText('K7QM2X');
    screen.getByRole('button', { name: /new code/i }).click();

    const make = await screen.findByRole('button', { name: /make the code/i });
    expect(make.disabled).toBe(false);

    await theGymLapsesUnderTheScreen();

    expect(screen.getByRole('button', { name: /make the code/i }).disabled).toBe(true);
    expect(screen.getByLabelText(/maximum people/i).disabled).toBe(true);
  });

  it('greys the add-staff form Add, its email box and its role buttons', async () => {
    // **NOBODY CAN REACH THIS IN A BROWSER TODAY** — the Staff section is gated
    // on `staff.manage`, which only an owner's row may carry, and an owner of a
    // lapsed gym meets `PlanModal` instead of Settings. It is fixed and pinned
    // anyway: the guard costs one expression, and the two things that would make
    // it reachable (a second owner, delegated staff management) both have live
    // `OWED.md` lines. This case is the record that it was never observed.
    orgService.getMine.mockResolvedValue(mineIs(PAYING));
    renderConsole(Settings, '/console/iron-house/settings');

    await openSection('staff');
    await screen.findByText('Dev Roy');
    screen.getByRole('button', { name: /add someone/i }).click();

    const add = await screen.findByRole('button', { name: /^add$/i });
    expect(add.disabled).toBe(false);

    await theGymLapsesUnderTheScreen();

    expect(screen.getByRole('button', { name: /^add$/i }).disabled).toBe(true);
    expect(screen.getByLabelText(/their email address/i).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /trainer/i }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /^cancel$/i }).disabled).toBe(false);
  });
});

// ── THE CLASS GUARD: every greying Settings panel says WHY, in its own body ──

/** **THIS IS THE TEST THAT SHOULD HAVE CAUGHT T3 ROUND 1's C/H-1 AND
 *  STRUCTURALLY COULD NOT** (:5348 rule 5 — a bug CLASS gets an automated check,
 *  so a class found once cannot silently return).
 *
 *  **THE REASON WRITTEN HERE BY ROUND 1 WAS WRONG, AND ROUND 2 MEASURED IT.**
 *  It said the old assertions — `getAllByText(READ_ONLY_NOTE).length > 0`, a
 *  claim about the whole SCREEN — were structurally blind, because Settings
 *  mounts four panels sharing one sentence so any ONE of them satisfied all of
 *  them. **That is not what happens.** `ConsoleSection` UNMOUNTS a closed body
 *  (`ConsoleStates.jsx:114-118`, its own comment: *"Closed means UNMOUNTED
 *  here"*) and every case here opens exactly ONE section, so on Settings the
 *  screen-wide query only ever had one panel's body to find. Measured: kill
 *  `GymDetailsPanel`'s note and *"cannot be saved, and the reason is above the
 *  boxes"* — one of the assertions round 1 called blind — goes RED.
 *
 *  **THE TRUE REASON IS PLAINER AND IS THE ONE TO CARRY: no test ever opened
 *  the attendance section with a note assertion in it.** Not a broken
 *  instrument — a missing case. The corrected figure, since round 1's was wrong
 *  too: FIVE assertions take that `getAllByText` shape and ten mention the note
 *  at all, **all of them in this file**; `settings.render` had none before
 *  round 1 (`git show HEAD~:…` — zero occurrences).
 *
 *  A per-panel loop is still the durable shape, and the LIST is what makes it
 *  durable: a fifth SECTION added to Settings without a line here is a section
 *  nobody is checking — so the count is asserted too. `ConsoleSection`'s
 *  `aria-controls` is the scope; nothing here guesses at a class name.
 *
 *  **WHAT THE COUNT CANNOT SEE, NAMED RATHER THAN IMPLIED (round 2, L-2).** It
 *  filters on `aria-expanded`, which only a `ConsoleSection` heading carries —
 *  so it counts SECTIONS, not panels. A fifth panel that greys a control inside
 *  a plain `ConsoleCard` adds no heading and this describe stays green.
 *  **Measured, not reasoned: a probe card with one `disabled` button and no note
 *  was added to `Settings.jsx` and all 164 cases in this file and
 *  `settings.render` stayed green.** That shape is not hypothetical —
 *  `Members.jsx:343-347` greys Remove and writes the note in a bare `<div>`.
 *  Widening the count means giving `ConsoleCard` a test handle, which is a
 *  shared component and another card's diff (R1.1); the boundary is written
 *  down instead, because a guard whose claim outruns its reach is :26947's
 *  shape and this comment was that.
 *
 *  It asserts BOTH directions per panel, because a component that printed the
 *  sentence unconditionally would satisfy the lapsed half alone (:7104's PG1). */
describe('every Settings panel that greys a control explains itself, in its own section', () => {
  const GREYING_SECTIONS = ['gym details', "when we're open", 'marking attendance', 'staff'];

  it('draws exactly these four sections and no fifth one nobody is checking', async () => {
    orgService.getMine.mockResolvedValue(mineIs(LAPSED));
    renderConsole(Settings, '/console/iron-house/settings');
    await screen.findByTestId('console-banner');

    // `ConsoleSection` is the only thing on this screen whose heading controls a
    // body, so counting those headings counts the SECTIONS — and only those. A
    // greying panel drawn as a plain `ConsoleCard` carries no heading and is
    // invisible here; the docstring above says so and says why.
    const headings = screen
      .getAllByRole('button')
      .filter((el) => el.getAttribute('aria-expanded') !== null);
    expect(headings).toHaveLength(GREYING_SECTIONS.length);
  });

  for (const name of GREYING_SECTIONS) {
    it(`says why inside “${name}” on a gym with no plan`, async () => {
      orgService.getMine.mockResolvedValue(mineIs(LAPSED));
      renderConsole(Settings, '/console/iron-house/settings');

      await openSection(name);
      const panel = await sectionBody(name);
      expect(panel.getByText(READ_ONLY_NOTE)).toBeTruthy();
    });

    it(`says nothing of the sort inside “${name}” on a paying gym`, async () => {
      orgService.getMine.mockResolvedValue(mineIs(PAYING));
      renderConsole(Settings, '/console/iron-house/settings');

      await openSection(name);
      const panel = await sectionBody(name);
      expect(panel.queryByText(READ_ONLY_NOTE)).toBeNull();
    });
  }
});
