// The console's Settings screen and its Staff section — what a gym owner SEES,
// and what the screen refuses to say.
//
// The helpers next door prove the rules; these prove the screen obeys them, and
// three things beyond that:
//   · the arms are DISTINGUISHABLE — a failed read must never be drawn as a gym
//     with no staff, which is this project's most repeated defect and is worse
//     here than anywhere, because a gym ALWAYS has its owner;
//   · Kd's removal ruling reaches the network in the right ORDER, and its
//     half-done state is reported rather than swallowed;
//   · the Settings tab exists for the owner and for nobody else.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getStaff: vi.fn(),
      addStaff: vi.fn(),
      updateStaffRole: vi.fn(),
      updateStaffPrivileges: vi.fn(),
      removeStaff: vi.fn(),
      removeMember: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
// One store, shared by the shell and the screen inside it and re-read on window
// focus — so it survives `cleanup()` and must be emptied between tests.
const { resetConsoleOrgs } = await import('./consoleOrgs');
const Settings = (await import('./Settings')).default;
const ConsoleLayout = (await import('../../components/console/ConsoleLayout')).default;
// Imported to be mounted DIRECTLY, which is the only way one of its guarantees
// can be observed at all — see the last describe in this file.
const StaffPanel = (await import('../../components/console/StaffPanel')).default;

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

const OWNER = {
  userId: 'u1',
  displayName: 'Kd Owner',
  email: 'kd@example.com',
  role: 'owner',
  since: '2026-08-18T09:00:00.000Z',
  isYou: true,
};

/** A manager carrying two fields the endpoint does not send. Distinctive values
 *  so a whole-document search cannot match them by accident — the staff row is
 *  allowed an EMAIL (§4.7 invites by one) and nothing beyond §2.4's boundary. */
const MANAGER = {
  userId: 'u2',
  displayName: 'Rita Sen',
  email: 'rita@example.com',
  role: 'manager',
  since: '2026-08-20T09:00:00.000Z',
  isYou: false,
  weightKg: 61.5,
  workouts30d: 9137,
};

const TRAINER = {
  userId: 'u3',
  displayName: 'Anil Bora',
  email: null,
  role: 'trainer',
  since: '2026-08-21T09:00:00.000Z',
  isYou: false,
};

const apiError = (status, error, message) => ({
  response: { status, data: { error, message, requestId: 'r' } },
});
const offline = () => Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

const drawSettings = () =>
  render(
    <MemoryRouter initialEntries={['/console/iron-house/settings']}>
      <Routes>
        <Route path="/console/:orgSlug/settings" element={<Settings />} />
      </Routes>
    </MemoryRouter>,
  );

const drawShell = (path = '/console/iron-house') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/console/:orgSlug" element={<ConsoleLayout><div>page</div></ConsoleLayout>} />
        <Route path="/console" element={<ConsoleLayout><div>page</div></ConsoleLayout>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetConsoleOrgs();
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER] } });
  orgService.addStaff.mockResolvedValue({ data: { staff: TRAINER } });
  orgService.updateStaffRole.mockResolvedValue({ data: { staff: MANAGER } });
  orgService.updateStaffPrivileges.mockResolvedValue({ data: { staff: MANAGER } });
  orgService.removeStaff.mockResolvedValue({ data: { status: 'removed' } });
  orgService.removeMember.mockResolvedValue({ data: { status: 'removed' } });
});

afterEach(() => {
  cleanup();
});

// ── The list ────────────────────────────────────────────────────────────────

describe('who runs this gym', () => {
  it('lists everybody with their role and when they got the keys', async () => {
    drawSettings();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    const row = screen.getByTestId('staff-u2');
    expect(within(row).getByText('Rita Sen')).toBeTruthy();
    expect(within(row).getByText(/Manager/)).toBeTruthy();
    expect(within(row).getByText(/rita@example\.com/)).toBeTruthy();
  });

  it('marks your own row from the SERVER’s answer, never from a name', async () => {
    // `isYou` is computed server-side against the caller. The console once
    // inferred "(you)" from a seat being complimentary, which was true only
    // while one caller happened to behave a certain way.
    drawSettings();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(within(screen.getByTestId('staff-u1')).getByText('(you)')).toBeTruthy();
    expect(within(screen.getByTestId('staff-u2')).queryByText('(you)')).toBeNull();
  });

  it('shows a staff row and NOTHING Part 3 §2.4 keeps from a gym', async () => {
    drawSettings();
    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    // The row is built field by field. This fails the moment somebody spreads
    // the person object onto it.
    expect(screen.queryByText(/61\.5/)).toBeNull();
    expect(screen.queryByText(/9137/)).toBeNull();
  });

  it('leaves the email out when there is none, rather than printing a dash for it', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, TRAINER] } });
    drawSettings();
    const row = await screen.findByTestId('staff-u3');
    expect(within(row).getByText(/Trainer/)).toBeTruthy();
    expect(within(row).queryByText(/—/)).toBeNull();
  });

  it('says how many people run the gym', async () => {
    drawSettings();
    expect(await screen.findByText('2 people run this gym')).toBeTruthy();
  });

  it('NEVER draws a failed read as a gym with no staff — it says what went wrong, with a way out', async () => {
    orgService.getStaff.mockRejectedValue(offline());
    drawSettings();
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
    // A gym always has an owner, so a staff list is never legitimately empty.
    expect(screen.queryByText(/run this gym$/)).toBeNull();
    // AND NO CONTROLS OVER A LIST THAT FAILED TO READ. Offering "add somebody"
    // beside an error invites an owner to act on a roster of keys the screen
    // could not fetch — they cannot see who is already on it, so they cannot
    // see that the person is there twice, or that the one they meant to remove
    // still is. The join-code panel took the same decision for the same reason.
    expect(screen.queryByText('Add someone')).toBeNull();
  });
});

