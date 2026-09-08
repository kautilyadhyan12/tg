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
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      updateOrg: vi.fn(),
      getStaff: vi.fn(),
      addStaff: vi.fn(),
      updateStaffRole: vi.fn(),
      updateStaffPrivileges: vi.fn(),
      removeStaff: vi.fn(),
      removeMember: vi.fn(),
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

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: vi.fn() }),
}));

const { orgService } = await import('../../api/orgsApi');
// One store, shared by the shell and the screen inside it and re-read on window
// focus — so it survives `cleanup()` and must be emptied between tests.
const { resetConsoleOrgs } = await import('./consoleOrgs');
// THE SENTENCE ITSELF, never a copy of its words. :19960's rule — an assertion
// typed out by hand goes green against a screen that says something else the
// day the constant is reworded.
const { READ_ONLY_NOTE } = await import('./billingView');
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
  // `country` arrived with migration `0014`; `myOrgSchema` defaults it to null,
  // so every row the console holds carries the key one way or the other.
  country: 'US',
  orgType: 'gym',
  timezone: 'America/Chicago',
  locale: 'en',
  currencyDisplay: 'USD',
  status: 'active',
  staffRole: 'owner',
  isMember: true,
  joinedAt: '2026-08-18T09:00:00.000Z',
  // `myOrgSchema` declares this with `.default(true)`, so — exactly like
  // `country` above — every row the console holds carries the key whether the
  // api sent it or not. Stated in the fixture rather than left to a coercion in
  // the panel, which would be a second spelling of one default (T3 round 1,
  // L-5).
  manualAttendanceEnabled: true,
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

/** SETTINGS' SECTIONS ARE CLOSED UNTIL SOMEBODY TAPS THEM (Kd, 2026-08-26).
 *
 *  Every test below that reads INSIDE a section now opens it first, the way a
 *  person does — **no assertion moved**, only the tap that used to be
 *  unnecessary (:6008's precedent for a control gaining a question, and the
 *  account of the change is in the entry rather than left for a reader to
 *  notice).
 *
 *  **Collapsing UNMOUNTS rather than hiding with CSS, and that is why this
 *  churn was accepted instead of avoided.** A `display:none` body would have
 *  left 32 call sites passing against content no person can see — a suite
 *  claiming a user sees something the screen does not show, which is the class
 *  this project has recorded most. The cheaper option was the dishonest one.
 *
 *  The heading's accessible name is title + summary + aside, so the anchor is
 *  the START of it. */
