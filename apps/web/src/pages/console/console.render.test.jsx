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
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      createOrg: vi.fn(),
      getMine: vi.fn(),
      getMembers: vi.fn(),
      getCodes: vi.fn(),
      getApplications: vi.fn(),
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
  useAuth: () => ({ user: { id: 'u1' } }),
}));

const { orgService } = await import('../../api/orgsApi');
const ConsoleHome = (await import('./ConsoleHome')).default;
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
  uses: 0,
};

const ownerSeat = {
  userId: 'u1',
  displayName: 'Kd Owner',
  joinedAt: '2026-08-18T09:00:00.000Z',
  groupLabel: 'Front Desk',
  complimentary: true,
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
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getCodes.mockResolvedValue({ data: { codes: [LIVE_CODE] } });
  orgService.getMembers.mockResolvedValue(page([ownerSeat]));
  // Nobody waiting, by default: every test that is not about the queue should
  // see the screen it saw before the queue existed.
  orgService.getApplications.mockResolvedValue(queue([]));
});

afterEach(() => cleanup());

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
    expect(await screen.findByText('K7QM2X')).toBeTruthy();
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
    expect(screen.getByText('K7QM2X')).toBeTruthy();
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

    expect(await screen.findByText('K7QM2X')).toBeTruthy();
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
    expect(await screen.findByText('NEWLIV')).toBeTruthy();
    expect(screen.queryByText('OLDPAU')).toBeNull();
  });

  it('still shows a gym its ONLY code when that code is dead (L-4 fallback)', async () => {
    orgService.getCodes.mockResolvedValue({
      data: { codes: [{ ...LIVE_CODE, code: 'DEADXX', paused: true }] },
    });
    drawOverview();
    // Shown, with its state — "this gym has no join code" would be false.
    expect(await screen.findByText('DEADXX')).toBeTruthy();
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
    // An empty roster below, so the only "Front Desk" on screen is the
    // applicant's own — the owner's seat carries the same label.
    orgService.getMembers.mockResolvedValue(page([]));
    drawMembers();

    expect(await screen.findByText('Anil Bora')).toBeTruthy();
    expect(screen.getByText(/Front Desk/)).toBeTruthy();

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