// ── The owner's row ─────────────────────────────────────────────────────────

describe("the owner's own row", () => {
  it('carries the reason instead of controls the server would refuse', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u1');
    expect(within(row).getByText(/nobody in charge/i)).toBeTruthy();
    expect(within(row).queryByText('Remove')).toBeNull();
    expect(within(row).queryByText(/^Make /)).toBeNull();
  });
});

// ── Changing a role ─────────────────────────────────────────────────────────

describe('changing what somebody can do', () => {
  /** THE ROLE BUTTON NOW ASKS FIRST, so every test here taps it twice — the
   *  trigger, then the confirmation. **No assertion in this describe moved**;
   *  what changed is that the OWNER presses the button where the app used to act
   *  on the first tap (the :6008 precedent for a control gaining a question).
   *  The question itself is pinned in its own describe below. */
  const clickThroughRoleChange = (row) => {
    fireEvent.click(within(row).getByText('Make trainer'));
    fireEvent.click(within(row).getByText('Make trainer'));
  };

  it('offers the OTHER role and sends exactly that', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    clickThroughRoleChange(row);
    await waitFor(() => expect(orgService.updateStaffRole).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffRole).toHaveBeenCalledWith(ORG.id, 'u2', { role: 'trainer' });
  });

  it('re-reads the list from the server afterwards rather than editing its own copy', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    expect(orgService.getStaff).toHaveBeenCalledTimes(1);
    clickThroughRoleChange(row);
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
  });

  it("shows the server's own sentence when it refuses, and leaves the list alone", async () => {
    orgService.updateStaffRole.mockRejectedValue(
      apiError(409, 'owner_role_locked', 'The gym’s owner keeps the owner role.'),
    );
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    clickThroughRoleChange(row);
    expect(await screen.findByText(/owner keeps the owner role/i)).toBeTruthy();
    expect(screen.getByText('Rita Sen')).toBeTruthy();
  });

  /** THE QUESTION ITSELF (T3 round 1 Low-6, and the reason this control gained
   *  a stage at all). A role change RESETS the ticks to the new role's defaults,
   *  and before this the tap was immediate — so an owner who had hand-tuned
   *  somebody's boxes lost that work with nothing on screen saying so. */
  it('ASKS before changing a role, and does nothing on the first tap', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Make trainer'));
    expect(await within(row).findByText(/permissions become the defaults/i)).toBeTruthy();
    expect(orgService.updateStaffRole).not.toHaveBeenCalled();
  });

  /** THE WORDING IS THE FINDING AND IT IS ASSERTED AS A PROMISE, NOT AS WORDS.
   *  "Your changes will be lost" describes only half of what happens: the new
   *  role's defaults BECOME the set, so for somebody an owner had NARROWED the
   *  reset hands back MORE than they had. The banned phrasing is checked too,
   *  because it is the sentence a later edit will reach for. */
  it('says their permissions BECOME the new defaults, not that changes are lost', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Make trainer'));
    const question = await within(row).findByText(/permissions become the defaults for the new role/i);
    expect(question.textContent).not.toMatch(/will be lost|lose your changes/i);
  });

  it('CANCEL on that question changes nothing and puts the button back', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Make trainer'));
    fireEvent.click(within(row).getByText('Cancel'));
    expect(orgService.updateStaffRole).not.toHaveBeenCalled();
    expect(within(row).getByText('Make trainer')).toBeTruthy();
    expect(within(row).queryByText(/permissions become the defaults/i)).toBeNull();
  });
});

// ── Kd's removal ruling ─────────────────────────────────────────────────────

