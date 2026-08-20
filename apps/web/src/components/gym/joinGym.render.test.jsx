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
});
afterEach(cleanup);

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
  });

  it('PROMISES NOTHING THE APP CANNOT DO: no email, no expiry, no countdown', async () => {
    // Email does not exist — `EmailSender` logs an event name and sends
    // nothing. Nothing expires either: every application carries a 14-day date
    // and no code reads it yet. Both would be reassuring and both would be
    // false, which is the class this project treats as Critical.
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
  const stripComments = (raw) =>
    raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
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
});
