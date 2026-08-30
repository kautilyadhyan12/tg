// The member's half of the join door, on screen.
//
// The load-bearing test in this file is the §2.4 SHEET. Part 3 §2.4 requires
// the join screen to show "What {org} can see" with exactly that list, and it
// is the second of the three things that make the org-visibility boundary real
// rather than a policy nobody reads. A screen that quietly dropped it would
// still join gyms perfectly and would break a promise the product makes in
// writing — no other test in this repo would notice.
//
// The rest is the shape this project keeps getting wrong: a failed read drawn
// as an empty one, a refusal reworded on the way to the person reading it, and
// copy promising something the app cannot do (an email nobody sends, an expiry
// nothing enforces).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      join: vi.fn(),
      getMyApplications: vi.fn(),
      getMine: vi.fn(),
      nudgeApplication: vi.fn(),
    },
  };
});

const { orgService } = await import('../../api/orgsApi');
const JoinGymPanel = (await import('./JoinGymPanel')).default;
const GymMembershipCard = (await import('./GymMembershipCard')).default;
const JoinGym = (await import('../../pages/JoinGym')).default;

const ORG = {
  id: 'gym-1',
  slug: 'iron-house',
  name: 'Iron House',
  city: null,
  orgType: 'gym',
  timezone: 'UTC',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
};

const APPLICATION = {
  id: 'app-1',
  status: 'pending',
  appliedAt: '2026-08-19T09:00:00.000Z',
  expiresAt: '2026-09-02T09:00:00.000Z',
  decidedAt: null,
  nudgedAt: null,
};

/** Stand the clock at a fixed instant, so "Expires in 13 days" is a fact rather
 *  than something that drifts as the calendar moves. A test whose expected
 *  string depends on the day it runs is one that will fail some morning for a
 *  reason nobody can find.
 *
 *  `shouldAdvanceTime` is load-bearing, not decoration: `findBy*` and `waitFor`
 *  poll on real timers, so a frozen clock hangs them until the suite's own
 *  timeout — which is what the first draft of these two tests did. Time still
 *  moves; it just starts here. */
const NOW = new Date('2026-08-20T09:00:00.000Z');
const standAt = (when) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(when);
};

const ok = (data) => Promise.resolve({ data });
const serverSaid = (status, error, message) =>
  Promise.reject({ response: { status, data: { error, message, requestId: 'r' } } });

const draw = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

/** The PAGE at a real address, so `useSearchParams` is what supplies the code
 *  rather than a prop a test chose (T3 r1 L-2). The link is there so one test
 *  can navigate to a second poster WITHOUT remounting the route — the exact
 *  case L-5 was about. */