describe('taking somebody’s keys back', () => {
  it('asks first, and offers BOTH outcomes rather than picking one', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    expect(within(row).getByText(/Take Rita Sen's keys back\?/)).toBeTruthy();
    expect(within(row).getByText('Just take the keys')).toBeTruthy();
    expect(within(row).getByText('Remove from the gym too')).toBeTruthy();
    // Nothing has happened yet — the question is a question.
    expect(orgService.removeStaff).not.toHaveBeenCalled();
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('says what each choice costs, including the fear it has to answer', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    expect(within(row).getByText(/stay a member of your gym/i)).toBeTruthy();
    expect(within(row).getByText(/keep every workout they have done/i)).toBeTruthy();
  });

  /** KD'S FINDING FROM HIS OWN SMOKE (2026-08-22): picking an outcome used to DO
   *  it. He read the two options as a menu rather than a last chance — which is
   *  how the Members screen one tab away does NOT read, because it asks
   *  "Remove? / Keep". This is the test that would have caught the difference,
   *  and it did not exist: every test below simply clicked through. */
  it('does NOTHING until the last tap — picking an outcome only asks again', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Remove from the gym too'));
    expect(within(row).getByText(/Remove Rita Sen from your gym as well\?/)).toBeTruthy();
    expect(orgService.removeStaff).not.toHaveBeenCalled();
    expect(orgService.removeMember).not.toHaveBeenCalled();

    // CANCEL AT THE LAST TAP LEAVES EVERYTHING ALONE — half the value of a
    // confirmation is that it can be refused, and a confirm nothing can back out
    // of is a delay rather than a question.
    fireEvent.click(within(row).getByText('Cancel'));
    expect(within(row).getByText('Remove')).toBeTruthy();
    expect(orgService.removeStaff).not.toHaveBeenCalled();
  });

  /** THE OTHER ARM, ASSERTED FOR ITS OWN REASON (T3 Low). The test above drives
   *  only the destructive choice. Firing the gentle one immediately does go red
   *  elsewhere — but as a `getByText('Take the keys')` not-found inside a test
   *  titled "JUST THE KEYS ends the staff row", i.e. red for the wrong reason,
   *  which certifies the wrong assertion (:4718 F2). This one names the claim. */
  it('does NOTHING on the gentle arm either, until the last tap', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Just take the keys'));
    expect(within(row).getByText(/Take Rita Sen's keys back\? They stay a member/)).toBeTruthy();
    expect(orgService.removeStaff).not.toHaveBeenCalled();
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('JUST THE KEYS ends the staff row and leaves the membership alone', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Just take the keys'));
    fireEvent.click(within(row).getByText('Take the keys'));
    await waitFor(() => expect(orgService.removeStaff).toHaveBeenCalledWith(ORG.id, 'u2'));
    // The whole point of the two-button question: this arm must not touch it.
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('REMOVE FROM THE GYM TOO does both, keys FIRST — the server refuses the other order', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Remove from the gym too'));
    fireEvent.click(within(row).getByText('Remove them'));
    await waitFor(() => expect(orgService.removeMember).toHaveBeenCalledWith(ORG.id, 'u2'));
    expect(orgService.removeStaff).toHaveBeenCalledWith(ORG.id, 'u2');
    // ORDER IS THE ASSERTION. `removeMember` answers 409 `member_is_staff` for
    // anybody still holding a staff row, so keys-then-membership is the only
    // sequence that works. Swapped, the second call silently does nothing and
    // the person keeps the gym's features.
    expect(orgService.removeStaff.mock.invocationCallOrder[0]).toBeLessThan(
      orgService.removeMember.mock.invocationCallOrder[0],
    );
  });

  it('SAYS SO when the keys came back but the membership did not — it does not report a clean failure', async () => {
    orgService.removeMember.mockRejectedValue(offline());
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Remove from the gym too'));
    fireEvent.click(within(row).getByText('Remove them'));
    // Both halves of the true state, because the first one LANDED: an owner told
    // "that didn't work" would go and undo something that already happened, and
    // an owner told nothing would believe somebody is out of their gym who is
    // still in it.
    const notice = await screen.findByText(/no longer runs your gym, but they are still a member/i);
    expect(notice).toBeTruthy();
    expect(screen.getByText(/Members screen/i)).toBeTruthy();
  });

  it('reports a failed key removal without claiming anything about the membership', async () => {
    orgService.removeStaff.mockRejectedValue(offline());
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Remove from the gym too'));
    fireEvent.click(within(row).getByText('Remove them'));
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    // Nothing landed, so the second call must not be attempted.
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  /** T3 round 2 L-3. The whole `retryable` gate was observed by nothing — the
   *  reviewer reverted it to an unconditional `onRetry` and 35 tests stayed
   *  green, the half-done test included, because that test asserts the NOTICE
   *  and never that Try again is absent. Both arms are pinned here: the
   *  half-done removal (where `retry` re-reads the staff list and cannot finish
   *  the membership) and a permanent 403 (where pressing anything changes
   *  nothing). */
  it('offers NO Try again over a half-done removal — retrying cannot finish it', async () => {
    orgService.removeMember.mockRejectedValue(offline());
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Remove from the gym too'));
    fireEvent.click(within(row).getByText('Remove them'));
    await screen.findByText(/no longer runs your gym, but they are still a member/i);
    expect(screen.queryByText('Try again')).toBeNull();
    // The instruction that IS actionable stays.
    expect(screen.getByText(/Members screen/i)).toBeTruthy();
  });

  it('offers NO Try again over a permanent 403, and DOES over a dropped connection', async () => {
    orgService.updateStaffRole.mockRejectedValue(
      apiError(403, 'forbidden', "Your role doesn't allow that."),
    );
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Make trainer'));
    fireEvent.click(within(row).getByText('Make trainer'));
    await screen.findByText(/Your role doesn't allow that/i);
    expect(screen.queryByText('Try again')).toBeNull();

    // POSITIVE CONTROL, and it is the half that makes this a gate rather than a
    // ban: the identical failure offline must still offer the button.
    cleanup();
    vi.clearAllMocks();
    orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER] } });
    orgService.updateStaffRole.mockRejectedValue(offline());
    drawSettings();
    const row2 = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row2).getByText('Make trainer'));
    fireEvent.click(within(row2).getByText('Make trainer'));
    await screen.findByText(/Couldn't reach the server/i);
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  /** T3 C/H-2. The MIDDLE stage's Cancel was covered by nothing: the reviewer
   *  pointed it at `onRemove(true)` — Cancel ending somebody's membership — and
   *  all 195 console tests stayed green. The commit that added the third stage
   *  claimed "Cancel is honoured at every stage" and only the LAST stage's was
   *  tested; the claim was true of the code and untrue of the coverage.
   *
   *  Both exits are asserted, because a Cancel that fires nothing but also never
   *  puts the control back is its own defect — an owner stuck looking at a
   *  question they already dismissed. */
  it('CANCEL at the choosing stage fires nothing and restores the button', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    expect(within(row).getByText(/Take Rita Sen's keys back\?/)).toBeTruthy();

    fireEvent.click(within(row).getByText('Cancel'));
    expect(orgService.removeStaff).not.toHaveBeenCalled();
    expect(orgService.removeMember).not.toHaveBeenCalled();
    expect(within(row).getByText('Remove')).toBeTruthy();
    expect(within(row).queryByText('Just take the keys')).toBeNull();
  });
});

// ── Adding somebody ─────────────────────────────────────────────────────────

describe('adding somebody', () => {
  const openForm = async () => {
    drawSettings();
    fireEvent.click(await screen.findByText('Add someone'));
  };

  it('sends the typed email with the chosen role', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Their email address/i), {
      target: { value: 'anil@example.com' },
    });
    fireEvent.click(screen.getByText('Manager'));
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(orgService.addStaff).toHaveBeenCalledTimes(1));
    expect(orgService.addStaff).toHaveBeenCalledWith(ORG.id, {
      email: 'anil@example.com',
      role: 'manager',
    });
  });

  /** T3 C/H-1 AT THE SCREEN. The helper decides the wording; this proves the
   *  gym's TYPE actually reaches it. Without this, `orgType` could be dropped
   *  from `Settings.jsx`'s `<StaffPanel>` — or from the panel's own pass-through
   *  to the form — and every helper test would stay green while a studio owner
   *  read the gym sentence: S11's shape (a guarantee decided in one file and
   *  observed in none) in the fix written for a different finding. */
  it('tells a STUDIO owner their trainer cannot see the member list', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, orgType: 'studio' }] } });
    await openForm();
    expect(screen.getByText(/can't see your member list/i)).toBeTruthy();
    expect(screen.queryByText(/Can see your member list/i)).toBeNull();
  });

  it('tells a GYM owner their trainer CAN see it — the same control, the other answer', async () => {
    await openForm();
    expect(screen.getByText(/Can see your member list/i)).toBeTruthy();
  });

  /** T3 round 2 L-2 and L-4. Both length mirrors were observed by nothing — the
   *  reviewer neutered the lower one to `if (false)` and 35 tests stayed green.
   *  The claim is not "the form validates": it is that **what an owner reads is a
   *  sentence somebody wrote**, never the server's raw `email: too_small`, which
   *  is what `errorText` prints verbatim when the request is allowed to go. So
   *  each case asserts the written words AND that no request left the client. */
  it('refuses a too-SHORT entry in words, without asking the server', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Their email address/i), { target: { value: 'ab' } });
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByText(/too short for an email address/i)).toBeTruthy();
    expect(screen.queryByText(/too_small/)).toBeNull();
    expect(orgService.addStaff).not.toHaveBeenCalled();
  });

  it('refuses a too-LONG entry in words, without asking the server', async () => {
    await openForm();
    // 321 characters — one past the schema's `.max(320)`, the RFC maximum.
    const tooLong = `${'a'.repeat(310)}@example.com`;
    expect(tooLong.length).toBe(322);
    fireEvent.change(screen.getByLabelText(/Their email address/i), { target: { value: tooLong } });
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByText(/too long to be an email address/i)).toBeTruthy();
    expect(screen.queryByText(/too_big/)).toBeNull();
    expect(orgService.addStaff).not.toHaveBeenCalled();
  });

  /** The positive control for both: a length the server accepts must still be
   *  SENT. Without it, a client that refused everything would satisfy the two
   *  cases above — the shape S15 was caught by one round ago. */
  it('sends an ordinary-length address, so the guards are bounds and not a wall', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Their email address/i), {
      target: { value: 'rita@example.com' },
    });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(orgService.addStaff).toHaveBeenCalledTimes(1));
  });

  it('starts on the SMALLER grant, so a form nobody reads hands out less', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Their email address/i), {
      target: { value: 'anil@example.com' },
    });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(orgService.addStaff).toHaveBeenCalledTimes(1));
    expect(orgService.addStaff).toHaveBeenCalledWith(ORG.id, {
      email: 'anil@example.com',
      role: 'trainer',
    });
  });

  it('trims what was typed, so a trailing space is not a "nobody has that email"', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Their email address/i), {
      target: { value: '  anil@example.com  ' },
    });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(orgService.addStaff).toHaveBeenCalledTimes(1));
    expect(orgService.addStaff.mock.calls[0][1].email).toBe('anil@example.com');
  });

  it('asks for an email instead of sending an empty one', async () => {
    await openForm();
    fireEvent.click(screen.getByText('Add'));
    expect(await screen.findByText(/Type the email address/i)).toBeTruthy();
    expect(orgService.addStaff).not.toHaveBeenCalled();
  });

  it('warns BEFORE the refusal that they have to be a member already', async () => {
    // The server's 404 says the same thing, but only after an owner has typed an
    // address and been turned down. The gym-scoped lookup is deliberate (a
    // global one is an account-existence oracle), so this is a permanent rule
    // and belongs on the form.
    await openForm();
    expect(screen.getByText(/member of your gym already/i)).toBeTruthy();
  });

  it("keeps the form and the typing when the server refuses, and shows ITS sentence", async () => {
    orgService.addStaff.mockRejectedValue(
      apiError(
        404,
        'not_a_member',
        'Nobody in this gym has that email address. They need to join the gym first — send them your join code.',
      ),
    );
    await openForm();
    const box = screen.getByLabelText(/Their email address/i);
    fireEvent.change(box, { target: { value: 'ghost@example.com' } });
    fireEvent.click(screen.getByText('Add'));
    expect(await screen.findByText(/Nobody in this gym has that email address/i)).toBeTruthy();
    // Closing the form on a refusal throws away what they typed and hides the
    // reason with it — a recorded defect on the join-code editor.
    expect(screen.getByLabelText(/Their email address/i).value).toBe('ghost@example.com');
  });

  it('re-reads the list on success and closes the form', async () => {
    await openForm();
    fireEvent.change(screen.getByLabelText(/Their email address/i), {
      target: { value: 'anil@example.com' },
    });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByLabelText(/Their email address/i)).toBeNull());
  });
});

