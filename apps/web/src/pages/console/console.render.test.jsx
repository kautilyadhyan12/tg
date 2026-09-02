// The console's screens — what a gym owner actually SEES.
//
// The pure helpers next door prove the arithmetic; these prove the screens draw
// it, and — the part that matters most here — that the three arms of every
// screen are DISTINGUISHABLE. A failed read drawn as an empty one is this
// project's most repeated defect, and on this surface it reads "nobody has
// joined your gym" at an owner whose connection dropped.
//
// The other load-bearing test in this file is the §2.4 boundary: a member row
// is rendered from a fixture carrying fields the server never sends, and the
// assertion is that none of them reach the screen. It fails the moment somebody
// spreads the member object onto the row.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { WEEK_STARTS, overview } from './__fixtures__/overview';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      createOrg: vi.fn(),
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getCodes: vi.fn(),
      createCode: vi.fn(),
      updateCode: vi.fn(),
      rotateCode: vi.fn(),
      removeCode: vi.fn(),
      getApplications: vi.fn(),
      getOverview: vi.fn(),
      confirmApplication: vi.fn(),
      rejectApplication: vi.fn(),
      removeMember: vi.fn(),
    },
  };
});

// The Overview asks who is reading, since round 2's Low-3: "(you)" is a claim
// about the viewer and must not be inferred from the seat. `u1` is `ownerSeat`'s
// own id, so the default here IS the owner.
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
// The console's answer to "what may I do here?" is kept in ONE store shared by
// every screen and re-read on window focus, so it outlives a `cleanup()` the way
// it outlives a navigation. Emptied between tests, or each test would be reading
// the previous one's gym.
const { resetConsoleOrgs } = await import('./consoleOrgs');
const ConsoleHome = (await import('./ConsoleHome')).default;
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
const NewGym = (await import('./NewGym')).default;
const Overview = (await import('./Overview')).default;
const Members = (await import('./Members')).default;

// ── Fixtures ────────────────────────────────────────────────────────────────

const ORG = {
  id: '11111111-1111-1111-1111-111111111111',
  slug: 'iron-house',
  name: 'Iron House',
  city: 'Austin',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'owner',
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
};

const MEMBER_ONLY_ORG = { ...ORG, id: 'other', slug: 'their-gym', name: 'Their Gym', staffRole: null };

const LIVE_CODE = {
  code: 'K7QM2X',
  label: 'Front Desk',
  paused: false,
  expiresAt: null,
  maxUses: null,
  joined: 0,
};

const ownerSeat = {
  userId: 'u1',
  displayName: 'Kd Owner',
  joinedAt: '2026-08-18T09:00:00.000Z',
  groupLabel: 'Front Desk',
  complimentary: true,
  takesSeat: false,
};

/** A TRAINER who joined the gym like anybody else and was later handed the
 *  keys. `complimentary` is FALSE — they did join, and :14401 C/H-1 is why that
 *  flag must not be touched — while the gym is charged nothing for their place.
 *  Before :14953 this row was indistinguishable from a paying member. */
const staffMemberSeat = {
  userId: 'u4',
  displayName: 'Bhaskar Das',
  joinedAt: '2026-08-16T09:00:00.000Z',
  groupLabel: 'Front Desk',
  complimentary: false,
  takesSeat: false,
};

/** A joined member carrying FOUR fields the server does not send and Part 3
 *  §2.4 forbids a gym from ever seeing. Their values are distinctive so a
 *  whole-document text search cannot match them by accident. */
const joinedMemberWithForbiddenExtras = {
  userId: 'u2',
  displayName: 'Rita Sen',
  joinedAt: '2026-08-17T09:00:00.000Z',
  groupLabel: 'Morning Batch',
  complimentary: false,
  takesSeat: true,
  email: 'rita-private@example.com',
  weightKg: 61.5,
  workouts30d: 9137,
  avgFormScore: 87.3,
};

/** Somebody waiting at the door, carrying the same four fields the roster does
 *  and nothing more — §2.4 governs an applicant exactly as it governs a member.
 *  The extras here are values a gym must never see, spelled distinctively so a
 *  whole-document search cannot match them by accident. */
const waitingApplicant = {
  id: 'app-1',
  userId: 'u3',
  displayName: 'Anil Bora',
  appliedAt: '2026-08-19T09:00:00.000Z',
  expiresAt: '2026-09-02T09:00:00.000Z',
  groupLabel: 'Front Desk',
  // The waiting room's clock (:11385). Both null here, i.e. a fresh applicant
  // nobody has been chased about and who has not asked again — the ordinary
  // row. The tests that need either state set it explicitly.
  gymNotifiedAt: null,
  nudgedAt: null,
  email: 'anil-private@example.com',
  weightKg: 74.25,
};

const page = (items, nextCursor = null) => ({ data: { items, nextCursor } });
const queue = (items, pendingCount = items.length, nextCursor = null) => ({
  data: { items, nextCursor, pendingCount },
});
const apiError = (status, error, message) => ({
  response: { status, data: { error, message, requestId: 'r' } },
});
const offline = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

const drawHome = () =>
  render(
    <MemoryRouter initialEntries={['/console']}>
      <Routes>
        <Route path="/console" element={<ConsoleHome />} />
      </Routes>
    </MemoryRouter>,
  );

const drawNew = () =>
  render(
    <MemoryRouter initialEntries={['/console/new']}>
      <Routes>
        <Route path="/console/new" element={<NewGym />} />
      </Routes>
    </MemoryRouter>,
  );

const drawAt = (path, element, pattern) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
      </Routes>
    </MemoryRouter>,
  );

/** Pick a country in the wizard. Needed by every test that submits the form,
 *  because there is deliberately NO default (T3 C/H-1) — and the two tests that
 *  broke when that default was removed had been leaning on it, which is the
 *  clearest evidence the fix reaches real behaviour. */
const chooseCountry = async (name) => {
  fireEvent.click(screen.getByLabelText('Country'));
  fireEvent.click(await screen.findByText(name));
};

const drawOverview = () => drawAt('/console/iron-house', <Overview />, '/console/:orgSlug');
const drawMembers = () => drawAt('/console/iron-house/members', <Members />, '/console/:orgSlug/members');

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getCodes.mockResolvedValue({ data: { codes: [LIVE_CODE] } });
  orgService.getMembers.mockResolvedValue(page([ownerSeat]));
  // Nobody waiting, by default: every test that is not about the queue should
  // see the screen it saw before the queue existed.
  orgService.getApplications.mockResolvedValue(queue([]));
  // THE NUMBERS ARE QUIET BY DEFAULT, AND THAT IS THE TRUTHFUL DEFAULT FOR
  // THESE FIXTURES rather than a convenience. `ORG`'s only seat is `ownerSeat`,
  // which is `complimentary` — and `month.members` counts current
  // NON-complimentary members, so 0 is what the server would answer for this
  // gym — with no attendance anywhere. The zone therefore draws nothing at all
  // (§4.1's "0 members ever" edge), which is the screen every test in this file
  // was written against. The numbers' own tests set their own payloads.
  orgService.getOverview.mockResolvedValue(overview());
  // The three code-management calls resolve by default so a test about the
  // SCREEN does not fail on a mock that returns undefined. Each one that is
  // genuinely about a mutation sets its own.
  orgService.createCode.mockResolvedValue({ data: { code: LIVE_CODE } });
  orgService.updateCode.mockResolvedValue({ data: { code: LIVE_CODE } });
  orgService.rotateCode.mockResolvedValue({ data: { code: LIVE_CODE, replaced: LIVE_CODE } });
  orgService.removeCode.mockResolvedValue({ data: { removed: true } });
});

afterEach(() => {
  cleanup();
  // **RESTORED HERE AND NOT AT THE END OF EACH TEST BODY — T3 round 3, Low-4.**
  // Three tests in this file pin a clock, and each called `vi.useRealTimers()`
  // as its LAST statement — which a failing assertion never reaches. One red
  // test would then leave every later test in the file frozen at 2026-08-22: a
  // flake generator inside the fix for a flake. Unconditional teardown is the
  // only placement that survives a failure.
  //
  // **WHAT ROUND 4 CORRECTED, because the round-3 note overclaimed twice.** It
  // said "not at the end of each test body" while the three in-body calls were
  // still there — added, not moved; they are deleted now. And it cited
  // `1 failed | 52 passed` as proof, which the reviewer reproduced and then
  // reproduced AGAIN with this teardown removed: identical, because no later
  // test in this file is date-sensitive today. **The measurement was real and
  // proved nothing** (V1). This teardown is kept on its own merits — it is
  // insurance against the day a date-sensitive test is added below — and the
  // honest statement of its evidence is that there is none yet.
  vi.useRealTimers();
});

// ── Your gyms ───────────────────────────────────────────────────────────────

describe('Your gyms', () => {
  it('lists the gyms the caller staffs and hides the ones they only belong to', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [ORG, MEMBER_ONLY_ORG] } });
    drawHome();
    expect(await screen.findByText('Iron House')).toBeTruthy();
    // Every console read 404s for a plain member, so a row here would open onto
    // an error.
    expect(screen.queryByText('Their Gym')).toBeNull();
  });

  it('says you run no gym only when the server actually said so', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [] } });
    drawHome();
    expect(await screen.findByText(/don't run a gym yet/i)).toBeTruthy();
  });

  it('NEVER says that when the read failed — it says what went wrong, with a way out', async () => {
    orgService.getMine.mockRejectedValue(offline());
    drawHome();
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    // THE ASSERTION THIS TEST EXISTS FOR: the empty state is a claim about the
    // caller's gyms, and a failed read knows nothing about them.
    expect(screen.queryByText(/don't run a gym yet/i)).toBeNull();
  });

  it('retries the read when asked', async () => {
    orgService.getMine.mockRejectedValueOnce(offline()).mockResolvedValue({ data: { orgs: [ORG] } });
    drawHome();
    fireEvent.click(await screen.findByText('Try again'));
    expect(await screen.findByText('Iron House')).toBeTruthy();
  });
});

