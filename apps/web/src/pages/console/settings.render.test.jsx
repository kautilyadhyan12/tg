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

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      getStaff: vi.fn(),
      addStaff: vi.fn(),
      updateStaffRole: vi.fn(),
      removeStaff: vi.fn(),
      removeMember: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
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
  orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
  orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER] } });
  orgService.addStaff.mockResolvedValue({ data: { staff: TRAINER } });
  orgService.updateStaffRole.mockResolvedValue({ data: { staff: MANAGER } });
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
  it('offers the OTHER role and sends exactly that', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Make trainer'));
    await waitFor(() => expect(orgService.updateStaffRole).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffRole).toHaveBeenCalledWith(ORG.id, 'u2', { role: 'trainer' });
  });

  it('re-reads the list from the server afterwards rather than editing its own copy', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    expect(orgService.getStaff).toHaveBeenCalledTimes(1);
    fireEvent.click(within(row).getByText('Make trainer'));
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
  });

  it("shows the server's own sentence when it refuses, and leaves the list alone", async () => {
    orgService.updateStaffRole.mockRejectedValue(
      apiError(409, 'owner_role_locked', 'The gym’s owner keeps the owner role.'),
    );
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Make trainer'));
    expect(await screen.findByText(/owner keeps the owner role/i)).toBeTruthy();
    expect(screen.getByText('Rita Sen')).toBeTruthy();
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

  it('JUST THE KEYS ends the staff row and leaves the membership alone', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Just take the keys'));
    await waitFor(() => expect(orgService.removeStaff).toHaveBeenCalledWith(ORG.id, 'u2'));
    // The whole point of the two-button question: this arm must not touch it.
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('REMOVE FROM THE GYM TOO does both, keys FIRST — the server refuses the other order', async () => {
    drawSettings();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Remove from the gym too'));
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
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    // Nothing landed, so the second call must not be attempted.
    expect(orgService.removeMember).not.toHaveBeenCalled();
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
    render(<StaffPanel gymId={ORG.id} staffRole="manager" />);
    // `render` wraps in `act`, so effects have already flushed here — this is a
    // measurement, not a race the assertion happens to win.
    expect(orgService.getStaff).not.toHaveBeenCalled();

    // THE POSITIVE CONTROL IS HALF THE TEST. Without it, a panel that had
    // stopped reading the list altogether would satisfy the assertion above,
    // and the audit would have swapped one unfalsifiable claim for another.
    cleanup();
    render(<StaffPanel gymId={ORG.id} staffRole="owner" />);
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(1));
    expect(orgService.getStaff).toHaveBeenCalledWith(ORG.id);
  });
});