// ── Who gets in at all ──────────────────────────────────────────────────────

describe('a manager or trainer at this address', () => {
  it('is told, and the screen asks the server NOTHING about staff', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    drawSettings();
    expect(await screen.findByText(/Only the gym's owner can change these settings/i)).toBeTruthy();
    // Not merely tidy: the read is owner-gated too, so asking would 404 and the
    // panel would draw an error card at somebody who did nothing wrong.
    expect(orgService.getStaff).not.toHaveBeenCalled();
  });

  it('is never shown an empty staff list, which would read as a gym nobody runs', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'trainer' }] } });
    drawSettings();
    expect(await screen.findByText(/Only the gym's owner/i)).toBeTruthy();
    expect(screen.queryByText(/run this gym/)).toBeNull();
  });
});

describe('the Settings tab', () => {
  it('is drawn for the owner', async () => {
    drawShell();
    // Rail and phone bar both render it; one is CSS-hidden at any width.
    await waitFor(() => expect(screen.getAllByText('Settings').length).toBeGreaterThan(0));
  });

  it('is NOT drawn for a manager — it would open onto a refusal', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    drawShell();
    // Members always renders, so waiting on it proves the org resolved before
    // this assertion runs — otherwise "no Settings" would pass on an unfinished
    // read and the test could never fail.
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('asks the server nothing when there is no gym in the address', async () => {
    drawShell('/console');
    await waitFor(() => expect(screen.getByText('page')).toBeTruthy());
    expect(orgService.getMine).not.toHaveBeenCalled();
  });

  // ── and it follows the powers, without a reload ───────────────────────────
  //
  // The nav is drawn from the same kept answer the screens read, re-checked
  // when the window comes back to the front. Both directions are pinned,
  // because a fix that simply stopped drawing the tab would pass one of them.

  it('appears when the power arrives, on clicking back into the window', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Settings')).toBeNull();

    orgService.getMine.mockResolvedValue({
      data: {
        orgs: [
          {
            ...ORG,
            staffRole: 'manager',
            privileges: [...ROLE_PRIVILEGES.manager, 'staff.manage'],
          },
        ],
      },
    });
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(screen.getAllByText('Settings').length).toBeGreaterThan(0));
  });

  it('goes away when the power does, without a reload', async () => {
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Settings').length).toBeGreaterThan(0));

    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(screen.queryByText('Settings')).toBeNull());
    // The rest of the nav is untouched — this must take away one tab, not the
    // console.
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0);
  });
});