// ── Create a gym ────────────────────────────────────────────────────────────

describe('Create a gym', () => {
  it('offers only countries the server is open in', async () => {
    drawNew();
    fireEvent.click(screen.getByLabelText('Country'));
    // Read the OPTIONS, not the document: the trigger button also carries the
    // selected country's name, so a whole-page text search matches it twice and
    // would say nothing about what the list contains.
    const listbox = await screen.findByRole('listbox');
    const labels = [...listbox.querySelectorAll('[role="option"]')].map((o) => o.textContent);

    expect(labels).toContain('United States');
    expect(labels).toContain('India');
    expect(labels).toContain('Germany');
    expect(labels).toContain('United Kingdom');
    // A gym owner must never be able to pick a country and then be refused.
    expect(labels).not.toContain('Australia');
    expect(labels).not.toContain('Poland');
    expect(labels).not.toContain('Switzerland');
    // The whole supported set and nothing beyond it.
    expect(labels).toHaveLength(24);
  });

  it('offers gym and studio, and does not offer clinic', () => {
    drawNew();
    expect(screen.getByText('Gym')).toBeTruthy();
    expect(screen.getByText('Studio')).toBeTruthy();
    expect(screen.queryByText('Clinic')).toBeNull();
  });

  it('prefills the timezone with the device’s own zone', async () => {
    const { detectTimezone } = await import('./consoleView');
    drawNew();
    // T3 rule-4: this asserted only `/^Asia\//`, which `timezoneOptions` puts at
    // index 0 anyway — so a prefill that took `zones[0]` instead of the detected
    // zone would have passed. Pinned to the detected value EXACTLY.
    expect(screen.getByLabelText('Timezone').value).toBe(detectTimezone());
  });

  it('does NOT preselect a country — the currency is permanent and must be chosen', async () => {
    // T3 C/H-1's regression test. It used to default to 'US', so an owner in
    // India who typed a name and pressed Create got a gym billed in USD with no
    // screen anywhere to change it. Two assertions, because either alone is
    // satisfiable by the wrong fix: the control shows a PROMPT rather than a
    // country, and pressing Create with only a name sends NOTHING.
    drawNew();
    expect(screen.getByLabelText('Country').textContent).toContain('Choose a country');
    expect(screen.queryByText('United States')).toBeNull();

    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House' } });
    fireEvent.click(screen.getByText('Create gym'));
    await waitFor(() => expect(orgService.createOrg).not.toHaveBeenCalled());

    // And it submits once a country IS chosen — a fix that simply broke the
    // form would pass everything above.
    fireEvent.click(screen.getByLabelText('Country'));
    fireEvent.click(await screen.findByText('India'));
    orgService.createOrg.mockResolvedValue({
      data: { org: { ...ORG }, joinCode: { code: 'K7QM2X', label: 'Front Desk' } },
    });
    fireEvent.click(screen.getByText('Create gym'));
    await waitFor(() => expect(orgService.createOrg).toHaveBeenCalledTimes(1));
    expect(orgService.createOrg.mock.calls[0][0].country).toBe('IN');
  });

  it('shows the gym’s code and its currency once it exists', async () => {
    orgService.createOrg.mockResolvedValue({
      data: { org: { ...ORG }, joinCode: { code: 'K7QM2X', label: 'Front Desk' } },
    });
    drawNew();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House' } });
    await chooseCountry('United States');
    fireEvent.click(screen.getByText('Create gym'));

    expect(await screen.findByText('K7QM2X')).toBeTruthy();
    expect(screen.getByText(/set up in USD/)).toBeTruthy();
    expect(screen.getByText(/Give this code to your members/i)).toBeTruthy();
  });

  it("shows the server's own refusal rather than a rewrite of it", async () => {
    orgService.createOrg.mockRejectedValue(
      apiError(
        400,
        'country_unsupported',
        "We're not open in that country yet. Right now we support the United States, India, Canada, the UK and countries using the euro.",
      ),
    );
    drawNew();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Sydney Iron' } });
    await chooseCountry('India');
    fireEvent.click(screen.getByText('Create gym'));
    expect(await screen.findByText(/not open in that country yet/i)).toBeTruthy();
  });

  it('does not submit without a name', async () => {
    // T3 rule-4: this only ever exercised the button's `disabled` attribute —
    // deleting the `if (!canSubmit) return` guard left it GREEN (measured by the
    // reviewer). The guard is what holds when the form is submitted by any route
    // that is not a click on that button (Enter in a text field), so it is
    // submitted DIRECTLY here as well as clicked.
    drawNew();
    fireEvent.click(screen.getByText('Create gym'));
    expect(orgService.createOrg).not.toHaveBeenCalled();

    const form = screen.getByText('Create gym').closest('form');
    fireEvent.submit(form);
    await waitFor(() => expect(orgService.createOrg).not.toHaveBeenCalled());
  });
});

// ── The gym ─────────────────────────────────────────────────────────────────