const drawRoute = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Link to="/org/join?code=bbb222">second poster</Link>
      <Routes>
        <Route path="/org/join" element={<JoinGym />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  orgService.join.mockReset();
  orgService.getMyApplications.mockReset();
  orgService.getMine.mockReset();
  orgService.nudgeApplication.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the join panel', () => {
  it('SHOWS THE §2.4 SHEET BEFORE ANYTHING IS TYPED — every line of it', () => {
    draw(<JoinGymPanel />);
    // "What a gym can see" — generic, because until the server answers the app
    // does not know WHICH gym a code belongs to and a guessed name would be a
    // false thing on screen.
    expect(screen.getByText(/what a gym can see/i)).toBeTruthy();
    expect(screen.getByText(/form scores/i)).toBeTruthy();
    expect(screen.getByText(/streak/i)).toBeTruthy();
    // The five NEVERs, each asserted on its own so deleting one row goes red.
    expect(screen.getByText(/meals, or anything about nutrition/i)).toBeTruthy();
    expect(screen.getByText(/weight or body measurements/i)).toBeTruthy();
    expect(screen.getByText(/conversations with the AI coach/i)).toBeTruthy();
    expect(screen.getByText(/where you ran/i)).toBeTruthy();
    expect(screen.getByText(/before you joined, or after you leave/i)).toBeTruthy();
  });

  it('applies with the typed code and reports WAITING, naming the gym', async () => {
    orgService.join.mockReturnValue(ok({ outcome: 'pending', org: ORG, application: APPLICATION }));
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'k7qm2x' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));

    await waitFor(() => expect(screen.getByText(/you've asked to join iron house/i)).toBeTruthy());
    // Typed lowercase, sent as the person's gym prints it.
    expect(orgService.join).toHaveBeenCalledWith({ code: 'K7QM2X' });
    // The sheet comes back NAMED once the gym is known.
    expect(screen.getByText(/what iron house can see/i)).toBeTruthy();
    // The ordinary answer keeps the front-desk sentence — the positive control
    // for the held case below (:7104's PG1).
    expect(screen.getByText(/ask them now/i)).toBeTruthy();
  });

  // ── APPLYING TO A GYM THAT CANNOT CONFIRM ANYBODY (Kd, :24141 §1) ─────────
  //
  // **`/org/join` DRAWS THIS PANEL AND NOTHING ELSE** — it is where the QR and
  // the poster land, and the dashboard's gym card is not on that route. So a
  // sentence that is wrong here is wrong with no second screen to correct it,
  // which is why the field reaches the JOIN DOOR's answer and not only the
  // waiting list.
  it('tells somebody applying to a gym with no plan that their request is HELD', async () => {
    orgService.join.mockReturnValue(
      ok({
        outcome: 'pending',
        org: ORG,
        application: { ...APPLICATION, orgCanConfirm: false },
      }),
    );
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'k7qm2x' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));

    await waitFor(() => expect(screen.getByText(/you've asked to join iron house/i)).toBeTruthy());
    expect(screen.getByText(/can't take new members right now/i)).toBeTruthy();
    expect(screen.getByText(/being held/i)).toBeTruthy();
    // The tap this describes answers 409 for such a gym (:23711).
    expect(document.body.textContent).not.toMatch(/ask them now/i);
    // And "Nothing is on hold" cannot sit under "your request is being held".
    expect(document.body.textContent).not.toMatch(/nothing is on hold/i);
  });

  it('says nothing about a plan, and promises no later confirmation, on that screen', async () => {
    // An applicant is not staff of this gym. :23711 §2(a) ordered the server's
    // own checks so a stranger holding a uuid cannot learn which gyms have
    // stopped paying, and the copy sits inside the same boundary. Nothing can
    // put a lapsed gym back on a plan yet either, so a promise to confirm them
    // later would be :5807's class.
    orgService.join.mockReturnValue(
      ok({
        outcome: 'pending',
        org: ORG,
        application: { ...APPLICATION, orgCanConfirm: false },
      }),
    );
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'k7qm2x' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));

    await screen.findByText(/being held/i);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/plan|subscription|paying|payment|billing|lapsed/i);
    expect(text).not.toMatch(/when they|once they|we'll let you|will be confirmed|as soon as/i);
  });

  it('treats a MISSING answer as the ordinary screen — an older api invents no held state', async () => {
    // The `APPLICATION` fixture omits the field, which is the shape an api
    // deployed before this card returns. `null` means "we could not ask", never
    // "no" — and drawing the held sentence off it would tell somebody waiting on
    // a perfectly healthy gym that it has stopped taking members.
    orgService.join.mockReturnValue(ok({ outcome: 'pending', org: ORG, application: APPLICATION }));
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'k7qm2x' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));

    await screen.findByText(/you've asked to join iron house/i);
    expect(screen.getByText(/ask them now/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/being held/i);
  });

  it('PROMISES NO EMAIL, and leaves the countdown to the card that owns it', async () => {
    // EMAIL STILL DOES NOT EXIST — `EmailSender` logs an event name and sends
    // nothing — so a "we'll email you" here would be false, which is the class
    // this project treats as Critical.
    //
    // **THE EXPIRY HALF OF THIS TEST CHANGED MEANING ON 2026-08-20 and the old
    // comment is corrected rather than left standing.** It used to read "no
    // code reads that date yet", which is no longer true: the sweep reads it,
    // and the member's own card now shows the countdown. What this assertion
    // pins TODAY is that the countdown lives in ONE place — the card, off the
    // server's `expiresAt` — instead of being re-derived by a second screen
    // that could quote a different date.
    orgService.join.mockReturnValue(ok({ outcome: 'pending', org: ORG, application: APPLICATION }));
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'K7QM2X' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(screen.getByText(/you've asked to join/i)).toBeTruthy());

    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/email/i);
    expect(page).not.toMatch(/expire/i);
    expect(page).not.toMatch(/\b14 days?\b/i);
  });

  it('treats a second ask as the same answer, not an error', async () => {
    orgService.join.mockReturnValue(
      ok({ outcome: 'already_pending', org: ORG, application: APPLICATION }),
    );
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'K7QM2X' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(screen.getByText(/you've asked to join iron house/i)).toBeTruthy());
  });

  it('tells somebody already in the gym that they are already in', async () => {
    orgService.join.mockReturnValue(
      ok({
        outcome: 'already_member',
        org: ORG,
        membership: { id: 'm1', joinedAt: '2026-08-01T00:00:00.000Z', groupLabel: 'Front Desk' },
      }),
    );
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'K7QM2X' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() =>
      expect(screen.getByText(/already a member of iron house/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/you've asked to join/i)).toBeNull();
  });

  it("prints the SERVER's sentence on a refusal, not a rewritten one", async () => {
    orgService.join.mockReturnValue(
      serverSaid(409, 'code_paused', 'That code has been paused. Ask the gym for a current one.'),
    );
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'PAUSED' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(screen.getByText(/that code has been paused/i)).toBeTruthy());
    // Still on the form, with what they typed, so the next attempt is one edit
    // away rather than a fresh start.
    expect(screen.getByLabelText(/your gym's code/i).value).toBe('PAUSED');
  });

  it('never reports a refusal as a connection problem, or the reverse', async () => {
    orgService.join.mockReturnValue(
      Object.assign(Promise.reject(new Error('Network Error')), {}),
    );
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'K7QM2X' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeTruthy());
  });

  it('asks for consent only when the SERVER asks, then sends it', async () => {
    // A fabricated consent record is worse than a missing one — for a clinic it
    // IS the DPDP/GDPR record. So the box appears because the server said it
    // needed one, and the resubmit carries what the person actually ticked.
    orgService.join.mockReturnValueOnce(
      serverSaid(400, 'consent_required', 'Joining this clinic needs your agreement.'),
    );
    draw(<JoinGymPanel />);
    expect(screen.queryByRole('checkbox')).toBeNull();

    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'CLINIC' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy());

    // Unticked, the button is refused — no path sends consent the person did
    // not give.
    expect(screen.getByRole('button', { name: /ask to join/i }).disabled).toBe(true);

    orgService.join.mockReturnValueOnce(
      ok({ outcome: 'pending', org: ORG, application: APPLICATION }),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(screen.getByText(/you've asked to join/i)).toBeTruthy());
    expect(orgService.join).toHaveBeenLastCalledWith({ code: 'CLINIC', consent: true });
  });

  it('forgets the consent question when the code is edited', async () => {
    // The agreement was given about ONE organisation. Carrying a ticked box
    // across to a different code would stamp a consent record for a gym that
    // never asked for one — the same fabrication, one step removed.
    orgService.join.mockReturnValueOnce(
      serverSaid(400, 'consent_required', 'Joining this clinic needs your agreement.'),
    );
    draw(<JoinGymPanel />);
    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'CLINIC' } });
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeTruthy());
    fireEvent.click(screen.getByRole('checkbox'));

    fireEvent.change(screen.getByLabelText(/your gym's code/i), { target: { value: 'OTHERG' } });
    expect(screen.queryByRole('checkbox')).toBeNull();

    orgService.join.mockReturnValueOnce(
      ok({ outcome: 'pending', org: ORG, application: APPLICATION }),
    );
    fireEvent.click(screen.getByRole('button', { name: /ask to join/i }));
    await waitFor(() => expect(screen.getByText(/you've asked to join/i)).toBeTruthy());
    expect(orgService.join).toHaveBeenLastCalledWith({ code: 'OTHERG' });
  });

  it('prefills the code a poster link carried, and still waits to be pressed', () => {
    // A QR taped to a wall must not enrol whoever points a phone at it.
    draw(<JoinGymPanel initialCode="k7qm2x" />);
    expect(screen.getByLabelText(/your gym's code/i).value).toBe('K7QM2X');
    expect(orgService.join).not.toHaveBeenCalled();
  });
});

// ── the poster address itself ───────────────────────────────────────────────
//
// T3 r1 L-2: the test above hands the code in as a PROP, so it proves the panel
// honours `initialCode` and says nothing about where that value comes from.
// Renaming the query parameter — `params.get('code')` → `params.get('c')` —
// sent every QR in existence to an empty box and left the whole suite green.
// These drive the real ADDRESS instead, which is the only thing a poster has.
describe('/org/join, the address a poster QR points at', () => {
  it('reads the code out of the URL and prefills it, unsubmitted (T3 r1 L-2)', () => {
    drawRoute('/org/join?code=ttusd2');
    expect(screen.getByLabelText(/your gym's code/i).value).toBe('TTUSD2');
    // Prefilled, never sent: applying puts your name in front of a gym and is
    // a deliberate act, so a scanned poster may fill the box and nothing more.
    expect(orgService.join).not.toHaveBeenCalled();
  });

  it('opens an empty box when the address carries no code at all', () => {
    drawRoute('/org/join');
    expect(screen.getByLabelText(/your gym's code/i).value).toBe('');
  });

  it('follows the URL to a SECOND poster rather than keeping the first code', () => {
    // T3 r1 L-5. React Router does not remount a route when only the SEARCH
    // string changes, so a second poster used to leave the first gym's code
    // sitting in the box — and the person then asks to join the wrong gym.
    // The navigation here is a real in-router one (a link press), which is the
    // case a fresh `render` would quietly step over.
    drawRoute('/org/join?code=aaa111');
    expect(screen.getByLabelText(/your gym's code/i).value).toBe('AAA111');
    fireEvent.click(screen.getByText('second poster'));
    expect(screen.getByLabelText(/your gym's code/i).value).toBe('BBB222');
  });
});

// ── the four wiring points ──────────────────────────────────────────────────
//
// T3 r1 L-1: every component in this card was tested, and NOTHING asserted that
// any of them was actually reachable. Delete the route from `App.jsx`, or the
// card from `Dashboard.jsx`, or either half of Settings → Gym, and all 857 web
// tests stayed green while the feature vanished from the product — the exact
// class this card exists to close, one level up from the code it closed it in.
//
// These are SOURCE assertions, and the honest limits are worth stating: they
// prove a page still names the component, not that it renders — a page whose
// own render throws would pass them. That instrument is the repo's own
// precedent (`gamificationApi.test.js` reads pages the same way) and it is what
// is affordable here; a page-level render harness for `Dashboard`/`Settings`
// would be its own card and has an `OWED.md` line. It catches deletion, which
// is the failure that actually happened.
describe('the join door is reachable at all', () => {
  // T3 round 2, rule 4: this stripped line comments only where they STARTED a
  // line, so a TRAILING `// <GymMembershipCard />` would have satisfied a
  // wiring regex over deleted markup. `(^|\s)//` catches both and cannot eat a
  // URL, because `https://` has no whitespace before its slashes.
  const stripComments = (raw) =>
    raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const codeAt = (rel) =>
    stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

  it('App.jsx routes /org/join to the JoinGym page', () => {
    const src = codeAt('../../App.jsx');
    expect(src).toMatch(/path=(["'])\/org\/join\1/);
    expect(src).toMatch(/<JoinGym\s*\/>/);
    expect(src).toMatch(/import\s+JoinGym\s+from/);
  });

  it('the JoinGym page renders the shared panel rather than its own form', () => {
    const src = codeAt('../../pages/JoinGym.jsx');
    expect(src).toMatch(/<JoinGymPanel\b/);
    // The prefill comes from the ADDRESS. Behaviour is pinned by the route
    // tests above; this pins that the wiring is still here to be exercised.
    expect(src).toMatch(/useSearchParams\s*\(/);
  });

  it('the Dashboard still draws the gym card', () => {
    const src = codeAt('../../pages/Dashboard.jsx');
    expect(src).toMatch(/<GymMembershipCard\b/);
    expect(src).toMatch(/import\s+GymMembershipCard\s+from/);
  });

  it('Settings has a Gym tab carrying BOTH the card and the code box', () => {
    const src = codeAt('../../pages/Settings.jsx');
    expect(src).toMatch(/id:\s*(["'])gym\1/);
    expect(src).toMatch(/<GymMembershipCard\b/);
    expect(src).toMatch(/<JoinGymPanel\b/);
    // T3 ROUND 2, rule 4: the three above all live INSIDE `GymTab()`, so the
    // line that actually puts it on screen could be deleted and every one of
    // them still passed — the Gym tab renders empty and the suite stays green,
    // which is precisely the deletion failure L-1 was written to catch. This
    // is that line.
    expect(src).toMatch(/tab === (["'])gym\1\s*&&\s*<GymTab/);
  });

  it('Settings does NOT link into the gym console (:11616 stays shut)', () => {
    // Not a wiring assertion but its neighbour, and it belongs beside them: the
    // one thing this tab must never grow is a door into the console.
    const src = codeAt('../../pages/Settings.jsx');
    expect(src).not.toMatch(/to=(["'])\/console/);
  });
});

describe('the gym card on the dashboard', () => {
  it('says a person is waiting, and names the gym', async () => {
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);
    await waitFor(() =>
      expect(screen.getByText(/waiting for iron house to confirm you/i)).toBeTruthy(),
    );
    // …and does not park them: the copy says the rest of the app keeps working,
    // because a pending person keeps the whole free app.
    expect(screen.getByText(/everything in the app keeps working/i)).toBeTruthy();
  });

  it('says they are IN once the gym confirms them — the only place that fact appears', async () => {
    // The application disappears from `/applications/mine` the moment it is
    // confirmed. Without the membership read the card would simply vanish and
    // the person would never be told they were accepted.
    orgService.getMyApplications.mockReturnValue(ok({ applications: [] }));
    orgService.getMine.mockReturnValue(
      ok({ orgs: [{ ...ORG, staffRole: null, isMember: true, joinedAt: null }] }),
    );
    draw(<GymMembershipCard />);
    await waitFor(() => expect(screen.getByText(/you're a member of iron house/i)).toBeTruthy());
  });

  it('says so when the gym refused, and offers another go', async () => {
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, status: 'rejected', org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);
    await waitFor(() =>
      expect(screen.getByText(/iron house didn't confirm your request/i)).toBeTruthy(),
    );
    expect(screen.getByRole('link', { name: /try again/i }).getAttribute('href')).toBe('/org/join');
  });

  it('TELLS a removed member they were removed, in words that are TRUE (Kd 2026-08-20)', async () => {
    orgService.getMyApplications.mockReturnValue(ok({ applications: [] }));
    orgService.getMine.mockReturnValue(
      ok({ orgs: [], formerOrgs: [{ ...ORG, removedAt: '2026-08-20T04:41:16.656Z' }] }),
    );
    draw(<GymMembershipCard />);

    expect(
      await screen.findByText(/you're no longer a member of iron house/i),
    ).toBeTruthy();

    const text = document.body.textContent;
    // NOT a refusal. They were let in and then taken out, and reusing the
    // refusal wording would be a second lie in place of the first one — which
    // is the whole reason this arm exists rather than reusing `refused`.
    expect(text).not.toMatch(/didn't confirm/i);
    expect(text).not.toMatch(/refused/i);
    // No "Try again": re-applying to a gym that just removed you is not an
    // obvious next step, and the screen has no basis for suggesting it.
    expect(screen.queryByRole('link', { name: /try again/i })).toBeNull();
    // The promise that is actually TRUE and is the thing people fear losing.
    expect(text).toMatch(/still yours/i);
  });

  it('draws the member card from a payload carrying no formerOrgs key', async () => {
    // HONEST TITLE, T3 round 2 rule-4 finding. This USED to claim it tested
    // the deploy gap and it did not: `orgService` is mocked wholesale at the
    // top of this file, so `readThrough` and the shared schema never run and
    // deleting `.default([])` left it GREEN. **The real guard is in
    // `orgsApi.test.js`** ("ACCEPTS a /orgs/mine with no formerOrgs"), which
    // pushes the payload through the actual parser.
    //
    // What THIS one is still worth: the card must not require the key to
    // render the rest, which is `gymStatusRows`' tolerance measured through
    // the component rather than directly.
    orgService.getMyApplications.mockReturnValue(ok({ applications: [] }));
    orgService.getMine.mockReturnValue(ok({ orgs: [{ ...ORG, staffRole: null, isMember: true, joinedAt: null }] }));
    draw(<GymMembershipCard />);
    expect(await screen.findByText(/you're a member of iron house/i)).toBeTruthy();
  });

  it('DRAWS NOTHING when both reads fail — silence claims nothing', async () => {
    orgService.getMyApplications.mockReturnValue(Promise.reject(new Error('Network Error')));
    orgService.getMine.mockReturnValue(Promise.reject(new Error('Network Error')));
    const { container } = draw(<GymMembershipCard />);
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('keeps drawing what it DOES know when only one read fails', async () => {
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(Promise.reject(new Error('Network Error')));
    draw(<GymMembershipCard />);
    await waitFor(() => expect(screen.getByText(/waiting for iron house/i)).toBeTruthy());
  });

  it('draws nothing at all for somebody with no gym', async () => {
    orgService.getMyApplications.mockReturnValue(ok({ applications: [] }));
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    const { container } = draw(<GymMembershipCard />);
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  // ── the waiting room's clock, on the member's side (:11385, step 3) ──────
  //
  // The clock is PINNED in these, because a countdown asserted against the real
  // calendar is a test that changes its own expected value every day.

  it('says WHEN the request runs out, and that asking again is free', async () => {
    standAt(NOW);
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);

    // 20 Aug → 2 Sep is thirteen days. The number is the SERVER'S `expiresAt`
    // read through the same helper the gym's own queue uses, so the two screens
    // cannot quote different deadlines for one request.
    expect(await screen.findByText(/expires in 13 days/i)).toBeTruthy();
    // The reassurance that makes an expiry cost seconds rather than a place —
    // :11385 made re-applying free for exactly this reason.
    expect(screen.getByText(/enter the code again/i)).toBeTruthy();
  });

  it('sends the reminder and says the gym can SEE it — never that a message was sent', async () => {
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    orgService.nudgeApplication.mockReturnValue(
      ok({
        status: 'sent',
        nudgedAt: '2026-08-20T09:00:00.000Z',
        nextNudgeAt: '2026-08-21T09:00:00.000Z',
      }),
    );
    standAt(NOW);
    draw(<GymMembershipCard />);

    fireEvent.click(await screen.findByRole('button', { name: /remind them/i }));
    await waitFor(() => expect(screen.getByText(/still waiting/i)).toBeTruthy());
    // It addresses the APPLICATION, not the gym.
    expect(orgService.nudgeApplication).toHaveBeenCalledWith('app-1');
    // T3 r1 Low-2: the sentence reads the server's own `nextNudgeAt` rather
    // than the constant it used to print. Here they agree — 24 hours out is
    // "tomorrow" — and the test below is the one where they do NOT.
    expect(screen.getByText(/again tomorrow/i)).toBeTruthy();

    // THE PROMISE IT MUST NOT MAKE. There is no email and no push, so the
    // reminder arrives as a mark on the front desk's queue and nowhere else.
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/email/i);
    expect(text).not.toMatch(/notified|notification/i);
    expect(text).not.toMatch(/we've sent|message sent/i);
  });

  it('treats "already sent today" as a SUCCESS, not something to retry', async () => {
    // The gym has been told either way, which is what the person wanted to
    // know. Reporting it as a failure would send them to try again over
    // something that already worked.
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    orgService.nudgeApplication.mockReturnValue(
      ok({
        status: 'already_sent',
        // Yesterday at 13:00, so the next slot is 13:00 TODAY — four hours
        // from the pinned clock.
        nudgedAt: '2026-08-19T13:00:00.000Z',
        nextNudgeAt: '2026-08-20T13:00:00.000Z',
      }),
    );
    standAt(NOW);
    draw(<GymMembershipCard />);
    fireEvent.click(await screen.findByRole('button', { name: /remind them/i }));

    await waitFor(() => expect(screen.getByText(/still waiting/i)).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/couldn't|try again/i);
    // **THIS IS THE ASSERTION T3 r1 Low-2 IS ABOUT.** The screen used to print
    // "again tomorrow" from a constant while `nextNudgeAt` — the field added so
    // the client would never invent a time — went unread. On this arm the true
    // answer is LATER TODAY, and the old wording was simply wrong.
    expect(screen.getByText(/again later today/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/again tomorrow/i);
  });

  it('SAYS why the button is unavailable rather than greying it out in silence', async () => {
    standAt(NOW);
    orgService.getMyApplications.mockReturnValue(
      ok({
        applications: [
          // Reminded YESTERDAY at 13:00 — twenty hours ago, so still inside the
          // ratified day, and the next slot is 13:00 TODAY rather than
          // tomorrow. Chosen that way on purpose: it exercises the disabled
          // branch AND the case where "tomorrow" would have been wrong.
          { ...APPLICATION, nudgedAt: '2026-08-19T13:00:00.000Z', org: ORG },
        ],
      }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);

    // T3 r1 Low-1: this used to read "you reminded them TODAY", a claim about
    // the calendar the 24-hour rule does not make — a nudge at 23:00 Monday
    // seen at 09:00 Tuesday printed something simply false.
    expect(await screen.findByText(/reminded them in the last day/i)).toBeTruthy();
    // And the next slot comes off the SERVER's interval, not a constant:
    // 08:00 + 24 h against a 09:00 clock is later TODAY, never "tomorrow".
    expect(screen.getByText(/again later today/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /remind them/i }).disabled).toBe(true);
  });

  it('offers no reminder on a row with nothing to remind about', async () => {
    // A member and a removed person have no pending application, so the button
    // would address nothing at all.
    orgService.getMyApplications.mockReturnValue(ok({ applications: [] }));
    orgService.getMine.mockReturnValue(
      ok({ orgs: [{ ...ORG, staffRole: null, isMember: true, joinedAt: null }] }),
    );
    draw(<GymMembershipCard />);
    await screen.findByText(/you're a member of iron house/i);
    expect(screen.queryByRole('button', { name: /remind them/i })).toBeNull();
  });

  it('reports a failed reminder honestly, and keeps the button', async () => {
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    // **`mockImplementation`, NOT `mockReturnValue` — and the difference made
    // the whole suite exit non-zero while reporting 906/906 GREEN.**
    // `mockReturnValue(Promise.reject(…))` builds the rejected promise HERE, at
    // setup time, and nothing attaches a handler until the click several lines
    // below — so Node reports an unhandled rejection and vitest exits 1 with an
    // "Errors 1" line under a passing summary. The sibling fixtures get away
    // with `mockReturnValue` because the card consumes those on mount, in the
    // same tick. Built at CALL time, there is no gap.
    orgService.nudgeApplication.mockImplementation(() =>
      Promise.reject(new Error('Network Error')),
    );
    draw(<GymMembershipCard />);
    fireEvent.click(await screen.findByRole('button', { name: /remind them/i }));

    await waitFor(() => expect(screen.getByText(/couldn't reach the server/i)).toBeTruthy());
    // A dropped request reminded nobody, so the way back must stay on screen.
    expect(screen.getByRole('button', { name: /remind them/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/still waiting/i);
  });

  it('TELLS somebody their request ran out — the arm nothing could reach before this card', async () => {
    // `expired` has been in the contract since step 2 and no path in the
    // product could produce it: the column was stamped and never read. The
    // sweep is what makes this reachable, and the wording is deliberately NOT
    // the refusal's — nobody turned this person away.
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, status: 'expired', org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);

    expect(
      await screen.findByText(/your request to iron house expired before anyone confirmed it/i),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/didn't confirm/i);
    // Asking again is the whole point of a free re-apply.
    expect(screen.getByRole('link', { name: /try again/i }).getAttribute('href')).toBe('/org/join');
  });
});

// ── WAITING ON A GYM THAT HAS NO PLAN (Kd 2026-08-29, :24141 §1) ────────────
//
// Two sentences on the ordinary waiting card are FALSE in this state and both
// are :5807's class — on screen and wrong. "One tap at the front desk"
// describes a tap :23711's gate refuses with a 409, and the countdown counts
// toward a deadline the sweep no longer acts on now that the request is held.
describe('the gym card when the gym cannot take members', () => {
  const HELD = { ...APPLICATION, orgCanConfirm: false, org: ORG };

  it('says the request is being HELD, and stops promising a tap at the front desk', async () => {
    standAt(NOW);
    orgService.getMyApplications.mockReturnValue(ok({ applications: [HELD] }));
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);

    // The headline is unchanged — they ARE still waiting, and that is true.
    expect(await screen.findByText(/waiting for iron house to confirm you/i)).toBeTruthy();
    expect(screen.getByText(/can't take new members right now/i)).toBeTruthy();
    expect(screen.getByText(/being held/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/one tap at the front desk/i);
  });

  it('does NOT count down to a deadline that will not arrive', async () => {
    // The sibling test three describes up asserts "expires in 13 days" off this
    // very fixture and clock. Same date, same instant, held — and the sentence
    // must be gone, because the sweep will not act on it.
    standAt(NOW);
    orgService.getMyApplications.mockReturnValue(ok({ applications: [HELD] }));
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);

    await screen.findByText(/being held/i);
    expect(document.body.textContent).not.toMatch(/expires in/i);
    expect(document.body.textContent).not.toMatch(/enter the code again/i);
  });

  it('KEEPS "Remind them" — it is the one thing this person can still do', async () => {
    // Kd ruled the join door does NOT refuse a lapsed gym, having ruled the
    // opposite one message earlier and reversed himself: a refusal saves nobody
    // because nothing brings them back. The nudge is the same question about the
    // same dead end, so it gets the same answer — and it says nothing false, the
    // mark really does land on a queue the gym can still read.
    standAt(NOW);
    orgService.getMyApplications.mockReturnValue(ok({ applications: [HELD] }));
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);

    const button = await screen.findByRole('button', { name: /remind them/i });
    expect(button.disabled).toBe(false);
  });

  it('promises nothing about being let in later — nothing can un-lapse a gym yet', async () => {
    // The line the copy must not cross, and the reason it is a test rather than
    // a comment: a held request whose deadline has already passed still needs
    // the PAYMENT card to survive the first sweep after the gym subscribes
    // (`OWED.md`). Telling this person they will be confirmed when the gym is
    // back is a promise with no code behind it.
    standAt(NOW);
    orgService.getMyApplications.mockReturnValue(ok({ applications: [HELD] }));
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);

    await screen.findByText(/being held/i);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/when they|once they|we'll let you|will be confirmed|as soon as/i);
    // And it never explains WHY in terms of the gym's money. An applicant is not
    // staff of this gym; :23711 §2(a) ordered the server's own checks so that a
    // stranger cannot learn which gyms have stopped paying, and the sentence on
    // this card is inside the same boundary.
    expect(text).not.toMatch(/plan|subscription|paying|payment|billing|lapsed|expired/i);
  });

  it('is the ordinary card again on a gym that IS on a plan — the positive control', async () => {
    // The direction that matters more, and the one :7104's PG1 keeps naming: a
    // held sentence shown to somebody waiting on a healthy gym is the same
    // defect pointing the other way, and this fixture is the ordinary api
    // answer.
    standAt(NOW);
    orgService.getMyApplications.mockReturnValue(
      ok({ applications: [{ ...APPLICATION, orgCanConfirm: true, org: ORG }] }),
    );
    orgService.getMine.mockReturnValue(ok({ orgs: [] }));
    draw(<GymMembershipCard />);

    expect(await screen.findByText(/one tap at the front desk/i)).toBeTruthy();
    expect(screen.getByText(/expires in 13 days/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/being held/i);
  });
});