// ── The panel's OWN promise, which the screen above cannot test ─────────────
//
// ADDED BY THE MUTATION AUDIT, and the survival is the finding. Mutant S11
// deletes `!allowed` from the panel's own read guard, and every test above
// stayed GREEN — because `Settings.jsx` decides on `canManageStaff` BEFORE it
// mounts the panel, so for a manager the component never exists and its
// internal guard has no observable subject. The guarantee was carried entirely
// by a DIFFERENT guard one file up.
//
// The panel's guard is kept rather than deleted: it is a second door on an
// authority read, and its own comment makes a promise about what happens
// without it. What was missing was any way for that promise to fail, which is
// :5104 F5's shape — a guard whose protection cannot fail is the same gap with
// a comment on it. Mounting the component directly is the case that isolates
// it, exactly as :14401 closed O86.
describe('the Staff panel mounted on its own', () => {
  it('asks the server NOTHING about staff when the viewer is not the owner', async () => {
    render(<StaffPanel gymId={ORG.id} privileges={ROLE_PRIVILEGES.manager} />);
    // `render` wraps in `act`, so effects have already flushed here — this is a
    // measurement, not a race the assertion happens to win.
    expect(orgService.getStaff).not.toHaveBeenCalled();

    // THE POSITIVE CONTROL IS HALF THE TEST. Without it, a panel that had
    // stopped reading the list altogether would satisfy the assertion above,
    // and the audit would have swapped one unfalsifiable claim for another.
    cleanup();
    render(<StaffPanel gymId={ORG.id} privileges={ROLE_PRIVILEGES.owner} />);
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(1));
    expect(orgService.getStaff).toHaveBeenCalledWith(ORG.id);
  });

  /** S11'S SIBLING, found by the T3 reviewer in the fix written for S11: the
   *  RENDER guard beside the effect guard was equally unfalsifiable — delete
   *  `if (!allowed) return null` and every console test stayed green, because
   *  `Settings.jsx` never mounts the panel for a non-owner. Two guards, one
   *  file, and making the first observable left the second exactly as it was. */
  it('renders NOTHING for a non-owner, not an empty Staff card', async () => {
    // Plain DOM, not `toBeEmptyDOMElement`: this repo does not install
    // `jest-dom`, and an unknown matcher throws "Invalid Chai property" — which
    // reads as a failing assertion rather than as a missing one.
    const { container } = render(<StaffPanel gymId={ORG.id} privileges={ROLE_PRIVILEGES.trainer} />);
    expect(container.innerHTML).toBe('');

    // Positive control: the same mount for an owner DOES draw the card, so an
    // empty render everywhere would not satisfy this.
    cleanup();
    render(<StaffPanel gymId={ORG.id} privileges={ROLE_PRIVILEGES.owner} />);
    expect(await screen.findByText('Staff')).toBeTruthy();
  });
});