describe('The gym', () => {
  it('shows the join code read back from the server, not remembered from creation', async () => {
    drawOverview();
    // Scoped to the HERO card: since the management panel landed the code also
    // appears in the list below, and an unscoped query would pass on either.
    expect(within(await screen.findByTestId('join-code-card')).getByText('K7QM2X')).toBeTruthy();
    expect(orgService.getCodes).toHaveBeenCalledWith(ORG.id);
    expect(screen.getByText(/Give this code to your members/i)).toBeTruthy();
  });

  it('says nobody has joined when only the owner’s own seat exists', async () => {
    drawOverview();
    // "1 member (you)" since T3 L-5 — the count and the "nobody has joined"
    // line were both true and read as a contradiction, so the count says whose
    // the one membership is rather than either number changing.
    expect(await screen.findByText('1 member (you)')).toBeTruthy();
    expect(screen.getByText(/Nobody has joined yet/i)).toBeTruthy();
  });

  it('drops that line the moment somebody has joined', async () => {
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawOverview();
    expect(await screen.findByText('2 members')).toBeTruthy();
    expect(screen.queryByText(/Nobody has joined yet/i)).toBeNull();
  });

  it('refuses to invite anyone with a code the server will turn away', async () => {
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, paused: true }] },
    });
    drawOverview();
    expect(await screen.findByText(/This code is paused/i)).toBeTruthy();
    // The invitation is WITHHELD, not reworded — telling an owner to share a
    // code the join path refuses is a promise that is not true.
    expect(screen.queryByText(/Give this code to your members/i)).toBeNull();
  });

  it('shows an error with a retry instead of a gym with no code', async () => {
    orgService.getCodes.mockRejectedValue(offline());
    drawOverview();
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText(/has no join code/i)).toBeNull();
  });

  it('says so plainly when the address is not a gym you run', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [MEMBER_ONLY_ORG] } });
    drawOverview();
    expect(await screen.findByText(/couldn't find a gym you run/i)).toBeTruthy();
  });

  it('offers no retry on a refusal that retrying can never fix (round 2 Low-4)', async () => {
    // The L-3 fix stopped one refused read taking the whole screen but left the
    // refused pane promising a retry. A trainer held off the roster is a
    // permanent 403 until group scoping is built; a button saying otherwise is
    // a small false thing on screen.
    orgService.getMembers.mockRejectedValue(
      apiError(403, 'trainer_scope_unavailable', "Trainer access to this list isn't available yet."),
    );
    drawOverview();
    expect(await screen.findByText(/Trainer access to this list isn't available yet/i)).toBeTruthy();
    expect(screen.queryAllByText('Try again')).toHaveLength(0);
    // The half that works is still there — this must not become "hide it all".
    expect(within(screen.getByTestId('join-code-card')).getByText('K7QM2X')).toBeTruthy();
  });

  it('shows ONE error, not two, when both reads fail the same way (round 2 Low-4)', async () => {
    // The ordinary offline case. Splitting the reads turned one error card into
    // two identical ones with two Try again buttons — both true, still a worse
    // screen than the one it replaced.
    orgService.getCodes.mockRejectedValue(offline());
    orgService.getMembers.mockRejectedValue(offline());
    drawOverview();
    await screen.findByText(/Couldn't reach the server/i);
    expect(screen.getAllByText(/Couldn't reach the server/i)).toHaveLength(1);
    expect(screen.getAllByText('Try again')).toHaveLength(1);
  });

  it('does not tell a manager that the owner’s seat is theirs (round 2 Low-3)', async () => {
    // Reachable the day a staff-invite route lands. Verified through the SCREEN
    // rather than only the helper, because the screen is what passes the viewer.
    vi.resetModules();
    vi.doMock('../../context/AuthContext', () => ({
      useAuth: () => ({ user: { id: 'a-manager-not-the-owner' } }),
    }));
    const AsManager = (await import('./Overview')).default;
    drawAt('/console/iron-house', <AsManager />, '/console/:orgSlug');

    expect(await screen.findByText('1 member')).toBeTruthy();
    expect(screen.queryByText('1 member (you)')).toBeNull();
    vi.doUnmock('../../context/AuthContext');
    vi.resetModules();
  });

  it('keeps the half that works when only ONE of the two reads is refused (L-3)', async () => {
    // §2.2 grants a trainer Invite while the roster is held back, and the API is
    // deliberately built that way (one trainer, 200 on codes, 403 on members).
    // Collapsed into one Promise.all, that trainer lost the whole screen.
    orgService.getMembers.mockRejectedValue(
      apiError(403, 'trainer_scope_unavailable', "Trainer access to this list isn't available yet."),
    );
    drawOverview();

    expect(within(await screen.findByTestId('join-code-card')).getByText('K7QM2X')).toBeTruthy();
    expect(screen.getByText(/Give this code to your members/i)).toBeTruthy();
    expect(screen.getByText(/Trainer access to this list isn't available yet/i)).toBeTruthy();
  });

  it('shows the first LIVE code, not merely the oldest one (L-4)', async () => {
    // Oldest-first ordering makes `codes[0]` right today and wrong the moment
    // rotate lands — a rotated gym would keep handing out the retired code.
    orgService.getCodes.mockResolvedValue({
      data: {
        codes: [
          { ...LIVE_CODE, code: 'OLDPAU', paused: true },
          { ...LIVE_CODE, code: 'NEWLIV' },
        ],
      },
    });
    drawOverview();
    // THE CLAIM IS ABOUT THE HERO CARD, and it had to be re-scoped rather than
    // weakened when the management panel landed: the panel lists EVERY code, so
    // the old "OLDPAU is nowhere on screen" is no longer true and no longer the
    // point. What still matters — and is what a rotated gym depends on — is
    // that the code offered under "give this to your members" is the LIVE one.
    const hero = within(await screen.findByTestId('join-code-card'));
    expect(hero.getByText('NEWLIV')).toBeTruthy();
    expect(hero.queryByText('OLDPAU')).toBeNull();
    // The retired code is still VISIBLE to its owner, in the list below, with
    // its state on it — hiding a code an owner turned off would be its own
    // defect.
    expect(screen.getByText('OLDPAU')).toBeTruthy();
  });

  it('still shows a gym its ONLY code when that code is dead (L-4 fallback)', async () => {
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, code: 'DEADXX', paused: true }] },
    });
    drawOverview();
    // Shown, with its state — "this gym has no join code" would be false.
    expect(within(await screen.findByTestId('join-code-card')).getByText('DEADXX')).toBeTruthy();
    expect(screen.getByText(/This code is paused/i)).toBeTruthy();
    expect(screen.queryByText(/has no join code/i)).toBeNull();
  });

  it('says whose the one membership is, so two true lines stop contradicting (L-5)', async () => {
    drawOverview();
    expect(await screen.findByText('1 member (you)')).toBeTruthy();
    expect(screen.getByText(/Nobody has joined yet/i)).toBeTruthy();
  });

  it('prints proper words, not the database’s own (L-6)', async () => {
    drawOverview();
    expect(await screen.findByText(/Austin · Gym/)).toBeTruthy();
    expect(screen.getByText('Owner')).toBeTruthy();
    expect(screen.queryByText('owner')).toBeNull();
  });

  it('puts the number waiting where an owner cannot miss it', async () => {
    // :11385 — "the gym is reminded… a count the owner cannot miss". This is
    // the screen they land on; a queue only visible after you go looking is not
    // a reminder. The figure is the server's exact count over the whole queue.
    orgService.getApplications.mockResolvedValue(queue([waitingApplicant], 4, 'app-1'));
    drawOverview();
    expect(await screen.findByText(/4 people waiting/i)).toBeTruthy();
    // …and it OUTRANKS the empty-roster nudge: telling a gym with four people
    // waiting to go and share its code again is the wrong next step by a mile.
    expect(screen.queryByText(/Nobody has joined yet/i)).toBeNull();
  });

  it('says nothing about waiting when the count cannot be read', async () => {
    // A trainer (403) or a blipped request. Absent is honest; "nobody is
    // waiting" would be a claim nothing supports, and the Members screen makes
    // its own case when they open it.
    orgService.getApplications.mockRejectedValue(
      apiError(403, 'forbidden', "Your role doesn't allow that."),
    );
    drawOverview();
    expect(await screen.findByText('1 member (you)')).toBeTruthy();
    expect(screen.queryByText(/people waiting/i)).toBeNull();
    expect(screen.queryByText(/person waiting/i)).toBeNull();
  });

  it('a reply this screen cannot read is a FAILURE, never "not your gym" (L-7)', async () => {
    // A 200 whose body is missing `orgs` used to become an empty list, then
    // `notFound`, then "we couldn't find a gym you run at this address" — a
    // confident false statement built out of a malformed success.
    const contract = Object.assign(new Error('bad shape'), { isContractError: true });
    orgService.getMine.mockRejectedValue(contract);
    drawOverview();
    expect(await screen.findByText(/couldn't read/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText(/couldn't find a gym you run/i)).toBeNull();
    // And it must not be reported as a network problem — the server answered.
    expect(screen.queryByText(/Check your connection/i)).toBeNull();
  });

  // ── MANAGING CODES ────────────────────────────────────────────────────────
  //
  // THESE ARE REACHABILITY TESTS FIRST. Round 1 of the join-door review found
  // that nothing asserted any of that card's components was reachable at all —
  // deleting the route left 857 tests green while the feature vanished. So each
  // of the three controls is driven THROUGH the Overview screen, not by
  // rendering the panel directly, and each asserts the call the server would
  // actually receive.

  it('offers the code controls on the screen an owner lands on', async () => {
    drawOverview();
    // `findAllByText` on purpose: the code is deliberately in TWO places — the
    // hero card to hand out, and the row below it to manage.
    expect(await screen.findAllByText('K7QM2X')).toHaveLength(2);
    expect(screen.getByText('Join codes')).toBeTruthy();
    expect(screen.getByText('Switch off')).toBeTruthy();
    expect(screen.getByText('New code')).toBeTruthy();
    expect(screen.getByText('Replace')).toBeTruthy();
  });

  it('switches a code off, sending ONLY the pause — not the limits it never showed', async () => {
    drawOverview();
    fireEvent.click(await screen.findByText('Switch off'));
    await waitFor(() => {
      expect(orgService.updateCode).toHaveBeenCalledWith(ORG.id, 'K7QM2X', { paused: true });
    });
    // THE ASSERTION WITH TEETH is the exact body: a patch carrying
    // `expiresAt: null` here would silently clear an end date the owner set on
    // another screen and was never shown on this control.
    expect(orgService.updateCode.mock.calls[0][2]).toEqual({ paused: true });
  });

  it('switches a paused code back ON — the control says what it will do', async () => {
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, paused: true }] },
    });
    drawOverview();
    // The button is "Switch on" and NOT "Switch off": a paused code offering
    // "Switch off" is the screen describing the opposite of what it does.
    fireEvent.click(await screen.findByText('Switch on'));
    await waitFor(() => {
      expect(orgService.updateCode).toHaveBeenCalledWith(ORG.id, 'K7QM2X', { paused: false });
    });
  });

  it('asks before replacing a code, and says who is affected', async () => {
    drawOverview();
    fireEvent.click(await screen.findByText('Replace'));
    // Nothing has happened yet — the first tap opens a question.
    expect(orgService.rotateCode).not.toHaveBeenCalled();
    // And the question states BOTH halves, because the second is the one an
    // owner is afraid of.
    expect(screen.getByText(/this one stops working/i)).toBeTruthy();
    expect(screen.getByText(/already joined stay members/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Keep it'));
    expect(orgService.rotateCode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Replace'));
    fireEvent.click(screen.getByText('Replace it'));
    await waitFor(() => {
      expect(orgService.rotateCode).toHaveBeenCalledWith(ORG.id, 'K7QM2X');
    });
  });

  // ── THE LIMITS EDITOR (T3 L-1: this control was reached by NO test, which a
  //    reviewer proved by deleting `expiresAt` from its save and watching 101
  //    tests stay green — C26's data-loss class on the other control) ────────

  it('sends BOTH fields from the Limits editor, so clearing the date clears it', async () => {
    orgService.getCodes.mockResolvedValue({
      data: {
        codes: [{ ...LIVE_CODE, expiresAt: '2099-12-31T18:29:59.000Z', maxUses: 5, joined: 1 }],
      },
    });
    drawOverview();
    fireEvent.click(await screen.findByText('Limits'));

    // Seeded from the row, not blank — a blank form would read as "no limits"
    // and become that on save.
    expect(screen.getByLabelText(/Maximum people/i).value).toBe('5');
    expect(screen.getByLabelText(/Stop working after/i).value).not.toBe('');

    fireEvent.click(screen.getByText('Clear the end date'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(orgService.updateCode).toHaveBeenCalled();
    });
    // BOTH keys. Dropping either one silently discards a restriction this
    // editor displayed — the exact defect the reviewer measured.
    expect(orgService.updateCode.mock.calls[0][2]).toEqual({ expiresAt: null, maxUses: 5 });
  });

  it('keeps the editor open and the typing when the server refuses (T3 L-7)', async () => {
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, maxUses: 5, joined: 3 }] },
    });
    orgService.updateCode.mockRejectedValue(
      apiError(409, 'max_uses_below_uses', '3 people are in through this code, so the limit can’t be lower than that.'),
    );
    drawOverview();
    fireEvent.click(await screen.findByText('Limits'));
    fireEvent.click(screen.getByLabelText('One fewer'));
    fireEvent.click(screen.getByText('Save'));

    expect(await screen.findByText(/3 people are in through this code/i)).toBeTruthy();
    // Still open, still holding what the owner set — closing on a refusal threw
    // the edit away and made them re-open the form to see what it had been.
    expect(screen.getByLabelText(/Maximum people/i).value).toBe('4');
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('does not resend an expired code’s old date the owner never touched (T3 L-10)', async () => {
    orgService.getCodes.mockResolvedValue({
      data: {
        codes: [{ ...LIVE_CODE, expiresAt: '2020-01-01T00:00:00.000Z', maxUses: null, joined: 0 }],
      },
    });
    drawOverview();
    fireEvent.click(await screen.findByText('Limits'));
    fireEvent.click(screen.getByLabelText('One more'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(orgService.updateCode).toHaveBeenCalled();
    });
    // The server refuses a past expiry, correctly. Sending one back untouched
    // would refuse the owner's LIMIT change over a date they never went near.
    expect(orgService.updateCode.mock.calls[0][2]).toEqual({ maxUses: 1 });
  });

  it('still sends a past date the owner DID choose, and lets the server refuse it', async () => {
    orgService.getCodes.mockResolvedValue({
      data: {
        codes: [{ ...LIVE_CODE, expiresAt: '2020-01-01T00:00:00.000Z', maxUses: null, joined: 0 }],
      },
    });
    drawOverview();
    fireEvent.click(await screen.findByText('Limits'));
    // A DIFFERENT past date — still past, but chosen. The exemption above is for
    // an untouched field only; widening it would swallow a real mistake.
    fireEvent.change(screen.getByLabelText(/Stop working after/i), {
      target: { value: '2020-02-02' },
    });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => {
      expect(orgService.updateCode).toHaveBeenCalled();
    });
    expect(orgService.updateCode.mock.calls[0][2].expiresAt).not.toBeUndefined();
  });

  it('offers Remove only on a code that cannot let anybody in', async () => {
    drawOverview();
    // A WORKING code has no Remove button — the server refuses that with a 409
    // and the console must not draw a control it knows will be refused (R3.3).
    await screen.findByText('Switch off');
    expect(screen.queryByText('Remove')).toBeNull();
  });

  it('asks before removing a code, and says what survives', async () => {
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, paused: true }] },
    });
    drawOverview();
    fireEvent.click(await screen.findByText('Remove'));
    // The first tap opens a question, like Replace — the row vanishing is not
    // undone by tapping again.
    expect(orgService.removeCode).not.toHaveBeenCalled();
    // And the question answers the fear: an owner tidying a list must not
    // wonder whether they have just deleted their members.
    expect(screen.getByText(/stays a member/i)).toBeTruthy();

    fireEvent.click(screen.getByText('Keep it'));
    expect(orgService.removeCode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Remove'));
    fireEvent.click(screen.getByText('Remove it'));
    await waitFor(() => {
      expect(orgService.removeCode).toHaveBeenCalledWith(ORG.id, 'K7QM2X');
    });
    // The list is re-read rather than patched locally — same rule as every
    // other change in this panel.
    await waitFor(() => {
      expect(orgService.getCodes).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the server’s own words when a removal is refused', async () => {
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, paused: true }] },
    });
    orgService.removeCode.mockRejectedValue(
      apiError(
        409,
        'code_still_usable',
        'This code still works, so it can’t be taken off the list. Switch it off first.',
      ),
    );
    drawOverview();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(screen.getByText('Remove it'));
    expect(await screen.findByText(/still works, so it can’t be taken off/i)).toBeTruthy();
  });

  it('makes a new code with no restrictions when neither box is filled', async () => {
    drawOverview();
    fireEvent.click(await screen.findByText('New code'));
    fireEvent.click(screen.getByText('Make the code'));
    await waitFor(() => {
      expect(orgService.createCode).toHaveBeenCalledWith(ORG.id, {
        expiresAt: null,
        maxUses: null,
      });
    });
  });

  it('sends the END of the chosen day, so a code works THROUGH that date', async () => {
    drawOverview();
    fireEvent.click(await screen.findByText('New code'));
    fireEvent.change(screen.getByLabelText(/Stop working after/i), {
      target: { value: '2026-12-31' },
    });
    fireEvent.click(screen.getByText('Make the code'));
    await waitFor(() => {
      expect(orgService.createCode).toHaveBeenCalled();
    });
    const sent = orgService.createCode.mock.calls[0][1].expiresAt;
    const at = new Date(sent);
    // Local parts, because that is the promise: the owner's own 31st, late in
    // the evening. A UTC-midnight implementation would kill it a day early.
    expect(at.getDate()).toBe(31);
    expect(at.getMonth()).toBe(11);
    expect(at.getHours()).toBe(23);
  });

  it('sets the limit with taps only — no hand typing (Kd, 2026-08-21)', async () => {
    drawOverview();
    fireEvent.click(await screen.findByText('New code'));
    const box = screen.getByLabelText(/Maximum people/i);
    // It starts at "no limit" and cannot be typed into: the browser will not
    // send keystrokes to a readonly field, which is what makes a fat-fingered
    // 500 impossible rather than merely unlikely.
    expect(box.value).toBe('');
    expect(box.readOnly).toBe(true);

    fireEvent.click(screen.getByLabelText('One more'));
    expect(box.value).toBe('1');
    fireEvent.click(screen.getByLabelText('One more'));
    expect(box.value).toBe('2');
    fireEvent.click(screen.getByLabelText('One fewer'));
    expect(box.value).toBe('1');
    // …and stepping below 1 is how the limit comes OFF again.
    fireEvent.click(screen.getByLabelText('One fewer'));
    expect(box.value).toBe('');

    fireEvent.click(screen.getByLabelText('One more'));
    fireEvent.click(screen.getByText('Make the code'));
    await waitFor(() => {
      expect(orgService.createCode).toHaveBeenCalled();
    });
    expect(orgService.createCode.mock.calls[0][1].maxUses).toBe(1);
  });

  it('swallows typing in the date box, which is how 19-07 became 19-09', async () => {
    drawOverview();
    fireEvent.click(await screen.findByText('New code'));
    const date = screen.getByLabelText(/Stop working after/i);
    // A native date input consumes digits SEGMENT BY SEGMENT in the browser's
    // own order, so typed digits can land in the wrong one and leave a valid
    // date nobody chose. Every digit is refused; Tab and Escape are not, or the
    // field becomes a keyboard trap.
    expect(fireEvent.keyDown(date, { key: '1' })).toBe(false);
    expect(fireEvent.keyDown(date, { key: '9' })).toBe(false);
    expect(fireEvent.keyDown(date, { key: 'Backspace' })).toBe(false);
    expect(fireEvent.keyDown(date, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(date, { key: 'Escape' })).toBe(true);
  });

  it('shows the server’s own words when a change is refused', async () => {
    orgService.updateCode.mockRejectedValue(
      apiError(
        409,
        'max_uses_below_uses',
        '2 people have already joined with this code, so the limit can’t be lower than that.',
      ),
    );
    drawOverview();
    fireEvent.click(await screen.findByText('Switch off'));
    // The SERVER's sentence, not a re-worded guess — the two drifting apart is
    // how a screen ends up explaining a refusal that did not happen.
    expect(await screen.findByText(/2 people have already joined/i)).toBeTruthy();
  });

  it('re-reads the codes after a change instead of editing its own copy', async () => {
    drawOverview();
    await screen.findAllByText('K7QM2X');
    expect(orgService.getCodes).toHaveBeenCalledTimes(1);
    // The server answers with a DIFFERENT state than the screen would have
    // guessed, which is the whole point: the list is the server's answer.
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, paused: true }] },
    });
    fireEvent.click(screen.getByText('Switch off'));
    expect(await screen.findByText('Switch on')).toBeTruthy();
    expect(orgService.getCodes).toHaveBeenCalledTimes(2);
    // …and the re-read does NOT drag the rest of the screen through a reload.
    expect(orgService.getMembers).toHaveBeenCalledTimes(1);
    expect(orgService.getApplications).toHaveBeenCalledTimes(1);
  });

  it('gives a TRAINER the code but none of the controls (§2.2’s two rows)', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer' }] } });
    drawOverview();
    // Invite is granted to all three roles, so the code itself stays.
    expect(await screen.findByText('K7QM2X')).toBeTruthy();
    // Management is owner+manager, and the server refuses a trainer with a 403.
    // Drawing these would offer a person a control they will be told off for.
    expect(screen.queryByText('Join codes')).toBeNull();
    expect(screen.queryByText('Switch off')).toBeNull();
    expect(screen.queryByText('New code')).toBeNull();
    expect(screen.queryByText('Replace')).toBeNull();
  });

  /** T3 ROUND 1 C/H-1, THE WIDENING HALF. The test above pins the DEFAULT
   *  trainer — no tick, no controls — and it stayed green while this was broken,
   *  because it asks what a trainer WITHOUT the power sees. Since the ticks card
   *  an owner can GIVE a trainer `codes.manage`; the server then allows every
   *  code route (`service.ts` gates them on the privilege, not the role), and
   *  this screen drew nothing, so the tick bought a power with no way to use it.
   *
   *  The pair is the point: same role, same screen, the TICK is the only
   *  difference. Without the pair, "show the controls" passes by showing them to
   *  everybody, which is the defect in the opposite direction (:11429 rule 4). */
  it('WIDENING: a TRAINER given `codes.manage` gets the code controls', async () => {
    orgService.getMine.mockResolvedValue({
      data: {
        orgs: [
          {
            ...ORG,
            staffRole: 'trainer',
            privileges: ['members.read', 'codes.invite', 'codes.manage'],
          },
        ],
      },
    });
    drawOverview();

    // SCOPED to the hero card, not relaxed to `getAllByText`. Once the panel
    // draws, the code is on screen TWICE by design (:13920 — one to hand out,
    // one to manage), and `getAllByText` would let the hero's own claim quietly
    // disappear. The duplication IS the fix working.
    expect(within(await screen.findByTestId('join-code-card')).getByText('K7QM2X')).toBeTruthy();
    expect(screen.getByText('New code')).toBeTruthy();
    expect(screen.getByText('Switch off')).toBeTruthy();
    expect(screen.getByText('Replace')).toBeTruthy();
  });

  it('NEGATIVE CONTROL: a TRAINER without `codes.manage` still gets none of them', async () => {
    orgService.getMine.mockResolvedValue({
      data: {
        orgs: [{ ...ORG, staffRole: 'trainer', privileges: ['members.read', 'codes.invite'] }],
      },
    });
    drawOverview();

    expect(await screen.findByText('K7QM2X')).toBeTruthy();
    expect(screen.queryByText('New code')).toBeNull();
    expect(screen.queryByText('Switch off')).toBeNull();
    expect(screen.queryByText('Replace')).toBeNull();
  });

  /** THE DEPLOY WINDOW (:12660's reason, and why `privileges` is optional here).
   *  An API too old to send the field must leave this screen exactly as it was
   *  before the ticks existed — the ROLE's own defaults — never "no powers",
   *  which would strip a real manager's controls the moment the web deployed
   *  first. */
  it('an org carrying NO privileges field falls back to the role, not to nothing', async () => {
    // Built by omission rather than by deleting a key, so the fixture cannot
    // drift into carrying `privileges: undefined`, which is a different input.
    const noField = { ...ORG, staffRole: 'manager' };
    expect('privileges' in noField).toBe(false);
    orgService.getMine.mockResolvedValue({ data: { orgs: [noField] } });
    drawOverview();

    expect(await screen.findByText('New code')).toBeTruthy();
  });

  it('says a code is switched off in words, not just with a chip', async () => {
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, paused: true }] },
    });
    drawOverview();
    expect(await screen.findByText(/until you switch it back on/i)).toBeTruthy();
  });

  it('draws no code controls over a list it could not read', async () => {
    orgService.getCodes.mockRejectedValue(offline());
    drawOverview();
    expect(await screen.findByText(/Check your connection/i)).toBeTruthy();
    // A "New code" button over an unread list would offer a second code to a
    // gym that may already be at its limit — and there is no code on screen for
    // the other controls to act on.
    expect(screen.queryByText('New code')).toBeNull();
    expect(screen.queryByText('Join codes')).toBeNull();
  });
});

