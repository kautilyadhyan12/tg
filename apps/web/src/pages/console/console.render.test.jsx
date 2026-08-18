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
    },
  };
});

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

const page = (items, nextCursor = null) => ({ data: { items, nextCursor } });
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

const drawOverview = () => drawAt('/console/iron-house', <Overview />, '/console/:orgSlug');
const drawMembers = () => drawAt('/console/iron-house/members', <Members />, '/console/:orgSlug/members');

beforeEach(() => {
  vi.clearAllMocks();
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getCodes.mockResolvedValue({ data: { codes: [LIVE_CODE] } });
  orgService.getMembers.mockResolvedValue(page([ownerSeat]));
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

  it('prefills the timezone with the device’s own zone', () => {
    drawNew();
    // The suite pins TZ=Asia/Kolkata; whichever alias this runtime reports must
    // be the selected value, not the first zone in the list.
    expect(screen.getByLabelText('Timezone').value).toMatch(/^Asia\//);
  });

  it('shows the gym’s code and its currency once it exists', async () => {
    orgService.createOrg.mockResolvedValue({
      data: { org: { ...ORG }, joinCode: { code: 'K7QM2X', label: 'Front Desk' } },
    });
    drawNew();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House' } });
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
    fireEvent.click(screen.getByText('Create gym'));
    expect(await screen.findByText(/not open in that country yet/i)).toBeTruthy();
  });

  it('does not submit without a name', () => {
    drawNew();
    fireEvent.click(screen.getByText('Create gym'));
    expect(orgService.createOrg).not.toHaveBeenCalled();
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
    expect(await screen.findByText('1 member')).toBeTruthy();
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