// ── The tick boxes ──────────────────────────────────────────────────────────
//
// Kd's ruling :11429 reaching a person for the first time. The server half has
// shipped and been reviewed twice; until this card an owner could not reach any
// of it. What these pin is the three ways a permissions screen lies: offering a
// box whose save is refused, drawing a set that is not the one the server holds,
// and losing something the owner never saw.

/** Deliberately NARROWER than the manager template, so a test that simply drew
 *  "what a manager gets" would fail rather than pass by coincidence. */
const MANAGER_TICKED = { ...MANAGER, privileges: ['members.read', 'codes.invite'] };

/** Draws Settings, waits for the row, and opens its permissions. The `getStaff`
 *  mock is set by each test BEFORE this runs, which is why the render happens
 *  here rather than in `beforeEach`. */
const openTicks = async (testId, label = 'What they can do') => {
  drawSettings();
  const row = await screen.findByTestId(testId);
  fireEvent.click(within(row).getByText(label));
  return row;
};

describe('what one person is allowed to do', () => {
  it('ticks exactly what the SERVER says, not what the role would give', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    expect(within(row).getByLabelText(/See the member list/i).checked).toBe(true);
    expect(within(row).getByLabelText(/Share the join code/i).checked).toBe(true);
    // In the manager TEMPLATE and not in this person's set — the difference is
    // the whole feature, and a screen reading the template would tick it.
    expect(within(row).getByLabelText(/Remove members/i).checked).toBe(false);
    expect(within(row).getByLabelText(/Let people into the gym/i).checked).toBe(false);
  });

  /** :15534 C/H-1 on screen. The server answers 409 `owner_only_privilege`, so
   *  a box here would be one whose every save fails — and the escalation it
   *  guards ended with the owner 403'd on their own member list. */
  it('does NOT offer "Manage staff" for a manager', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    expect(within(row).queryByLabelText(/Manage staff/i)).toBeNull();
    // Positive control: the boxes ARE drawn, so "no Manage staff" is not just an
    // unopened panel satisfying the assertion.
    expect(within(row).getByLabelText(/See the member list/i)).toBeTruthy();
  });

  it('sends the WHOLE set, including the boxes the owner never touched', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await waitFor(() => expect(orgService.updateStaffPrivileges).toHaveBeenCalledTimes(1));
    const body = orgService.updateStaffPrivileges.mock.calls[0][2];
    expect([...body.privileges].sort()).toEqual(
      ['codes.invite', 'members.read', 'members.remove'].sort(),
    );
  });

  it('sends it to the right gym and the right person', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await waitFor(() => expect(orgService.updateStaffPrivileges).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffPrivileges.mock.calls[0][0]).toBe(ORG.id);
    expect(orgService.updateStaffPrivileges.mock.calls[0][1]).toBe('u2');
  });

  it('sends an EMPTY set when every box is cleared, rather than refusing to', async () => {
    // Somebody who can do nothing is a real thing an owner may want, and it is
    // the server's business to refuse it if it is not. A screen that quietly
    // declines to send it leaves an owner tapping a dead button.
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/See the member list/i));
    fireEvent.click(within(row).getByLabelText(/Share the join code/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await waitFor(() => expect(orgService.updateStaffPrivileges).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffPrivileges.mock.calls[0][2]).toEqual({ privileges: [] });
  });

  it('asks the server NOTHING until something actually changes', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    expect(within(row).getByText('Save permissions').disabled).toBe(true);
    fireEvent.click(within(row).getByText('Save permissions'));
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    expect(within(row).getByText('Save permissions').disabled).toBe(false);
  });

  it('goes back to disabled if the owner un-does their own change', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    expect(within(row).getByText('Save permissions').disabled).toBe(true);
  });

  it('re-reads the list from the server after a save', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    expect(orgService.getStaff).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
  });

  it('CANCEL throws the edit away and asks the server nothing', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Cancel'));
    expect(orgService.updateStaffPrivileges).not.toHaveBeenCalled();
    // And re-opening shows the SERVER's set again, not the abandoned edit.
    fireEvent.click(within(row).getByText('What they can do'));
    expect(within(row).getByLabelText(/Remove members/i).checked).toBe(false);
  });
});