// ── Members ─────────────────────────────────────────────────────────────────

describe('Members', () => {
  it('shows a member’s four facts AND NOTHING ELSE (Part 3 §2.4)', async () => {
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();

    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    expect(screen.getByText(/Morning Batch/)).toBeTruthy();
    expect(screen.getByText('Complimentary')).toBeTruthy(); // the owner's seat

    // The boundary itself. The fixture carries an email address, a body weight,
    // a workout count and a form score — none of which the endpoint returns and
    // none of which a gym may ever see. If a later edit renders the member
    // object rather than its four allowed fields, these appear.
    const text = document.body.textContent;
    expect(text).not.toContain('rita-private@example.com');
    expect(text).not.toContain('61.5');
    expect(text).not.toContain('9137');
    expect(text).not.toContain('87.3');
  });

  it('says nobody has joined only when the roster really is empty', async () => {
    orgService.getMembers.mockResolvedValue(page([]));
    drawMembers();
    expect(await screen.findByText(/Nobody has joined yet/i)).toBeTruthy();
  });

  it('NEVER says the roster is empty when the read failed', async () => {
    orgService.getMembers.mockRejectedValue(offline());
    drawMembers();
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    expect(screen.queryByText(/Nobody has joined yet/i)).toBeNull();
  });

  it("tells a held-back trainer what the server told it, not that the gym is empty", async () => {
    orgService.getMembers.mockRejectedValue(
      apiError(403, 'trainer_scope_unavailable', "Trainer access to this list isn't available yet."),
    );
    drawMembers();
    expect(await screen.findByText(/Trainer access to this list isn't available yet/i)).toBeTruthy();
    expect(screen.queryByText(/Nobody has joined yet/i)).toBeNull();
  });

  it('walks the next page and APPENDS it', async () => {
    orgService.getMembers
      .mockResolvedValueOnce(page([ownerSeat], '2026-08-18T09:00:00.000Z|u1'))
      .mockResolvedValueOnce(page([joinedMemberWithForbiddenExtras]));
    drawMembers();

    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    // Truncated, so the count is a bound rather than a number.
    expect(screen.getByText(/1\+ members/)).toBeTruthy();

    fireEvent.click(screen.getByText('Load more'));
    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    // The first page is still on screen — a second page replacing the first is
    // a cursor walk that loses rows.
    expect(screen.getByText('Kd Owner')).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/2 members/)).toBeTruthy());
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('keeps the rows already on screen when the NEXT page fails', async () => {
    orgService.getMembers
      .mockResolvedValueOnce(page([ownerSeat], '2026-08-18T09:00:00.000Z|u1'))
      .mockRejectedValueOnce(offline());
    drawMembers();

    fireEvent.click(await screen.findByText('Load more'));
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Kd Owner')).toBeTruthy();
  });
});

// ── Waiting to join ─────────────────────────────────────────────────────────

describe('Waiting to join', () => {
  it("shows an applicant's four facts AND NOTHING ELSE (Part 3 §2.4)", async () => {
    orgService.getApplications.mockResolvedValue(queue([waitingApplicant]));
    orgService.getMembers.mockResolvedValue(page([]));
    drawMembers();

    expect(await screen.findByText('Anil Bora')).toBeTruthy();
    // **THE CODE'S LABEL IS GONE FROM THIS ROW BY KD'S RULING (2026-08-21)** —
    // he asked during the clock smoke why every row said "Front Desk", and then
    // ruled names off join codes entirely, which settles it: every code now
    // carries the same default label, so the field cannot distinguish anything.
    // The assertion is INVERTED rather than deleted, because "§2.4's four facts
    // and nothing else" is still this test's subject and the allowed set just
    // got smaller by one.
    expect(screen.queryByText(/Front Desk/)).toBeNull();

    // §2.4 governs an applicant exactly as it governs a member — and a person
    // who is only WAITING is even less the gym's business. The fixture carries
    // an email and a body weight; rendering the object rather than its allowed
    // fields is what would put them here.
    const text = document.body.textContent;
    expect(text).not.toContain('anil-private@example.com');
    expect(text).not.toContain('74.25');
  });

  it('prints the SERVER’S exact count, never this page’s length', async () => {
    // A page of 3 out of 90 saying "3 people waiting" is a wrong number in
    // front of a gym owner. `pendingCount` counts the whole queue.
    orgService.getApplications.mockResolvedValue(
      queue([waitingApplicant], 90, 'app-1'),
    );
    drawMembers();
    expect(await screen.findByText(/90 people waiting/i)).toBeTruthy();
    expect(screen.queryByText(/1 person waiting/i)).toBeNull();
  });

  it('confirms somebody: the row goes, the count drops, and the ROSTER re-reads', async () => {
    orgService.getApplications
      .mockResolvedValueOnce(queue([waitingApplicant], 1))
      .mockResolvedValue(queue([]));
    orgService.confirmApplication.mockResolvedValue({
      data: { status: 'confirmed', membership: { id: 'm', joinedAt: '2026-08-19T10:00:00.000Z', groupLabel: 'Front Desk' } },
    });
    orgService.getMembers
      .mockResolvedValueOnce(page([ownerSeat]))
      .mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();

    fireEvent.click(await screen.findByText('Confirm'));
    await waitFor(() =>
      expect(orgService.confirmApplication).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'app-1'),
    );
    // THE HALF THAT MATTERS: the person is now a member, so they appear in the
    // list below rather than the owner having to reload to believe it.
    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Anil Bora')).toBeNull());
  });

  it('refuses somebody with one tap, and does not confirm them by accident', async () => {
    orgService.getApplications
      .mockResolvedValueOnce(queue([waitingApplicant], 1))
      .mockResolvedValue(queue([]));
    orgService.rejectApplication.mockResolvedValue({ data: { status: 'rejected' } });
    drawMembers();

    fireEvent.click(await screen.findByText('Not this person'));
    await waitFor(() => expect(orgService.rejectApplication).toHaveBeenCalled());
    expect(orgService.confirmApplication).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Anil Bora')).toBeNull());
    // …and the member list is NOT re-read: refusing somebody adds nobody to it,
    // so a reload would flash a loading state under a tap that changed nothing
    // there.
    expect(orgService.getMembers).toHaveBeenCalledTimes(1);
  });

  it('shows the server’s own words when a full gym refuses the confirm', async () => {
    // The message names the cap — a number this screen has no way to know,
    // since no route serves a seat count. Rewording it here would throw the
    // useful half away.
    orgService.getApplications.mockResolvedValue(queue([waitingApplicant], 1));
    orgService.confirmApplication.mockRejectedValue(
      apiError(
        409,
        'seat_cap_reached',
        'Your plan covers 3 members and they are all taken. Add a seat, then confirm again — this person is still waiting.',
      ),
    );
    drawMembers();

    fireEvent.click(await screen.findByText('Confirm'));
    expect(await screen.findByText(/Your plan covers 3 members/i)).toBeTruthy();
  });

  it('DRAWS NO SECTION for a trainer, who the server would refuse anyway', async () => {
    // §2.2 gives a trainer the roster and not the confirm. A console must not
    // offer a control the server will refuse — and the roster below is
    // untouched by that refusal.
    orgService.getApplications.mockRejectedValue(
      apiError(403, 'forbidden', "Your role doesn't allow that."),
    );
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();

    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    expect(screen.queryByText(/waiting to join/i)).toBeNull();
    expect(screen.queryByText(/Your role doesn't allow that/i)).toBeNull();
  });

  it('NEVER draws an empty queue over a failed read', async () => {
    // The shape this project ships most often, on the surface that decides
    // whether real members get in: "nobody is waiting" over a request that
    // never answered.
    orgService.getApplications.mockRejectedValue(offline());
    drawMembers();
    // Offline carries no status and no body, so the sentence is the one about
    // the CONNECTION rather than this screen's fallback — the point is that
    // SOMETHING is said and the section is not silently drawn as empty.
    expect(await screen.findByText(/couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    // …and it does not take the member list down with it.
    expect(screen.getByText('Kd Owner')).toBeTruthy();
  });

  it('says nothing at all when nobody is waiting', async () => {
    orgService.getApplications.mockResolvedValue(queue([]));
    drawMembers();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(screen.queryByText(/waiting to join/i)).toBeNull();
  });

  // ── the clock on the queue (:11385, step 3) ──────────────────────────────
  //
  // The clock is PINNED in these: a countdown asserted against the real
  // calendar changes its own expected value every day.

  it('says how long each person has waited and when their request runs out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // **PINNED AT 09:30, NOT 09:00 — T3 round 2, Low-3.** The WAITING figure is
    // a floored count of elapsed days, so a clock sitting EXACTLY on its
    // boundary flips as soon as it moves: `shouldAdvanceTime` lets real
    // milliseconds tick between `setSystemTime` and the render, and one
    // millisecond took "11 days" to "10 days". Measured — the full suite failed
    // 905/906 on one run of three and passed alone every time, which is the
    // shape of a boundary flake. Half an hour of slack changes nothing the test
    // is about.
    // **Only the waiting figure still needs that slack — round 5, Low-9.** Since
    // round 4 the countdown counts LOCAL CALENDAR days, whose boundary is local
    // midnight (18:30Z here), and 09:30Z is nowhere near it; the round-2 note
    // said "both figures" and that stopped being true when the countdown moved
    // to the calendar.
    vi.setSystemTime(new Date('2026-08-22T09:30:00.000Z'));
    orgService.getApplications.mockResolvedValue(queue([waitingApplicant]));
    orgService.getMembers.mockResolvedValue(page([]));
    drawMembers();

    // Asked 19 Aug 09:00Z, standing at 22 Aug 09:30Z, expiring 2 Sep 09:00Z.
    // **THE COUNTDOWN IS 11, NOT 10, AND THE CHANGE IS THE ROUND-4 FIX.** The
    // old reading floored elapsed milliseconds (10.98 days → "10"); the screen
    // now counts LOCAL CALENDAR days, and 22 Aug → 2 Sep is eleven of them. The
    // waiting figure stays 3 because it is a DURATION and duration still counts
    // elapsed time — the two halves of the same rule, visible in one row.
    expect(await screen.findByText(/waiting 3 days/i)).toBeTruthy();
    expect(screen.getByText(/expires in 11 days/i)).toBeTruthy();
  });

  it('marks a row NEEDS A DECISION off the server column, not off the dates', async () => {
    // `gymNotifiedAt` is the same fact the expiry statement consults before it
    // may delete anything. A mark computed here from the dates instead would be
    // a second opinion about whether the gym was warned — and the two would
    // disagree on exactly the rows where it matters.
    orgService.getApplications.mockResolvedValue(
      queue([{ ...waitingApplicant, gymNotifiedAt: '2026-08-21T03:30:00.000Z' }]),
    );
    orgService.getMembers.mockResolvedValue(page([]));
    drawMembers();
    expect(await screen.findByText(/needs a decision/i)).toBeTruthy();
  });

  it('does NOT mark a row the sweep has not flagged, however old it looks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Far past every threshold, and still unflagged — which is precisely the
    // state a stopped worker produces. The screen must report the column, not
    // guess from the age.
    vi.setSystemTime(new Date('2026-09-10T09:00:00.000Z'));
    orgService.getApplications.mockResolvedValue(queue([waitingApplicant]));
    orgService.getMembers.mockResolvedValue(page([]));
    drawMembers();

    expect(await screen.findByText('Anil Bora')).toBeTruthy();
    expect(screen.queryByText(/needs a decision/i)).toBeNull();
    // And past its date it reads "due to expire" rather than "expired": the
    // sweep runs nightly, so this row is still pending and still confirmable.
    expect(screen.getByText(/due to expire/i)).toBeTruthy();
  });

  it('shows that a member asked again — the only place a nudge ARRIVES', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-22T09:00:00.000Z'));
    orgService.getApplications.mockResolvedValue(
      queue([{ ...waitingApplicant, nudgedAt: '2026-08-22T07:00:00.000Z' }]),
    );
    orgService.getMembers.mockResolvedValue(page([]));
    drawMembers();

    expect(await screen.findByText(/they asked again 2 hours ago/i)).toBeTruthy();
    // Worded as what the PERSON did. There is no email and no push, so any
    // claim that a message was delivered would be false.
    expect(document.body.textContent).not.toMatch(/email|notification/i);
  });

  it('says nothing about a nudge nobody sent', async () => {
    orgService.getApplications.mockResolvedValue(queue([waitingApplicant]));
    orgService.getMembers.mockResolvedValue(page([]));
    drawMembers();
    expect(await screen.findByText('Anil Bora')).toBeTruthy();
    expect(screen.queryByText(/asked again/i)).toBeNull();
  });
});

// ── Removing a member ───────────────────────────────────────────────────────

describe('Removing a member', () => {
  it('asks before it removes, and Keep really keeps', async () => {
    // Part 3 §4.3 specifies a confirm sheet, and the button sits where a thumb
    // reaches for it on a phone.
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();

    fireEvent.click(await screen.findByText('Remove'));
    expect(screen.getByText(/Remove Rita Sen\?/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Keep'));
    expect(orgService.removeMember).not.toHaveBeenCalled();
    expect(screen.getByText('Rita Sen')).toBeTruthy();
  });

  it('removes on the second tap and re-reads the roster', async () => {
    orgService.getMembers
      .mockResolvedValueOnce(page([ownerSeat, joinedMemberWithForbiddenExtras]))
      .mockResolvedValue(page([ownerSeat]));
    orgService.removeMember.mockResolvedValue({ data: { status: 'removed' } });
    drawMembers();

    fireEvent.click(await screen.findByText('Remove'));
    // The second "Remove" is the one inside the question.
    fireEvent.click(screen.getAllByText('Remove')[0]);
    await waitFor(() =>
      expect(orgService.removeMember).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111', 'u2'),
    );
    await waitFor(() => expect(screen.queryByText('Rita Sen')).toBeNull());
    // `find`, not `get`: the roster re-read passes through its loading state,
    // so the row is legitimately off screen for a tick.
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
  });

  it('offers NO remove control beside the owner’s own complimentary seat', async () => {
    // The server refuses to remove staff, and the owner is member #1 of their
    // own gym — so the button would be a live refusal wearing a working button's
    // clothes.
    orgService.getMembers.mockResolvedValue(page([ownerSeat]));
    drawMembers();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  /** KD'S FINDING AT THE STAFF RE-SMOKE (:14953): *"when a member is added as a
   *  staff there badge should also show complimentary"*. He was right, and only
   *  about the SCREEN — the gym has been charged nothing for a staff member
   *  since :14401, but the badge read `complimentary`, which is deliberately
   *  never written for them, so a trainer looked exactly like somebody paying.
   *
   *  BOTH HALVES ARE ASSERTED. The badge alone would pass on a screen that
   *  badges everybody; the paying member in the same roster is the control. */
  it('badges a staff member’s place as free, and still bills the paying member (:14953)', async () => {
    orgService.getMembers.mockResolvedValue(
      page([ownerSeat, staffMemberSeat, joinedMemberWithForbiddenExtras]),
    );
    drawMembers();

    expect(await screen.findByText('Bhaskar Das')).toBeTruthy();
    // Two free places — the owner's and the trainer's — and NOT the third row.
    expect(screen.getAllByText('Complimentary')).toHaveLength(2);
    // The control: Rita pays, so she keeps her Remove button and no badge.
    expect(screen.getByText('Rita Sen')).toBeTruthy();
    expect(screen.getAllByText('Remove')).toHaveLength(1);
  });

  it('offers NO Remove beside a staff member, because the server refuses it', async () => {
    // `removeMember` refuses anybody who is still staff, so drawing the button
    // is drawing a live refusal. Ending their membership is the Staff screen's
    // own flow — keys first, then the membership.
    orgService.getMembers.mockResolvedValue(page([staffMemberSeat]));
    drawMembers();
    expect(await screen.findByText('Bhaskar Das')).toBeTruthy();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  /** THE EXPAND-THEN-CONTRACT WINDOW, and it is why the field is optional
   *  (:12660). An API older than this web build sends no `takesSeat` at all.
   *  `orgsApi` treats a contract mismatch as a hard failure, so a REQUIRED key
   *  would blank the whole roster to add one badge — and defaulting to "takes a
   *  seat" would strip the OWNER's badge and offer a Remove the server refuses.
   *  The fallback is the behaviour that shipped before this card, exactly. */
  it('falls back to the old flag when the server is too old to send the new one', async () => {
    const legacyOwner = { ...ownerSeat };
    delete legacyOwner.takesSeat;
    const legacyMember = { ...joinedMemberWithForbiddenExtras };
    delete legacyMember.takesSeat;
    orgService.getMembers.mockResolvedValue(page([legacyOwner, legacyMember]));
    drawMembers();

    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(screen.getAllByText('Complimentary')).toHaveLength(1);
    expect(screen.getAllByText('Remove')).toHaveLength(1);
  });

  it('hides Remove from a TRAINER, who may read the roster and may not remove (T3 r1 C/H-2)', async () => {
    // Part 3 §4.3's member table ends: "Trainer role: pre-filtered to their
    // group(s), Remove hidden." The screen consulted no role at all, so a
    // trainer got a working-looking button over a live 403 — the exact shape
    // J11 was rewritten to prevent one component above, on this same screen.
    //
    // The roster itself STAYS: a trainer of a gym is served the full member
    // list on purpose (:10010), so this must remove the control and nothing
    // else. Both halves are asserted, or "hide it" could pass by hiding the
    // screen.
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer' }] } });
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();

    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    expect(screen.getByText(/Morning Batch/)).toBeTruthy();
    expect(screen.queryByText('Remove')).toBeNull();
  });

  /** T3 ROUND 1 C/H-1, the roster half. `removeOrgMember` gates on
   *  `members.remove`, which an owner can now tick onto a trainer — and this
   *  screen asked the ROLE, so the tick reached no button anywhere. */
  it('WIDENING: a TRAINER given `members.remove` gets the Remove control', async () => {
    orgService.getMine.mockResolvedValue({
      data: {
        orgs: [
          {
            ...ORG,
            staffRole: 'trainer',
            privileges: ['members.read', 'codes.invite', 'members.remove'],
          },
        ],
      },
    });
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();

    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    expect(screen.getByText('Remove')).toBeTruthy();
  });

  it('still offers Remove to a MANAGER (the gate must not shut on the people §2.2 allows)', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();
    expect(await screen.findByText('Remove')).toBeTruthy();
  });

  it('keeps the person on screen when the server refuses, and says why', async () => {
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    orgService.removeMember.mockRejectedValue(
      apiError(
        409,
        'member_is_staff',
        "A staff member can't be removed from the member list. Staff membership is managed with staff.",
      ),
    );
    drawMembers();

    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(screen.getAllByText('Remove')[0]);
    expect(await screen.findByText(/A staff member can't be removed/i)).toBeTruthy();
    // Nothing changed, so nothing on the list may look as though it did.
    expect(screen.getByText('Rita Sen')).toBeTruthy();
  });
});

// ── Asking once, and asking again when the window comes back ────────────────
//
// The console's answer to "what may I do here?" used to be fetched by every
// screen as it opened and never again. Two things a person felt: an owner
// changing somebody's powers reached that person only after they pressed F5,
// and every screen asked the same question twice (the shell, then the screen).
//
// These are the SCREEN's half of that change. The store's own rules are next
// door in `consoleOrgs.test.js`; what is here is the part a person can see —
// and it is here because the layer above the screen could not see it: the
// retry loop this card shipped and fixed survived every store test and was
// caught by the first of these.

const drawShellAround = (element, path, pattern) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={<ConsoleLayout>{element}</ConsoleLayout>} />
      </Routes>
    </MemoryRouter>,
  );

/** The window came back to the front. Fired on `window` exactly as a browser
 *  fires it — no test-only entry point, so a mutant that unhooks the listener
 *  is caught here rather than reported as a passing guard. */
const clickBackIn = () => fireEvent(window, new Event('focus'));

describe('what may I do here', () => {
  it('is asked ONCE for the shell and the screen inside it', async () => {
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawShellAround(<Members />, '/console/iron-house/members', '/console/:orgSlug/members');

    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    // Both read the same answer. Before this card the shell asked for the nav
    // and the screen asked for the roster's Remove control — the same question,
    // twice, on every console page.
    expect(orgService.getMine).toHaveBeenCalledTimes(1);
  });

  it('is not asked again when the next screen opens', async () => {
    drawOverview();
    await screen.findAllByText('K7QM2X');
    cleanup();

    orgService.getMembers.mockResolvedValue(page([ownerSeat]));
    drawMembers();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(orgService.getMine).toHaveBeenCalledTimes(1);
  });

  it('NARROWING: a power taken away reaches a screen that is already open', async () => {
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();
    expect(await screen.findByText('Remove')).toBeTruthy();

    // Somebody at the next desk moves this person off manager. Before this card
    // the button stayed until they pressed F5 — the server refused the click,
    // so nothing was ever reachable, but the screen was telling them something
    // untrue.
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer' }] } });
    clickBackIn();

    await waitFor(() => expect(screen.queryByText('Remove')).toBeNull());
    // The roster itself is NOT dragged through a reload: only the answer about
    // what this person may do was re-read.
    expect(screen.getByText('Rita Sen')).toBeTruthy();
    expect(orgService.getMembers).toHaveBeenCalledTimes(1);
  });

  it('WIDENING: a power given reaches it too — the direction a smoke can only see with a reload', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer' }] } });
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();
    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    expect(screen.queryByText('Remove')).toBeNull();

    orgService.getMine.mockResolvedValue({
      data: {
        orgs: [
          { ...ORG, staffRole: 'trainer', privileges: ['members.read', 'members.remove'] },
        ],
      },
    });
    clickBackIn();

    expect(await screen.findByText('Remove')).toBeTruthy();
  });

  it('counts the TAB coming back to the front, which is a different event', async () => {
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();
    expect(await screen.findByText('Remove')).toBeTruthy();

    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer' }] } });
    fireEvent(document, new Event('visibilitychange'));

    await waitFor(() => expect(screen.queryByText('Remove')).toBeNull());
  });

  it('leaves a working screen ALONE when the re-check fails', async () => {
    orgService.getMembers.mockResolvedValue(page([ownerSeat, joinedMemberWithForbiddenExtras]));
    drawMembers();
    expect(await screen.findByText('Remove')).toBeTruthy();

    orgService.getMine.mockRejectedValue(offline());
    clickBackIn();
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalledTimes(2));

    // A check WE started, dropping ITS connection, must not take away what the
    // person is looking at — that would be this project's empty-vs-failed
    // defect, self-inflicted.
    expect(screen.getByText('Rita Sen')).toBeTruthy();
    expect(screen.getByText('Remove')).toBeTruthy();
    expect(screen.queryByText(/Couldn't reach the server/i)).toBeNull();
  });

  it('says so when the gym has left your list, rather than drawing a console for it', async () => {
    orgService.getMembers.mockResolvedValue(page([ownerSeat]));
    drawMembers();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();

    // Taken off this gym's staff entirely while the tab sat open.
    orgService.getMine.mockResolvedValue({ data: { orgs: [] } });
    clickBackIn();

    expect(await screen.findByText(/couldn't find a gym you run/i)).toBeTruthy();
  });
});

// ── A gym you have just made ────────────────────────────────────────────────
//
// T3 C/H-1, and the seam it came through is the reason these two tests exist at
// all. The kept answer is re-checked when the window comes back — so the card
// above reasoned that the only way INTO the console is the login page, and every
// entry is therefore a fresh page session. It never considered the console
// changing its OWN list from the inside, which is exactly what creating a gym
// does. Every other helper in this file mounts ONE route, so nothing had ever
// left the wizard for the gym it created: 1144 tests, a 72-mutant sweep and a
// 4/4 human smoke all passed over an owner being told their brand-new gym is not
// theirs.

const drawConsoleFrom = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/console" element={<ConsoleHome />} />
        <Route path="/console/new" element={<NewGym />} />
        <Route path="/console/:orgSlug" element={<Overview />} />
      </Routes>
    </MemoryRouter>,
  );

describe('a gym you have just made', () => {
  /** The wizard, from the front door to the code reveal. Started from
   *  `ConsoleHome` on purpose: the kept answer has to be READY, and know of no
   *  gyms, BEFORE the gym exists — a store that had never been read would simply
   *  read on the way in and hide the whole defect. */
  const createIronHouse = async () => {
    orgService.createOrg.mockResolvedValue({
      data: { org: { ...ORG }, joinCode: { code: 'K7QM2X', label: 'Front Desk' } },
    });
    fireEvent.click(screen.getByText('Create a gym'));
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House' } });
    await chooseCountry('United States');
    fireEvent.click(screen.getByText('Create gym'));
    expect(await screen.findByText('K7QM2X')).toBeTruthy();
  };

  it('opens when its owner presses "Go to your gym", instead of saying it is not theirs', async () => {
    orgService.getMine.mockResolvedValueOnce({ data: { orgs: [] } });
    drawConsoleFrom('/console');
    expect(await screen.findByText(/don't run a gym yet/i)).toBeTruthy();

    await createIronHouse();
    fireEvent.click(screen.getByText('Go to your gym'));

    // Scoped to the hero card: the code also appears in the panel below, and an
    // unscoped query would pass on either.
    expect(within(await screen.findByTestId('join-code-card')).getByText('K7QM2X')).toBeTruthy();
    expect(screen.queryByText(/couldn't find a gym you run/i)).toBeNull();
  });

  it('is listed under "Your gyms" without a reload', async () => {
    orgService.getMine.mockResolvedValueOnce({ data: { orgs: [] } });
    drawConsoleFrom('/console');
    expect(await screen.findByText(/don't run a gym yet/i)).toBeTruthy();

    await createIronHouse();
    // Back to the front door — `ConsoleLayout`'s "Your gyms" link, expressed the
    // way this file already expresses a navigation between console screens.
    cleanup();
    drawConsoleFrom('/console');

    expect(await screen.findByText('Iron House')).toBeTruthy();
    // The sentence a FIRST-TIME owner was reading, seconds after making their
    // first gym.
    expect(screen.queryByText(/don't run a gym yet/i)).toBeNull();
  });
});

// ── The gym's numbers ───────────────────────────────────────────────────────
//
// Part 3 §4.1's KPI row and 8-week chart, and Kd's :29961 ruling 1: they count
// VISITS and not workouts. The pure rules are proved in `overviewView.test.js`;
// these prove the SCREEN — that its four states are four different sentences,
// that a refusal costs the numbers and not the screen, and that every figure on
// it came off the wire.
describe("the gym's numbers", () => {
  // A gym with people in it, whose figures deliberately DISAGREE with anything a
  // screen could work out for itself — see the "computes nothing" case below.
  const busy = () =>
    overview({
      today: { visits: 9, visitors: 7 },
      week: { visits: 40, visitors: 22, prevVisits: 38, prevVisitors: 20 },
      month: { visitors: 12, members: 28, adoptionPct: 77 },
      weeks: [
        { weekStart: '2026-07-13', visits: 10, visitors: 6 },
        { weekStart: '2026-07-20', visits: 20, visitors: 11 },
        { weekStart: '2026-07-27', visits: 0, visitors: 0 },
        { weekStart: '2026-08-03', visits: 40, visitors: 18 },
        { weekStart: '2026-08-10', visits: 30, visitors: 15 },
        { weekStart: '2026-08-17', visits: 25, visitors: 14 },
        { weekStart: '2026-08-24', visits: 35, visitors: 17 },
        { weekStart: '2026-08-31', visits: 8, visitors: 7 },
      ],
    });

  it('draws the figures the server sent, and works none of them out itself', async () => {
    // THE FIXTURE IS DELIBERATELY ONE NO HONEST GYM PRODUCES — 12 of 28 is 43%,
    // and the server says 77%. :29250 §3's shape (a day whose totals say 300
    // while its page carries two): a screen that divided would print 43, and
    // the only way to pass is to render what arrived. Ruling 14's one
    // load-bearing requirement (:27992 §3), which the card names as the
    // difference between being right on six rows and wrong on four hundred.
    orgService.getOverview.mockResolvedValue(busy());
    drawOverview();

    expect(await screen.findByText('77%')).toBeTruthy();
    expect(screen.queryByText('43%')).toBeNull();
    expect(screen.getByText('12 of 28 members came in the last 30 days')).toBeTruthy();
    // Today and this week each say the second number only because somebody came
    // twice — and neither is derivable from the other.
    expect(screen.getByText('7 people · 9 visits')).toBeTruthy();
    expect(screen.getByText('22 people · 40 visits')).toBeTruthy();
  });

  it('says what the up arrow is comparing, because the two weeks are not the same length', async () => {
    // :5807 on its face if it did not: `week.visits` is this gym-week SO FAR and
    // `prevVisits` is the WHOLE of last week, so on a Tuesday a bare arrow
    // compares two days against seven and tells a healthy gym it is collapsing.
    orgService.getOverview.mockResolvedValue(busy());
    drawOverview();

    expect(await screen.findByText(/so far, against 38 visits in the whole of last week/)).toBeTruthy();
  });

  it('draws a bar for every week including the empty ones, and says which one is unfinished', async () => {
    orgService.getOverview.mockResolvedValue(busy());
    drawOverview();

    // The `<title>` is what a hover and a screen reader get, and it carries the
    // whole bar — so it is also what pins the figures to their week.
    expect(await screen.findByText('Week of 13 Jul: 10 visits, 6 people')).toBeTruthy();
    // The quiet week draws a zero bar rather than vanishing and shifting every
    // other bar left.
    expect(screen.getByText('Week of 27 Jul: 0 visits, 0 people')).toBeTruthy();
    // THE LAST COLUMN IS SHORT BECAUSE THE WEEK IS NOT OVER. A chart whose final
    // bar is always the runt teaches an owner to read a collapse that is not
    // there — the same defect as the bare arrow, one panel down.
    expect(screen.getByText('This week so far: 8 visits, 7 people')).toBeTruthy();
    expect(screen.queryByText(/Week of 31 Aug/)).toBeNull();
  });

  it('says it is still collecting while there is nothing to compare this week against', async () => {
    orgService.getOverview.mockResolvedValue(
      overview({
        today: { visits: 4, visitors: 4 },
        week: { visits: 14, visitors: 9, prevVisits: 0, prevVisitors: 0 },
        month: { visitors: 9, members: 20, adoptionPct: 45 },
        weeks: [
          ...WEEK_STARTS.slice(0, 7).map((weekStart) => ({ weekStart, visits: 0, visitors: 0 })),
          { weekStart: '2026-08-31', visits: 14, visitors: 9 },
        ],
      }),
    );
    drawOverview();

    expect(await screen.findByText(/first week of attendance/)).toBeTruthy();
    // And no arrow over a week there is nothing to compare against.
    expect(screen.getByText('Nothing was recorded last week.')).toBeTruthy();
  });

  it('tells a gym with members and no visits that nobody has come — not that they had none', async () => {
    // :8267/:8343's class. "We have no data" and "the answer is zero" are
    // different sentences, and the window is NAMED because this payload cannot
    // answer "has anybody ever come".
    orgService.getOverview.mockResolvedValue(
      overview({ month: { visitors: 0, members: 12, adoptionPct: 0 } }),
    );
    drawOverview();

    expect(await screen.findByText('Nobody has marked attendance in the last 8 weeks.')).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
    expect(screen.queryByText('0 people')).toBeNull();
  });

  it('points a gym whose button is off at the switch instead', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, manualAttendanceEnabled: false }] },
    });
    orgService.getOverview.mockResolvedValue(
      overview({ month: { visitors: 0, members: 12, adoptionPct: 0 } }),
    );
    drawOverview();

    expect(await screen.findByText(/the switch is off in Settings/)).toBeTruthy();
    expect(screen.queryByText(/Nobody has marked attendance/)).toBeNull();
  });

  it('draws no numbers at all for a gym nobody has joined — the join code is the screen', async () => {
    // §4.1's own edge: "org with 0 members ever → Overview IS the checklist +
    // poster CTA (no sad empty charts)".
    drawOverview(); // the default payload: no members, nothing recorded

    expect(within(await screen.findByTestId('join-code-card')).getByText('K7QM2X')).toBeTruthy();
    expect(screen.queryByText(/turning up/i)).toBeNull();
    expect(screen.queryByText(/Nobody has marked attendance/)).toBeNull();
  });

  it('offers a Try again when the numbers fail on their own, and never draws zeros over a failed read', async () => {
    orgService.getOverview.mockRejectedValue(apiError(500, 'server_error', 'Something went wrong.'));
    drawOverview();

    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    // The rest of the screen is untouched — the numbers are one pane, not the
    // page.
    expect(within(screen.getByTestId('join-code-card')).getByText('K7QM2X')).toBeTruthy();
    expect(screen.queryByText(/turning up/i)).toBeNull();
  });

  it('takes the numbers away from a trainer their gym refused, and leaves them the screen', async () => {
    // The read is gated on `attendance.read` — default-on for all three roles
    // and one an owner may UNTICK (:28107 §2), so this 403 is reachable by a
    // real person. `isRetryable` says a 403 is permanent, so no Try again is
    // offered for a button that cannot work; §4b: they lose the NUMBERS, not
    // the screen.
    orgService.getOverview.mockRejectedValue(
      apiError(403, 'forbidden', "You can't see this gym's attendance."),
    );
    drawOverview();

    expect(within(await screen.findByTestId('join-code-card')).getByText('K7QM2X')).toBeTruthy();
    expect(screen.queryByText(/turning up/i)).toBeNull();
    expect(screen.queryByText("You can't see this gym's attendance.")).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('does not stack a second identical error card when the connection drops', async () => {
    // ROUND 2's Low-4, one pane later: when everything fails the same way, the
    // fix for two identical error cards was never to give the third and fourth
    // one each.
    orgService.getCodes.mockRejectedValue(offline());
    orgService.getMembers.mockRejectedValue(offline());
    orgService.getOverview.mockRejectedValue(offline());
    drawOverview();

    // The sentence offline actually produces — `errorText`'s own branch for a
    // request that never reached the server, which is the whole point: all
    // three panes fail with the SAME words, so a screen that drew one card each
    // would say it three times.
    const cards = await screen.findAllByText(/Couldn't reach the server/i);
    expect(cards).toHaveLength(1);
    expect(screen.getAllByText('Try again')).toHaveLength(1);
  });
});