const openSection = async (title) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${title}`) }));
};

/** THE BODY OF ONE SECTION, so an assertion about a panel cannot be satisfied by
 *  a different panel on the same screen.
 *
 *  **ROUND 1 WROTE A FALSE REASON HERE AND ROUND 2 CORRECTED IT.** It said C/H-1
 *  survived because Settings *"mounts five panels"* sharing one sentence, so a
 *  screen-wide `getAllByText(READ_ONLY_NOTE).length > 0` was green for all of
 *  them. **Both halves were wrong.** Settings mounts FOUR panels (`Settings.jsx`
 *  :127, :150, :175, :203 — the count this file's own sibling case asserts), and
 *  a closed `ConsoleSection` is UNMOUNTED, so a case that opens one section had
 *  only that section's body to search. **The real reason is that no test opened
 *  the attendance section with a note assertion in it** — a missing case, not a
 *  blind instrument. Kept and corrected rather than deleted: a wrong diagnosis
 *  left standing is how the next chat inherits a false premise.
 *
 *  Scoping is still right, for the reason above this line rather than that one:
 *  `ConsoleSection` publishes the handle — the heading button points at its own
 *  body with `aria-controls` — so there is no need to guess at a class name. */
const sectionBody = async (title) => {
  const heading = await screen.findByRole('button', { name: new RegExp(`^${title}`) });
  const bodyId = heading.getAttribute('aria-controls');
  // A shut section has no body and deliberately no `aria-controls` (:24141's
  // sibling fix — an attribute promising a screen reader an element that does
  // not exist). Reaching here with null means the section was never opened,
  // and saying so beats an unhelpful `getElementById(null)`.
  expect(bodyId).toBeTruthy();
  const body = document.getElementById(bodyId);
  expect(body).toBeTruthy();
  return within(body);
};

const drawStaff = async () => {
  drawSettings();
  await openSection('Staff');
};

const drawGym = async () => {
  drawSettings();
  await openSection('Gym details');
};

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
  orgService.updateOrg.mockResolvedValue({ data: { org: ORG } });
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
    await drawStaff();
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
    await drawStaff();
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
    expect(within(screen.getByTestId('staff-u1')).getByText('(you)')).toBeTruthy();
    expect(within(screen.getByTestId('staff-u2')).queryByText('(you)')).toBeNull();
  });

  it('shows a staff row and NOTHING Part 3 §2.4 keeps from a gym', async () => {
    await drawStaff();
    expect(await screen.findByText('Rita Sen')).toBeTruthy();
    // The row is built field by field. This fails the moment somebody spreads
    // the person object onto it.
    expect(screen.queryByText(/61\.5/)).toBeNull();
    expect(screen.queryByText(/9137/)).toBeNull();
  });

  it('leaves the email out when there is none, rather than printing a dash for it', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, TRAINER] } });
    await drawStaff();
    const row = await screen.findByTestId('staff-u3');
    expect(within(row).getByText(/Trainer/)).toBeTruthy();
    expect(within(row).queryByText(/—/)).toBeNull();
  });

  it('says how many people run the gym', async () => {
    await drawStaff();
    expect(await screen.findByText('2 people run this gym')).toBeTruthy();
  });

  it('NEVER draws a failed read as a gym with no staff — it says what went wrong, with a way out', async () => {
    orgService.getStaff.mockRejectedValue(offline());
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
    const row = await screen.findByTestId('staff-u2');
    clickThroughRoleChange(row);
    await waitFor(() => expect(orgService.updateStaffRole).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffRole).toHaveBeenCalledWith(ORG.id, 'u2', { role: 'trainer' });
  });

  it('re-reads the list from the server afterwards rather than editing its own copy', async () => {
    await drawStaff();
    const row = await screen.findByTestId('staff-u2');
    expect(orgService.getStaff).toHaveBeenCalledTimes(1);
    clickThroughRoleChange(row);
    await waitFor(() => expect(orgService.getStaff).toHaveBeenCalledTimes(2));
  });

  it("shows the server's own sentence when it refuses, and leaves the list alone", async () => {
    orgService.updateStaffRole.mockRejectedValue(
      apiError(409, 'owner_role_locked', 'The gym’s owner keeps the owner role.'),
    );
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Make trainer'));
    const question = await within(row).findByText(/permissions become the defaults for the new role/i);
    expect(question.textContent).not.toMatch(/will be lost|lose your changes/i);
  });

  it('CANCEL on that question changes nothing and puts the button back', async () => {
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Just take the keys'));
    expect(within(row).getByText(/Take Rita Sen's keys back\? They stay a member/)).toBeTruthy();
    expect(orgService.removeStaff).not.toHaveBeenCalled();
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('JUST THE KEYS ends the staff row and leaves the membership alone', async () => {
    await drawStaff();
    const row = await screen.findByTestId('staff-u2');
    fireEvent.click(within(row).getByText('Remove'));
    fireEvent.click(within(row).getByText('Just take the keys'));
    fireEvent.click(within(row).getByText('Take the keys'));
    await waitFor(() => expect(orgService.removeStaff).toHaveBeenCalledWith(ORG.id, 'u2'));
    // The whole point of the two-button question: this arm must not touch it.
    expect(orgService.removeMember).not.toHaveBeenCalled();
  });

  it('REMOVE FROM THE GYM TOO does both, keys FIRST — the server refuses the other order', async () => {
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
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
    await drawStaff();
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
  it("tells a STUDIO owner their trainer cannot see the client list, in the studio's word", async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, orgType: 'studio' }] } });
    await openForm();
    expect(screen.getByText(/can't see your client list/i)).toBeTruthy();
    expect(screen.queryByText(/Can see your (member|client) list/i)).toBeNull();
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
  await drawStaff();
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

  /** THIS TEST'S SUBJECT IS PASS-THROUGH, NOT THE SENTENCE — and until T3 round 2
   *  its assertion said the opposite (rule 4's list, item 1).
   *
   *  It stubbed a hard-coded COPY of the server's sentence and then asserted that
   *  same copy came out, matching on the words "the ability to manage staff". The
   *  server's sentence changed when `billing.manage` joined the last-owner guard;
   *  **this test stayed green and structurally could not have noticed**, because
   *  both halves of it are its own fixture. Its name promises something TRUE is
   *  shown; what it can actually prove is that whatever the server said is what
   *  the person reads.
   *
   *  So the sentence is now an ARBITRARY marker, deliberately not a copy of any
   *  real server string — nothing here can drift out of step with the API again,
   *  because there is no longer a claim about what the API says. The API's own
   *  wording is asserted where it is produced (`orgs.routes.test.ts`), which is
   *  the only place that assertion can be honest. */
  it('shows the server\'s own last-owner sentence rather than "something went wrong"', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const SERVER_SAID = 'ZZ-MARKER: the gym would be left unable to do something it needs.';
    orgService.updateStaffPrivileges.mockRejectedValue(
      apiError(409, 'last_owner_locked', SERVER_SAID),
    );
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/Remove members/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    expect(await screen.findByText(SERVER_SAID)).toBeTruthy();
    // AND NOT the generic fallback, which is the failure this guards against.
    expect(screen.queryByText(/something went wrong/i)).toBeNull();
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

// ── The gym's own details ───────────────────────────────────────────────────
//
// `PATCH /v1/orgs/:gymId` shipped on 2026-08-26 with NO CALLER. This is the
// caller. `gymDetailsView.test.js` proves the rules; these prove the screen
// obeys them, and three things beyond that: what actually goes on the wire, that
// the rest of the console follows a save, and that an unrecorded country is
// SAID rather than left as a box that looks broken.

describe('the gym’s own details', () => {
  const openSettings = async () => {
    await drawGym();
    return screen.findByLabelText('Gym name');
  };

  it('opens with what the gym holds, in every box', async () => {
    await openSettings();
    expect(screen.getByLabelText('Gym name').value).toBe('Iron House');
    expect(screen.getByLabelText('City').value).toBe('Austin');
    expect(screen.getByLabelText('Country').textContent).toContain('United States');
    expect(screen.getByLabelText('Time zone').value).toBe('America/Chicago');
  });

  it('names the money the gym is billed in, and says we decide it', async () => {
    await openSettings();
    expect(screen.getByText(/billed in USD/i)).toBeTruthy();
    expect(screen.getByText(/can't set it here/i)).toBeTruthy();
  });

  it('asks the server NOTHING until something actually changes', async () => {
    await openSettings();
    expect(screen.getByText('Save changes').disabled).toBe(true);
    fireEvent.click(screen.getByText('Save changes'));
    expect(orgService.updateOrg).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    expect(screen.getByText('Save changes').disabled).toBe(false);
  });

  it('goes quiet again if the owner un-does their own change', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House' } });
    expect(screen.getByText('Save changes').disabled).toBe(true);
  });

  /** THE ONE WITH TEETH, at the screen. A gym on a subscription is refused with
   *  409 `currency_locked` when the country it sends resolves to a different
   *  currency — and the server's first version refused a whole save merely for
   *  MENTIONING the country (:19656 C/H-1). A settings form that restated every
   *  box it drew would put a paying gym's money on the table every time somebody
   *  fixed a typo in the name. */
  it('sends ONLY the name when only the name changed — no country on the wire', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalledTimes(1));
    expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { name: 'Iron House Two' });
  });

  it('sends the country when somebody picks a different one', async () => {
    await openSettings();
    fireEvent.click(screen.getByLabelText('Country'));
    fireEvent.click(screen.getByText('India'));
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalledTimes(1));
    expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { country: 'IN' });
  });

  it('sends a time-zone change on its own', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Paris' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalledTimes(1));
    expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { timezone: 'Europe/Paris' });
  });

  it('clears a city with null rather than an empty string', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('City'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalledTimes(1));
    expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { city: null });
  });

  /** THE PICKER MUST CONTAIN THE GYM'S OWN ZONE, or opening Settings to fix a
   *  name moves the gym's day boundary by saving. Measured, not defensive
   *  (:10402): which member of an alias pair a runtime calls canonical is not
   *  predictable, and the row holds whatever was stored the day it was made. */
  it('offers the gym’s OWN time zone even when this runtime does not list it', async () => {
    const listed = Intl.supportedValuesOf('timeZone').filter((z) => z !== 'America/Chicago');
    vi.spyOn(Intl, 'supportedValuesOf').mockReturnValue(listed);
    await openSettings();
    const picker = screen.getByLabelText('Time zone');
    expect(picker.value).toBe('America/Chicago');
    expect(
      [...picker.options].some((o) => o.value === 'America/Chicago'),
    ).toBe(true);
    vi.restoreAllMocks();
  });

  /** THE FIRST VERSION OF THIS SCREEN COULD NOT SHOW THIS SENTENCE AT ALL and
   *  this test is what found it. An emptied name produces no patch — there is
   *  nothing to SEND about a name that was cleared — so Save was disabled, the
   *  click did nothing, and the check that lived on submit was unreachable in the
   *  one case it existed for: an owner looking at an empty box and a dead button,
   *  told nothing. The sentence is now derived from the draft, so it appears the
   *  moment the box is emptied. */
  it('says an empty name is wrong straight away, and asks the server nothing', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: '   ' } });
    expect(await screen.findByText(/needs a name/i)).toBeTruthy();
    // Not the server's raw `name: too_small`, which is what `errorText` prints
    // verbatim when the request is allowed to go.
    expect(screen.queryByText(/too_small/)).toBeNull();
    expect(screen.getByText('Save changes').disabled).toBe(true);
    fireEvent.click(screen.getByText('Save changes'));
    expect(orgService.updateOrg).not.toHaveBeenCalled();
  });

  it('takes the sentence away again when the name comes back', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: '' } });
    await screen.findByText(/needs a name/i);
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    expect(screen.queryByText(/needs a name/i)).toBeNull();
    expect(screen.getByText('Save changes').disabled).toBe(false);
  });

  it('says Saved, and puts the SERVER’s row back in the boxes', async () => {
    await openSettings();
    // The row the server says it stored — and the console's next read of "which
    // gyms do I run" agrees with it, which is what actually happens. Both are
    // set AFTER the screen has opened, or the form would start on the saved row
    // and there would be nothing to change.
    const saved = { ...ORG, name: 'Iron House Two' };
    orgService.updateOrg.mockResolvedValue({ data: { org: saved } });
    orgService.getMine.mockResolvedValue({ data: { orgs: [saved] } });
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    fireEvent.click(screen.getByText('Save changes'));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByLabelText('Gym name').value).toBe('Iron House Two');
    // And nothing is left to send, so the button goes quiet again.
    await waitFor(() => expect(screen.getByText('Save changes').disabled).toBe(true));
  });

  /** The boxes show what the SERVER stored, not what was typed — the country is
   *  the field where those differ, because it is normalised at the boundary. */
  it('shows the server’s version of a value, not the draft’s', async () => {
    await openSettings();
    const saved = { ...ORG, country: 'IN', currencyDisplay: 'INR' };
    orgService.updateOrg.mockResolvedValue({ data: { org: saved } });
    orgService.getMine.mockResolvedValue({ data: { orgs: [saved] } });
    fireEvent.click(screen.getByLabelText('Country'));
    fireEvent.click(screen.getByText('India'));
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText('Saved.');
    // The money line follows the row the server sent back, so an owner sees the
    // consequence of the change they just made.
    await waitFor(() => expect(screen.getByText(/billed in INR/i)).toBeTruthy());
  });

  /** Without this the shell's gym name, "Your gyms" and the Overview header all
   *  keep the OLD name until the next window focus — the console telling an
   *  owner something it has itself just been told is untrue. */
  it('makes the rest of the console re-read the gym after a save', async () => {
    await openSettings();
    expect(orgService.getMine).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalledTimes(2));
  });

  /** And it re-reads QUIETLY. A foreground refresh publishes `loading`, which
   *  would blank this very screen and take the Staff section with it. */
  it('does NOT blank the screen while that re-read happens', async () => {
    let answer;
    orgService.updateOrg.mockResolvedValue({
      data: { org: { ...ORG, name: 'Iron House Two' } },
    });
    orgService.getMine.mockReturnValueOnce(Promise.resolve({ data: { orgs: [ORG] } }));
    orgService.getMine.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    await openSettings();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalledTimes(2));
    // The read is still in the air and the form is still on screen with the
    // saved values in it.
    expect(screen.getByLabelText('Gym name').value).toBe('Iron House Two');
    expect(screen.queryByText('Loading your gym…')).toBeNull();
    answer({ data: { orgs: [ORG] } });
  });

  it("shows the SERVER's own sentence when it refuses, and keeps what was typed", async () => {
    orgService.updateOrg.mockRejectedValue(
      apiError(
        409,
        'currency_locked',
        "The currency your gym is billed in can't change while your gym has a subscription, and that country uses a different one. Contact us and we'll move it for you.",
      ),
    );
    await openSettings();
    fireEvent.click(screen.getByLabelText('Country'));
    fireEvent.click(screen.getByText('India'));
    fireEvent.click(screen.getByText('Save changes'));
    expect(await screen.findByText(/currency your gym is billed in can't change/i)).toBeTruthy();
    // Nothing is retyped, and the choice they made is still theirs.
    expect(screen.getByLabelText('Country').textContent).toContain('India');
    expect(screen.getByText('Save changes')).toBeTruthy();
  });

  /** NO Try again: Save is still on screen and IS the retry. For the currency
   *  lock a second button would promise something that cannot work however many
   *  times it is pressed. */
  it('offers no Try again beside a refusal — the Save button is the retry', async () => {
    orgService.updateOrg.mockRejectedValue(offline());
    await openSettings();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    fireEvent.click(screen.getByText('Save changes'));
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  /** T3 round 1, Low-2. The button is disabled while a save is in flight, but
   *  ENTER submits a form without going through the button — so two quick
   *  presses were two requests for one act. */
  it('sends ONE request however many times the form is submitted', async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    const form = screen.getByLabelText('Gym name').closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalled());
    expect(orgService.updateOrg).toHaveBeenCalledTimes(1);
  });

  it('clears a refusal as soon as the owner edits again', async () => {
    orgService.updateOrg.mockRejectedValue(offline());
    await openSettings();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText(/Couldn't reach the server/i);
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Three' } });
    expect(screen.queryByText(/Couldn't reach the server/i)).toBeNull();
  });
});

describe('a gym with no country on record', () => {
  const OLDER = { ...ORG, country: null };

  /** Every gym created before migration `0014` — the wizard asked, the server
   *  turned the answer into a currency and did not keep it. An empty box is TRUE
   *  here; what would be wrong is leaving it looking like something failed. */
  it('says so, names the money it IS billed in, and starts the box empty', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [OLDER] } });
    await drawGym();
    await screen.findByLabelText('Gym name');
    expect(screen.getByText(/don't have your country on record/i)).toBeTruthy();
    expect(screen.getByText(/billed in USD/i)).toBeTruthy();
    expect(screen.getByLabelText('Country').textContent).toContain('Choose a country');
  });

  it('heals itself on the first save, sending only the country', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [OLDER] } });
    await drawGym();
    await screen.findByLabelText('Gym name');
    fireEvent.click(screen.getByLabelText('Country'));
    fireEvent.click(screen.getByText('United States'));
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalledTimes(1));
    expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { country: 'US' });
  });

  /** THE CONTROL for the sentence above, and it is what stops "say it always"
   *  passing: a gym that HAS a country must not be told we do not have it. */
  it('is NOT said about a gym whose country we do hold', async () => {
    await drawGym();
    await screen.findByLabelText('Gym name');
    expect(screen.queryByText(/don't have your country on record/i)).toBeNull();
  });
});

// ── When the gym changes underneath the form ────────────────────────────────
//
// T3 ROUND 1, C/H-1. The draft was seeded ONCE and never followed the org row
// again, while the page subtitle two lines above it reads that row live — so a
// rename made somewhere else (a second tab, the other owner at the front desk)
// left the boxes showing the OLD name and time zone under a heading showing the
// new one, switched Save on with no keystroke, and sent the stale values back
// on one click. The time zone is what makes it Critical/High rather than untidy:
// it is the only thing the rollup worker consults, so the revert moves the gym's
// day.
//
// THE RECORDED REASON FOR NOT SYNCING WAS RIGHT AND IS NOT UNDONE — a re-read
// must never replace what somebody is halfway through typing. What was wrong is
// that it was applied to a form nobody had touched. Both halves are pinned here.

describe('when the gym changes underneath the form', () => {
  const renamedElsewhere = {
    ...ORG,
    name: 'Iron Palace',
    city: 'Dallas',
    timezone: 'Europe/Paris',
  };

  it('FOLLOWS the gym while the form is untouched, and stays quiet', async () => {
    await drawGym();
    expect(screen.getByLabelText('Gym name').value).toBe('Iron House');

    orgService.getMine.mockResolvedValue({ data: { orgs: [renamedElsewhere] } });
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(screen.getByLabelText('Gym name').value).toBe('Iron Palace'));
    expect(screen.getByLabelText('City').value).toBe('Dallas');
    expect(screen.getByLabelText('Time zone').value).toBe('Europe/Paris');
    // AND THE BUTTON IS THE HALF WITH TEETH: a Save offering itself over values
    // nobody typed is the click that reverts somebody else's change.
    expect(screen.getByText('Save changes').disabled).toBe(true);
  });

  it('never sends the stale values back', async () => {
    await drawGym();
    orgService.getMine.mockResolvedValue({ data: { orgs: [renamedElsewhere] } });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.getByLabelText('Gym name').value).toBe('Iron Palace'));

    fireEvent.click(screen.getByText('Save changes'));
    expect(orgService.updateOrg).not.toHaveBeenCalled();
  });

  /** THE OTHER HALF, AND IT IS WHY THIS IS NOT SIMPLY "SYNC FROM THE PROP".
   *  The kept answer is re-read on every window focus, so an owner who alt-tabs
   *  mid-edit must come back to their own typing, not to the stored values. */
  it('LEAVES A TOUCHED FORM ALONE, even when the gym has moved', async () => {
    await drawGym();
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'My Own Typing' } });

    orgService.getMine.mockResolvedValue({ data: { orgs: [renamedElsewhere] } });
    fireEvent(window, new Event('focus'));

    // Give the re-read time to land and be ignored.
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Gym name').value).toBe('My Own Typing');
  });

  /** The picker must contain whatever the box is SHOWING, not merely whatever it
   *  showed when the screen opened — otherwise following a change into a zone
   *  this runtime spells differently would leave the select with no matching
   *  option, which is the blank-or-first-in-the-list failure C56 exists for,
   *  arriving one step later. */
  it('keeps the time-zone picker holding the zone it is displaying', async () => {
    await drawGym();
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, timezone: 'Asia/Kolkata' }] },
    });
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(screen.getByLabelText('Time zone').value).toBe('Asia/Kolkata'));
    const picker = screen.getByLabelText('Time zone');
    expect([...picker.options].some((o) => o.value === 'Asia/Kolkata')).toBe(true);
  });

  /** T3 ROUND 2, C/H-1 — and it is round 1's OWN FIX doing it. Round 1 re-anchored
   *  the picker to the zone the box is SHOWING, which was right and was made the
   *  ONLY thing it follows — so the zone the gym actually HOLDS dropped out the
   *  moment the owner selected anything else, with no way back short of leaving
   *  the screen. It needs both.
   *
   *  The subject only exists for a gym whose stored zone this runtime spells
   *  differently, which is not exotic: measured here, 418 zones listed,
   *  `Asia/Calcutta` present and `Asia/Kolkata` absent — and the same for
   *  Kiev/Kyiv, Rangoon/Yangon and Godthab/Nuuk. */
  it('KEEPS the gym’s own zone selectable after the owner picks a different one', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, timezone: 'Asia/Kolkata' }] },
    });
    await drawGym();
    expect(screen.getByLabelText('Time zone').value).toBe('Asia/Kolkata');

    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Paris' } });
    expect(screen.getByLabelText('Time zone').value).toBe('Europe/Paris');

    // THE ASSERTION: the gym's own zone is still in the list. This runtime does
    // not enumerate it, so it is there only because the picker injects it — and
    // without it an owner who opened the dropdown to look has silently lost the
    // ability to put their gym's day back where it was.
    const options = [...screen.getByLabelText('Time zone').options].map((o) => o.value);
    expect(options).toContain('Asia/Kolkata');
    // Positive control: the one they picked is there too, so "inject everything"
    // and "inject nothing" are both refused by this pair.
    expect(options).toContain('Europe/Paris');
  });

  /** T3 ROUND 3, C/H-1 — AND THIS ONE IS OLDER THAN ROUNDS 1 AND 2, not caused
   *  by either of their fixes.
   *
   *  `/console/:orgSlug/settings` is ONE route, so moving between two gyms'
   *  Settings changes the parameter and does NOT remount the panel — it keeps
   *  its draft, and a TOUCHED form deliberately does not follow the prop (the
   *  same-gym rule, which is correct). So gym A's typing sat under gym B, over
   *  gym B's untouched city nobody had edited, and one click wrote all of it to
   *  gym B's id, **time zone included**.
   *
   *  **Not an IDOR** — the server correctly authorises the write, because gym B
   *  is a gym this owner manages. It is data corruption inside the caller's own
   *  tenancy, which `requirePrivilege` cannot see and should not be expected to.
   *
   *  **KD RULED PATCH on the third firing of the escape hatch**, and the fix is
   *  a `key`: the panel cannot carry ANY state across a gym change, for any
   *  field, including fields nobody has added yet. A class fix rather than a
   *  third patch of a case (:1239). */
  it('carries NOTHING from one gym onto another, even mid-edit', async () => {
    const gymB = {
      ...ORG,
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      slug: 'iron-palace',
      name: 'Iron Palace',
      city: 'Dallas',
      timezone: 'Europe/Paris',
    };
    orgService.getMine.mockResolvedValue({ data: { orgs: [ORG, gymB] } });

    // ONE MemoryRouter, ONE navigation — the link is the instrument, not the
    // subject. Re-rendering a fresh `MemoryRouter` would REMOUNT everything and
    // pass whatever the panel did, which is red-for-the-wrong-reason (:4718 F2);
    // a real location change inside one router is what leaves the shared route
    // element in place, exactly as the browser's history jump does.
    render(
      <MemoryRouter initialEntries={['/console/iron-house/settings']}>
        <Link to="/console/iron-palace/settings">jump</Link>
        <Routes>
          <Route path="/console/:orgSlug/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>,
    );
    await openSection('Gym details');
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House HQ' } });

    // The browser's own back/forward history jumps entries in one go — a single
    // location change, with unsaved edits, for an owner with two gyms.
    fireEvent.click(screen.getByText('jump'));
    await waitFor(() => expect(screen.getAllByText('Iron Palace').length).toBeGreaterThan(0));

    // THE COUNT IS THE ASSERTION, and the round-4 finding is why. This test used
    // to take the LAST match of every query, on a recorded cause that is simply
    // false: "react-router 7 + React 19 leave the outgoing route subtree in
    // jsdom, so every query matches twice". Nothing of the route subtree is
    // duplicated — measured here, ONE `h1`, ONE subtitle, ONE Staff heading.
    // What was duplicated was the gym panel alone, because round 3's fix gave
    // BOTH panels the same `key`, and React keeps only the last of a duplicate
    // pair in its child map — so the first panel's fiber is dropped without a
    // deletion ever being scheduled, and it sits in the document, typeable, with
    // a live Save button wired to the gym the owner has left.
    //
    // Taking the last match looked straight past exactly that panel. So this
    // test passed with the defect live, which is how a day went. It now counts:
    // one heading, one of every box, one Save.
    const headings = screen.getAllByRole('button', { name: /^Gym details/ });
    expect(headings).toHaveLength(1);
    if (headings[0].getAttribute('aria-expanded') !== 'true') fireEvent.click(headings[0]);

    // GYM B'S OWN VALUES, none of gym A's — and ONE box each, so a stranded
    // panel still holding gym A's typing fails this rather than hiding behind it.
    expect(screen.getAllByLabelText('Gym name').map((n) => n.value)).toEqual(['Iron Palace']);
    expect(screen.getAllByLabelText('City').map((n) => n.value)).toEqual(['Dallas']);
    expect(screen.getAllByLabelText('Time zone').map((n) => n.value)).toEqual(['Europe/Paris']);
    // And nothing to send, so the click that did the damage is not offered —
    // nor is a second one belonging to the gym they left.
    const saves = screen.getAllByText('Save changes');
    expect(saves).toHaveLength(1);
    expect(saves[0].disabled).toBe(true);
  });

  /** THE SIBLING, found by probing for it rather than by the review — which
   *  named only the gym-details form. `StaffPanel` keeps its own fetched list
   *  and re-reads on `gymId`, so gym A's staff sat under gym B for as long as
   *  gym B's read was in flight. **Worse than a stale list**: a row's controls
   *  act on the CURRENT `gymId` with the OLD person's id, so a Remove aimed at
   *  somebody visible would be sent against a gym they do not staff.
   *  :1239 — fixing the instance and leaving the class is the recorded defect. */
  it('carries NO staff list from one gym onto another', async () => {
    const gymB = { ...ORG, id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', slug: 'iron-palace', name: 'Iron Palace' };
    const staffB = { ...OWNER, userId: 'u9', displayName: 'Bravo Person' };
    orgService.getMine.mockResolvedValue({ data: { orgs: [ORG, gymB] } });
    orgService.getStaff.mockResolvedValueOnce({ data: { staff: [OWNER] } });

    render(
      <MemoryRouter initialEntries={['/console/iron-house/settings']}>
        <Link to="/console/iron-palace/settings">jump</Link>
        <Routes>
          <Route path="/console/:orgSlug/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>,
    );
    await openSection('Staff');
    expect(await screen.findByText('Kd Owner')).toBeTruthy();

    // Gym B's read is still in flight — the window a person actually sees.
    let landB;
    orgService.getStaff.mockReturnValue(
      new Promise((resolve) => {
        landB = () => resolve({ data: { staff: [staffB] } });
      }),
    );
    fireEvent.click(screen.getByText('jump'));
    await waitFor(() => expect(screen.getByText('Iron Palace')).toBeTruthy());

    const heading = screen.getByRole('button', { name: /^Staff/ });
    if (heading.getAttribute('aria-expanded') !== 'true') fireEvent.click(heading);
    expect(screen.queryByText('Kd Owner')).toBeNull();

    // Positive control: gym B's own list does arrive, so "show nobody, ever"
    // would not satisfy this.
    landB();
    expect(await screen.findByText('Bravo Person')).toBeTruthy();
  });

  /** THE OTHER HALF OF THE PICKER RULE, and it is what stops the round-2 fix
   *  making the round-1 one redundant. Asking only for the zone the GYM holds
   *  covers every untouched form — the two are equal there — so the DISPLAYED
   *  zone earns its place in exactly one case: the form is TOUCHED, so it does
   *  not follow, and the gym's zone has moved on underneath it. The box is then
   *  showing something the org row no longer holds. */
  it('holds the zone the box is showing even when the gym has moved on', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, timezone: 'Asia/Kolkata' }] },
    });
    await drawGym();
    expect(screen.getByLabelText('Time zone').value).toBe('Asia/Kolkata');

    // Touch the form, so it stops following.
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'My Own Typing' } });
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, timezone: 'Europe/Paris' }] },
    });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(orgService.getMine).toHaveBeenCalledTimes(2));

    // The box still shows the gym's OLD zone, which this runtime does not
    // enumerate — so it is in the list only because the picker was asked for it.
    const picker = screen.getByLabelText('Time zone');
    expect(picker.value).toBe('Asia/Kolkata');
    expect([...picker.options].map((o) => o.value)).toContain('Asia/Kolkata');
  });

  /** T3 round 2, Low-1. The follow block swaps what is in the boxes and left
   *  `saved` standing — so "Saved." could sit beside a form now showing somebody
   *  else's values, a confirmation about bytes that are no longer on screen.
   *  It is the rule this file states eleven lines further down, reached through a
   *  door round 1 opened. */
  it('takes "Saved." down when the boxes are replaced by somebody else’s change', async () => {
    await drawGym();
    const saved = { ...ORG, city: 'Dallas' };
    orgService.updateOrg.mockResolvedValue({ data: { org: saved } });
    orgService.getMine.mockResolvedValue({ data: { orgs: [saved] } });
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Dallas' } });
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText('Saved.');

    // Now the other owner renames the gym and the window comes back.
    orgService.getMine.mockResolvedValue({ data: { orgs: [renamedElsewhere] } });
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(screen.getByLabelText('Gym name').value).toBe('Iron Palace'));
    expect(screen.queryByText('Saved.')).toBeNull();
  });

  /** After a save, the boxes hold the SERVER's row — so the form must count that
   *  as its new starting point. Without it the form reads as touched for ever
   *  and stops following anything, which is C/H-1 again one save later. */
  it('goes on following after a save', async () => {
    await drawGym();
    const saved = { ...ORG, name: 'Iron House Two' };
    orgService.updateOrg.mockResolvedValue({ data: { org: saved } });
    orgService.getMine.mockResolvedValue({ data: { orgs: [saved] } });
    fireEvent.change(screen.getByLabelText('Gym name'), { target: { value: 'Iron House Two' } });
    fireEvent.click(screen.getByText('Save changes'));
    await screen.findByText('Saved.');

    orgService.getMine.mockResolvedValue({ data: { orgs: [renamedElsewhere] } });
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(screen.getByLabelText('Gym name').value).toBe('Iron Palace'));
  });
});

// ── The sections open when you tap them ─────────────────────────────────────
//
// Kd's call, made looking at the screen: "i think there should be like drop down
// when click on them there is a drop down other wise it will be a really long
// list". Settings carries two sections today and Part 3 §4.7 puts five on it, so
// the screen he saw is the shortest it will ever be.
//
// What these pin is the three ways a collapsing screen lies: hiding something an
// owner needed to see, hiding the fact that a section exists at all, and hiding
// an error nobody asked for.

describe('the settings sections', () => {
  it('both start CLOSED, with their headings still saying what they are', async () => {
    drawSettings();
    // The headings are there — a closed screen is a menu, not a row of mystery
    // boxes.
    expect(await screen.findByRole('button', { name: /^Gym details/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Staff/ })).toBeTruthy();
    // And what is inside them is not.
    expect(screen.queryByLabelText('Gym name')).toBeNull();
    expect(screen.queryByText('Kd Owner')).toBeNull();
  });

  it('says so in a way a screen reader can hear, not only by drawing an arrow', async () => {
    drawSettings();
    const heading = await screen.findByRole('button', { name: /^Gym details/ });
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the one you tap and LEAVES THE OTHER ALONE', async () => {
    await drawGym();
    expect(screen.getByLabelText('Gym name')).toBeTruthy();
    // Tapping one section must not open every section.
    expect(screen.queryByText('Kd Owner')).toBeNull();
  });

  it('closes again on a second tap', async () => {
    await drawGym();
    expect(screen.getByLabelText('Gym name')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Gym details/ }));
    expect(screen.queryByLabelText('Gym name')).toBeNull();
  });

  /** THE ONE NUMBER AN OWNER GLANCES AT STAYS ON THE CLOSED HEADING. Putting it
   *  behind the tap would mean opening a section to learn something the heading
   *  used to tell you — the change making the screen worse than the wall it
   *  replaced. */
  it('keeps the staff count readable while the section is shut', async () => {
    drawSettings();
    expect(await screen.findByText('2 people run this gym')).toBeTruthy();
    expect(screen.queryByText('Kd Owner')).toBeNull();
  });

  /** THE ANTI-SILENCE RULE, and it is the reason `forceOpen` exists at all. The
   *  staff list is read on mount whether the section is open or not, so a failed
   *  read arrives while nobody is looking — and a closed row over an error card
   *  says NOTHING, which is worse than the error (:12660: no reviewer, test or
   *  mutant flags an ABSENT sentence; a person does). */
  it('OPENS ITSELF when the staff list fails, rather than hiding the error', async () => {
    orgService.getStaff.mockRejectedValue(offline());
    drawSettings();
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('cannot be tapped shut over that error', async () => {
    orgService.getStaff.mockRejectedValue(offline());
    drawSettings();
    await screen.findByText(/Couldn't reach the server/i);
    fireEvent.click(screen.getByRole('button', { name: /^Staff/ }));
    // Still there. A section holding something the owner has to see is not
    // dismissible by the tap that would hide it.
    expect(screen.getByText(/Couldn't reach the server/i)).toBeTruthy();
  });

  /** THE POSITIVE CONTROL for the two above, and without it "always open" would
   *  satisfy them both. A healthy staff read must still start shut. */
  it('does NOT open itself when the staff list reads fine', async () => {
    drawSettings();
    expect(await screen.findByText('2 people run this gym')).toBeTruthy();
    expect(screen.queryByText('Kd Owner')).toBeNull();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  /** The count is withheld exactly where it always was. "0 people run this gym"
   *  is never a true sentence about a gym — it always has its owner — so a
   *  heading that printed one over a failed read would be the wrong number on
   *  screen (:5807). */
  it('says no number on the heading when the list could not be read', async () => {
    orgService.getStaff.mockRejectedValue(offline());
    drawSettings();
    await screen.findByText(/Couldn't reach the server/i);
    expect(screen.queryByText(/run this gym$/)).toBeNull();
  });

  /** T3 ROUND 1, Low-1. Pressing **Try again** cleared the error, which cleared
   *  `forceOpen`, which SHUT THE SECTION UNDER THE CLICK — spinner included,
   *  since the loading arm lives inside the body that had just been unmounted.
   *  An owner saw everything vanish and read it as a broken button. */
  it('STAYS OPEN through a Try again, rather than shutting under the click', async () => {
    orgService.getStaff.mockRejectedValueOnce(offline());
    drawSettings();
    fireEvent.click(await screen.findByText('Try again'));
    // The list comes back and it is ON SCREEN — the section did not close
    // between the error going away and the answer arriving.
    expect(await screen.findByText('Kd Owner')).toBeTruthy();
  });

  /** And it is then an ordinary open section again: the force is spent, so an
   *  owner can shut it. Without this, "latch it open" would quietly become
   *  "never closes", which is a different defect wearing the fix's clothes. */
  it('can be closed again once the error is gone', async () => {
    orgService.getStaff.mockRejectedValueOnce(offline());
    drawSettings();
    fireEvent.click(await screen.findByText('Try again'));
    await screen.findByText('Kd Owner');
    fireEvent.click(screen.getByRole('button', { name: /^Staff/ }));
    expect(screen.queryByText('Kd Owner')).toBeNull();
  });

  /** T3 round 1, Low-3. Closed means UNMOUNTED, so pointing at the body's id
   *  while it does not exist promises a screen reader an element to move to and
   *  there is none. */
  it('points at its body only while the body exists', async () => {
    drawSettings();
    const heading = await screen.findByRole('button', { name: /^Gym details/ });
    expect(heading.getAttribute('aria-controls')).toBeNull();
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-controls')).not.toBeNull();
  });
});

describe('who gets the gym-details form', () => {
  const managerWith = (privileges) => ({ ...ORG, staffRole: 'manager', privileges });

  /** Renders RAW rather than through `drawGym`, because the claim is that there
   *  is no section here to open — a helper that taps the heading would fail on
   *  the missing heading rather than on the missing form, i.e. red for the wrong
   *  reason (:4718 F2). Both are asserted: no heading, and no form behind it. */
  it('is not drawn for a manager who has not been given the power', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [managerWith(ROLE_PRIVILEGES.manager)] } });
    drawSettings();
    expect(await screen.findByText(/Only the gym's owner can change these settings/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Gym details/ })).toBeNull();
    expect(screen.queryByLabelText('Gym name')).toBeNull();
  });

  /** KD'S RULING IS "OWNER ONLY BY DEFAULT", not owner-only by construction: the
   *  privilege is in neither the owner-only nor the last-owner list, so an owner
   *  may tick it across (:11429 rule 3). A screen gating on the ROLE NAME would
   *  leave that manager holding a power with no control anywhere — :16095's
   *  Critical/High exactly. */
  it('IS drawn for a manager the owner ticked it across to', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [managerWith([...ROLE_PRIVILEGES.manager, 'org.manage'])] },
    });
    await drawGym();
    expect(await screen.findByLabelText('Gym name')).toBeTruthy();
    // And the sentence that would now be FALSE about them is gone.
    expect(screen.queryByText(/Only the gym's owner can change these settings/i)).toBeNull();
    // Staff is a different power and they still do not have it.
    expect(orgService.getStaff).not.toHaveBeenCalled();
  });

  it('gives that manager the Settings TAB, or the power has no door', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [managerWith([...ROLE_PRIVILEGES.manager, 'org.manage'])] },
    });
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Settings').length).toBeGreaterThan(0));
  });

  it('still keeps the tab from a manager holding neither power', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [managerWith(ROLE_PRIVILEGES.manager)] } });
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Settings')).toBeNull();
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

describe('the attendance switch', () => {
  /** KD'S RULING (:26469 §1.4), and its place on this screen is ruling 17
   *  (:28107): **the SWITCH configures the feature and stays on Settings, while
   *  the LIST of who came is its own console section.** *"Settings is where a
   *  gym CONFIGURES itself; a section is where it WORKS."* */
  const drawAttendance = async () => {
    drawSettings();
    await openSection('Marking attendance');
  };

  it('is on, and says so on the closed heading', async () => {
    drawSettings();
    // :20338's requirement — a shut row still answers the question the owner
    // opened Settings with, so the state is readable without opening anything.
    expect(await screen.findByText(/Members can mark themselves in/i)).toBeTruthy();
  });

  it('says Switched off on the closed heading when the gym turned it off', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, manualAttendanceEnabled: false }], formerOrgs: [] },
    });
    drawSettings();
    expect(await screen.findByText(/Switched off/i)).toBeTruthy();
  });

  it('sends the change on its own, with no Save button', async () => {
    await drawAttendance();
    const box = screen.getByLabelText(/Let members mark themselves in/i);
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalledTimes(1));
    expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { manualAttendanceEnabled: false });
  });

  /** THE SWITCH DRAWS FROM THE SERVER'S ANSWER, NOT FROM THE PRESS. A failed
   *  save must leave it showing what the gym actually has — a toggle that
   *  reported a state the server rejected is the one thing it must never do
   *  (:5807: on screen and wrong). */
  it('stays where it was when the save is refused, and says why', async () => {
    orgService.updateOrg.mockRejectedValue(apiError(403, 'forbidden', 'You cannot change that.'));
    await drawAttendance();
    fireEvent.click(screen.getByLabelText(/Let members mark themselves in/i));
    await waitFor(() => expect(screen.getByText(/You cannot change that./i)).toBeTruthy());
    expect(screen.getByLabelText(/Let members mark themselves in/i).checked).toBe(true);
  });

  /** SAYS WHAT TURNING IT OFF ACTUALLY COSTS. Today this is the ONLY way a
   *  visit can be recorded — the QR path is the phone app's (:26558, :26586) and
   *  staff marking somebody present is not built (:27900) — so an owner should
   *  read that here rather than discover it from an empty screen tomorrow. */
  it('warns that switching it off stops attendance entirely', async () => {
    await drawAttendance();
    expect(screen.getByText(/stops attendance being recorded at all/i)).toBeTruthy();
  });

  /** A LAPSED GYM'S CONSOLE IS READ-ONLY (:24141, :23711) and this panel obeys
   *  it like every other. The server refuses the write too — `updateOrg` goes
   *  through `requireWritablePrivilege` — so this is the screen not offering a
   *  control it knows will be refused, never the enforcement (R3.3). */
  it('is not usable on a gym whose plan has lapsed', async () => {
    // `consoleReadOnly` IS THE SERVER'S OWN THREE-STATE ANSWER and the lock is
    // NOT derived from the subscription — `null` means "we could not ask" (a
    // plain member, an older api) and must never grey anything out. A first
    // draft of this test set an `expired` subscription and left the flag off,
    // which greyed nothing and would have sent me looking for a defect in the
    // panel; the panel was right and the fixture was not.
    orgService.getMine.mockResolvedValue({
      data: {
        orgs: [{ ...ORG, subscription: null, consoleReadOnly: true }],
        formerOrgs: [],
      },
    });
    await drawAttendance();
    const box = screen.getByLabelText(/Let members mark themselves in/i);
    expect(box.disabled).toBe(true);
    fireEvent.click(box);
    expect(orgService.updateOrg).not.toHaveBeenCalled();
    // AND IT STOPS INVITING THE CLICK IT WILL IGNORE (T3 round 1, L-3). The
    // whole row is a `<label>`, so the pointer cursor covered the words as well
    // as the box — an affordance offered by a control that cannot act.
    expect(box.closest('label').className).not.toMatch(/cursor-pointer/);
  });

  /** **THE GREYED SWITCH SAYS WHY, INSIDE ITS OWN SECTION** — :24141 §3(c), and
   *  the regression test for T3 round 1's C/H-1 (:5348 rule 3).
   *
   *  The case above ships the disable half and is green without the sentence,
   *  which is exactly how this shipped: five panels grey a control and write
   *  `READ_ONLY_NOTE` beside it, this one greyed and wrote nothing, and an owner
   *  opening only this row met a dead switch under no explanation at all.
   *
   *  **SCOPED TO THE SECTION, AND ROUND 2 CORRECTED WHY.** This used to say a
   *  screen-wide `getAllByText(...).length > 0` is satisfied by any OTHER
   *  panel's copy of the sentence. It is not, on this screen: a closed
   *  `ConsoleSection` is unmounted, so only the section a case opens is there to
   *  find. Scoping is worth having anyway — it is what makes the assertion say
   *  *this* panel rather than *the screen* — but the thing that let C/H-1 ship
   *  was that no case opened THIS section at all, which is what the case below
   *  is. */
  it('says WHY it is greyed, in this section rather than only in the strip at the top', async () => {
    orgService.getMine.mockResolvedValue({
      data: {
        orgs: [{ ...ORG, subscription: null, consoleReadOnly: true }],
        formerOrgs: [],
      },
    });
    await drawAttendance();
    const panel = await sectionBody('Marking attendance');
    expect(panel.getByText(READ_ONLY_NOTE)).toBeTruthy();
  });

  /** THE POSITIVE CONTROL, one field apart — without it the case above is
   *  satisfied by a panel that prints the sentence to every gym on earth,
   *  including the ones whose switch works perfectly (:7104's PG1). */
  it('says nothing of the sort on a gym that is paying', async () => {
    await drawAttendance();
    const panel = await sectionBody('Marking attendance');
    expect(panel.queryByText(READ_ONLY_NOTE)).toBeNull();
    expect(screen.getByLabelText(/Let members mark themselves in/i).disabled).toBe(false);
  });

  /** THE TICK BOX KD'S RULING 18 REQUIRES, without which *"the owner can change
   *  it"* is a sentence with no control behind it (:28107). It is a READ, so it
   *  sits high in `PRIVILEGE_COPY`'s least-powerful-first order. */
  it('has a tick box on the Staff screen, worded for a person', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER] } });
    const row = await openTicks('staff-u2');
    expect(within(row).getByLabelText(/See who came in/i)).toBeTruthy();
  });

  it('saves that tick like any other', async () => {
    orgService.getStaff.mockResolvedValue({ data: { staff: [OWNER, MANAGER_TICKED] } });
    const row = await openTicks('staff-u2');
    fireEvent.click(within(row).getByLabelText(/See who came in/i));
    fireEvent.click(within(row).getByText('Save permissions'));
    await waitFor(() => expect(orgService.updateStaffPrivileges).toHaveBeenCalledTimes(1));
    expect(orgService.updateStaffPrivileges.mock.calls[0][2].privileges).toContain('attendance.read');
  });
});