describe('when the server refuses a permission change', () => {
  /** The 409 the screen tries not to cause, handled anyway — R3.3 and :11429
   *  rule 4: hiding the box is NOT the enforcement, so the refusal has to be
   *  survivable however it arrives (a stale tab, a second owner, a direct call). */
  it('shows the SERVER’s own sentence rather than one of ours', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    orgService.updateStaffPrivileges.mockRejectedValue(
      apiError(
        409,
        'owner_only_privilege',
        'Managing staff stays with the gym owner. You can give this person any of the other permissions.',
      ),
    );
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    expect(await screen.findByText(/Managing staff stays with the gym owner/i)).toBeTruthy();
  });

  it('says something TRUE about the last owner, not "something went wrong"', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    orgService.updateStaffPrivileges.mockRejectedValue(
      apiError(
        409,
        'last_owner_locked',
        'A gym last owner has to keep the ability to manage staff, or nobody could ever hand it out again.',
      ),
    );
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    expect(
      await screen.findByText(/last owner has to keep the ability to manage staff/i),
    ).toBeTruthy();
  });

  it('KEEPS the boxes open with the edit still in them, so nothing is retyped', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    orgService.updateStaffPrivileges.mockRejectedValue(
      apiError(409, 'owner_only_privilege', 'Managing staff stays with the owner.'),
    );
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await screen.findByText(/Managing staff stays with the owner/i);
    expect(within(row).getByLabelText(/Remove members/i).checked).toBe(true);
    expect(within(row).getByText('Save permissions')).toBeTruthy();
  });

  it('offers NO Try again — re-reading the list cannot save anything', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    orgService.updateStaffPrivileges.mockRejectedValue(offline());
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await screen.findByText(/Couldn't reach the server/i);
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('closes the boxes when the save DOES land — the positive control for all of the above', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await waitFor(() => expect(within(row).queryByText('Save permissions')).toBeNull());
  });
});

describe('the owner’s own permissions', () => {
  it('are shown, and cannot be changed from this screen', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u1', 'What you can do');
    expect(within(row).getByLabelText(/Manage staff/i).checked).toBe(true);
    expect(within(row).getByLabelText(/Manage staff/i).disabled).toBe(true);
    expect(within(row).queryByText('Save permissions')).toBeNull();
    expect(within(row).getByText(/can't be changed here/i)).toBeTruthy();
  });

  /** It draws the STORED set, never a claim that the owner can do everything —
   *  which is one direct API call away from being false, and a screen must not
   *  print what it has not been told (:5807). */
  it('shows what the server actually holds, not "you can do everything"', async () => {
    orgService.getStaff.mockResolvedValue({
      data: {
        staff: [{ ...OWNER, privileges: ['members.read', 'staff.manage'] }, MANAGER_TICKED],
      },
    });
    const row = await openTicks('staff-u1', 'What you can do');
    expect(within(row).getByLabelText(/Manage staff/i).checked).toBe(true);
    expect(within(row).getByLabelText(/Remove members/i).checked).toBe(false);
  });

  /** T3 round 1 Low-2. "Read-only" and "yours" were ONE flag, keyed on the role,
   *  so a SECOND owner reading the first owner's row was told it was their own.
   *  `isYou` is the server's answer to that question and the row already carries
   *  it. Unreachable today — a gym has one owner — and `OWED.md` keeps the second
   *  owner live, which is what makes it worth pinning rather than shrugging at.
   *
   *  Both halves asserted: the wording moves to `isYou`, and editability stays
   *  on the ROLE. Without the second assertion this would pass just as happily
   *  against a build that let one owner edit another's ticks. */
  it('says "they" about ANOTHER owner, and still refuses to let anyone edit the row', async () => {
    const secondOwner = {
      userId: 'u4',
      displayName: 'Priya Owner',
      email: 'priya@example.com',
      role: 'owner',
      since: '2026-08-19T09:00:00.000Z',
      isYou: false,
    };
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, secondOwner] } });

    const row = await openTicks('staff-u4', 'What they can do');
    expect(within(row).getByText(/what the owner can do/i)).toBeTruthy();
    expect(within(row).queryByText(/what you can do/i)).toBeNull();
    // Still nobody's to change from here.
    expect(within(row).getByLabelText(/Manage staff/i).disabled).toBe(true);
    expect(within(row).queryByText('Save permissions')).toBeNull();
  });
});

/** T3 round 1 Low-3. The file's own comment said a manager row holding
 *  `staff.manage` "is therefore saved without it — silently narrowed", and it
 *  was not: the ticks came from the STORED set, so the box nobody was offered
 *  rode through into the save and the server answered 409 — every save on such a
 *  row failed, which is the opposite of silently narrowing. A leftover row like
 *  that can only predate the fix that made the state unreachable, and it is
 *  exactly the row an owner would be trying to tidy up. */
describe('a leftover row holding a tick it should never have had', () => {
  const legacyManager = {
    ...MANAGER,
    privileges: ['members.read', 'codes.invite', 'staff.manage'],
  };

  it('is not offered the box, and the save drops it instead of failing', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, legacyManager] } });
    orgService.updateStaffPrivileges.mockResolvedValue({
      data: { staff: { ...legacyManager, privileges: ['members.read'] } },
    });

    const row = await openTicks('staff-u2');
    // Not offered — that box is the owner's alone.
    expect(within(row).queryByLabelText(/Manage staff/i)).toBeNull();

    fireEvent.click(within(row).getByLabelText(/Share the join code/i));
    fireEvent.click(within(row).getByText('Save permissions'));

    await waitFor(() => expect(orgService.updateStaffPrivileges).toHaveBeenCalled());
    const sent = orgService.updateStaffPrivileges.mock.calls[0][2].privileges;
    // THE CLAIM: the tick this screen never showed is gone from the save, so the
    // save can succeed. Before the fix it was still in there and the server
    // refused the whole thing.
    expect(sent).not.toContain('staff.manage');
    // POSITIVE CONTROL — it dropped the forbidden one, not everything.
    expect(sent).toContain('members.read');
  });
});

describe('an older server that sends no permissions at all', () => {
  /** The window `orgStaffSchema.privileges` is optional FOR (:12660): the web
   *  and the api deploy separately. What must never happen is a row drawn with
   *  nothing ticked — that says a colleague can do nothing, which is false, and
   *  an owner "correcting" it would save the falsehood into the database. */
  it('shows what the ROLE gives, not an empty set', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER] } });
    const row = await openTicks('staff-u2');
    expect(within(row).getByLabelText(/See the member list/i).checked).toBe(true);
    expect(within(row).getByLabelText(/Remove members/i).checked).toBe(true);
    expect(within(row).getByLabelText(/Let people into the gym/i).checked).toBe(true);
  });
});

describe('a permission this screen is too old to show', () => {
  /** The save is the WHOLE set, so a tick this build has no words for would be
   *  stripped by an owner who never saw it — a real loss of access from a save
   *  they thought changed one thing. It travels through untouched, and the
   *  screen SAYS so rather than pretending it is not there. */
  const WITH_UNKNOWN = { ...MANAGER, privileges: ['members.read', 'billing.manage'] };

  it('is carried through the save unchanged', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, WITH_UNKNOWN] } });
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await waitFor(() => expect(orgService.updateStaffPrivileges).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffPrivileges.mock.calls[0][2].privileges).toContain('billing.manage');
  });

  it('is mentioned on screen, so Save is not a silent half-truth', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, WITH_UNKNOWN] } });
    const row = await openTicks('staff-u2');
    expect(within(row).getByText(/too old to show/i)).toBeTruthy();
  });

  it('says nothing when there is nothing to say — the control for the line above', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    expect(within(row).queryByText(/too old to show/i)).toBeNull();
  });
});
