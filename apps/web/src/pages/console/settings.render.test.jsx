// The console's Settings screen — what a gym owner SEES, and what the screen
// refuses to say: the gym's own details, its sections that open on a tap, and
// who gets the Settings tab at all. Staff left it for Members → Staff (23c-ii);
// their tests are in `membersStaff.render.test.jsx`.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROLE_PRIVILEGES } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getMine: vi.fn(),
      updateOrg: vi.fn(),
      /** Staff left Settings for Members → Staff (23c-ii): these three are here so a
       *  test can show that Settings no longer reads them. */
      getStaff: vi.fn(),
      getStaffInvites: vi.fn(),
      getStaffRoles: vi.fn(),
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
      /** Settings' follow-up emails box (20c-v) reads on mount too: a gym that never
       *  switched it on. */
      getLeadEmailSettings: vi.fn(() =>
        Promise.resolve({
          data: { settings: { sendForMe: false, replyTo: null, perMonth: 100, usedThisMonth: 0, hasPostalAddress: true, stopped: false, appSending: 'on' } },
        }),
      ),
      updateLeadEmailSettings: vi.fn(),
      /** Settings' class bookings box (17c-ii-a) reads on mount too: the starting values. */
      getBookingSettings: vi.fn(() =>
        Promise.resolve({ data: { settings: { opensDays: 7, freeCancelMinutes: 120, handoverMinutes: 1440, waitlistMax: 20 } } }),
      ),
      updateBookingSettings: vi.fn(),
      /** Settings' check-in devices box (16b-i) reads on mount too: a gym with none. */
      getCheckinDevices: vi.fn(() => Promise.resolve({ data: { devices: [] } })),
      /** Memberships left Settings for a page of its own (23c-i): these two are here so a
       *  test can show that Settings no longer reads them. */
      getMembershipWords: vi.fn(() => Promise.resolve({ data: { words: [], types: [] } })),
      getMembershipTypes: vi.fn(() =>
        Promise.resolve({ data: { currency: 'USD', types: [], archived: [], archivedTotal: 0, classChoices: [] } }),
      ),
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

/** A manager holding none of the powers Settings has a section for: `schedule.manage`
 *  opens Class bookings since 17c-ii-a. (`memberships.manage` opened a section from 17a-i
 *  to 23c-i; it is left out here too, so this stays "no power at all".) */
const NO_SETTINGS_POWER = ROLE_PRIVILEGES.manager.filter((p) => p !== 'memberships.manage' && p !== 'schedule.manage');

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
  // Set again each time: a test that fails this read must not fail it for the next one.
  orgService.getHours.mockResolvedValue({ data: { hours: { mode: 'unset', timezone: 'UTC', week: [], closures: [] } } });
  orgService.getStaff.mockResolvedValue({ data: { staff: [] } });
  orgService.getStaffInvites.mockResolvedValue({ data: { invites: [] } });
  orgService.getStaffRoles.mockResolvedValue({ data: { roles: [] } });
});

afterEach(() => {
  cleanup();
});

describe('a manager or trainer at this address', () => {
  it('is told, and the screen asks the server NOTHING about staff', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager', privileges: NO_SETTINGS_POWER }] } });
    drawSettings();
    expect(await screen.findByText(/Only the gym's owner can change these settings/i)).toBeTruthy();
    // Not merely tidy: the read is owner-gated too, so asking would 404 and the
    // panel would draw an error card at somebody who did nothing wrong.
    expect(orgService.getStaff).not.toHaveBeenCalled();
  });

  /** A manager's usual permissions set the timetable, so Settings is theirs to open,
   *  holding Class bookings and nothing they cannot use. */
  it('with the usual permissions sees Class bookings and no section they cannot use', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    drawSettings();
    expect(await screen.findByRole('button', { name: /^Class bookings/ })).toBeTruthy();
    expect(screen.queryByText(/Only the gym's owner can change these settings/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Gym details/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Staff/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Check-in devices/ })).toBeNull();
    expect(orgService.getStaff).not.toHaveBeenCalled();
  });

  /** 23c-i: the price list is a page of its own, so its tick opens nothing in Settings. */
  it('a trainer given "Change membership types and prices" and nothing else here finds no section of theirs', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, staffRole: 'trainer', privileges: [...ROLE_PRIVILEGES.trainer, 'memberships.manage'] }] },
    });
    drawSettings();
    expect(await screen.findByText(/Only the gym's owner can change these settings/i)).toBeTruthy();
    expect(screen.queryByText(/Memberships/)).toBeNull();
    expect(orgService.getStaff).not.toHaveBeenCalled();
  });

  /** 23c-i, and Kd at its click-through: Settings needs nothing about what the gym sells. */
  it('the owner: Settings holds nothing about Memberships, and reads no price list', async () => {
    drawSettings();
    expect(await screen.findByRole('button', { name: /^Gym details/ })).toBeTruthy();
    // `drawSettings` draws the page alone: with the menu around it, its Memberships line
    // would be found here, and this check would need the page's own element instead.
    expect(screen.queryByText(/Memberships/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Memberships/ })).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(orgService.getMembershipTypes).not.toHaveBeenCalled();
    expect(orgService.getMembershipWords).not.toHaveBeenCalled();
  });

  /** 23c-ii: staff are invited and managed on Members → Staff, and nothing is left behind. */
  it('the owner: Settings holds nothing about staff, and reads no staff list, invitations or roles', async () => {
    drawSettings();
    expect(await screen.findByRole('button', { name: /^Gym details/ })).toBeTruthy();
    expect(screen.queryByText(/staff/i)).toBeNull();
    expect(screen.queryByRole('link', { name: /Members/ })).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(orgService.getStaff).not.toHaveBeenCalled();
    expect(orgService.getStaffInvites).not.toHaveBeenCalled();
    expect(orgService.getStaffRoles).not.toHaveBeenCalled();
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
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager', privileges: NO_SETTINGS_POWER }] } });
    drawShell();
    // Members always renders, so waiting on it proves the org resolved before
    // this assertion runs — otherwise "no Settings" would pass on an unfinished
    // read and the test could never fail.
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('is drawn for a manager with the usual permissions: Class bookings is theirs (17c-ii-a)', async () => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager' }] } });
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Settings').length).toBeGreaterThan(0));
  });

  it('is NOT drawn for somebody whose only tick there was the price list: they have Memberships instead (23c-i)', async () => {
    orgService.getMine.mockResolvedValue({
      data: { orgs: [{ ...ORG, staffRole: 'manager', privileges: [...NO_SETTINGS_POWER, 'memberships.manage'] }] },
    });
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Memberships').length).toBeGreaterThan(0));
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
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager', privileges: NO_SETTINGS_POWER }] } });
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Settings')).toBeNull();

    orgService.getMine.mockResolvedValue({
      data: {
        orgs: [
          {
            ...ORG,
            staffRole: 'manager',
            privileges: [...NO_SETTINGS_POWER, 'org.manage'],
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

    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, staffRole: 'manager', privileges: NO_SETTINGS_POWER }] } });
    fireEvent(window, new Event('focus'));

    await waitFor(() => expect(screen.queryByText('Settings')).toBeNull());
    // The rest of the nav is untouched — this must take away one tab, not the
    // console.
    expect(screen.getAllByText('Members').length).toBeGreaterThan(0);
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

  it('saves the postal address and keeps it in the box, from the answer beside the gym', async () => {
    orgService.updateOrg.mockResolvedValue({ data: { org: ORG, postalAddress: '12 High Street, Leeds LS1 1AA' } });
    await openSettings();
    fireEvent.change(screen.getByLabelText('Postal address'), { target: { value: '12 High Street\nLeeds LS1 1AA' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { postalAddress: '12 High Street\nLeeds LS1 1AA' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByLabelText('Postal address').value).toBe('12 High Street, Leeds LS1 1AA');
  });

  it("shows an Indian gym's billing staff the owner's mobile for payments, saves it as typed, and keeps the server's form", async () => {
    const INDIA = { ...ORG, country: 'IN', currencyDisplay: 'INR', timezone: 'Asia/Kolkata', billingMobile: '+919876543210' };
    orgService.getMine.mockResolvedValue({ data: { orgs: [INDIA] } });
    orgService.updateOrg.mockResolvedValue({ data: { org: INDIA, postalAddress: null, billingMobile: '+917012345678' } });
    await openSettings();
    expect(screen.getByLabelText('Mobile number for payments').value).toBe('+919876543210');
    fireEvent.change(screen.getByLabelText('Mobile number for payments'), { target: { value: '70123 45678' } });
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(orgService.updateOrg).toHaveBeenCalledWith(ORG.id, { billingMobile: '+917012345678' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByLabelText('Mobile number for payments').value).toBe('+917012345678');
  });

  it("never draws the mobile box for staff who do not manage billing, nor for a gym outside India", async () => {
    const INDIA = { ...ORG, country: 'IN', currencyDisplay: 'INR', timezone: 'Asia/Kolkata', billingMobile: null };
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...INDIA, staffRole: 'manager', privileges: ['members.read', 'org.manage'] }] } });
    const { unmount } = drawSettings();
    await openSection('Gym details');
    await screen.findByLabelText('Gym name');
    expect(screen.queryByLabelText('Mobile number for payments')).toBeNull();
    unmount();

    orgService.getMine.mockResolvedValue({ data: { orgs: [ORG] } });
    await openSettings();
    expect(screen.queryByLabelText('Mobile number for payments')).toBeNull();
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
  it('start CLOSED, with their headings still saying what they are', async () => {
    drawSettings();
    // The headings are there — a closed screen is a menu, not a row of mystery
    // boxes.
    expect(await screen.findByRole('button', { name: /^Gym details/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^When we're open/ })).toBeTruthy();
    // And what is inside them is not.
    expect(screen.queryByLabelText('Gym name')).toBeNull();
    expect(screen.queryByText(/haven't said when you're open/i)).toBeNull();
  });

  it('says so in a way a screen reader can hear, not only by drawing an arrow', async () => {
    drawSettings();
    const heading = await screen.findByRole('button', { name: /^Gym details/ });
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the one you tap and LEAVES THE OTHERS ALONE', async () => {
    await drawGym();
    expect(screen.getByLabelText('Gym name')).toBeTruthy();
    // Tapping one section must not open every section.
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(1);
  });

  it('closes again on a second tap', async () => {
    await drawGym();
    expect(screen.getByLabelText('Gym name')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Gym details/ }));
    expect(screen.queryByLabelText('Gym name')).toBeNull();
  });

  /** THE ANTI-SILENCE RULE, and it is the reason `forceOpen` exists at all. The
   *  opening hours are read on mount whether the section is open or not, so a failed
   *  read arrives while nobody is looking — and a closed row over an error card
   *  says NOTHING, which is worse than the error (:12660: no reviewer, test or
   *  mutant flags an ABSENT sentence; a person does). */
  it('OPENS ITSELF when its read fails, rather than hiding the error', async () => {
    orgService.getHours.mockRejectedValue(offline());
    drawSettings();
    expect(await screen.findByText(/Couldn't reach the server/i)).toBeTruthy();
    expect(screen.getByText('Try again')).toBeTruthy();
  });

  it('cannot be tapped shut over that error', async () => {
    orgService.getHours.mockRejectedValue(offline());
    drawSettings();
    await screen.findByText(/Couldn't reach the server/i);
    fireEvent.click(screen.getByRole('button', { name: /^When we're open/ }));
    // Still there. A section holding something the owner has to see is not
    // dismissible by the tap that would hide it.
    expect(screen.getByText(/Couldn't reach the server/i)).toBeTruthy();
  });

  /** THE POSITIVE CONTROL for the two above, and without it "always open" would
   *  satisfy them both. A healthy read must still start shut. */
  it('does NOT open itself when its read is fine', async () => {
    drawSettings();
    const heading = await screen.findByRole('button', { name: /^When we're open/ });
    await waitFor(() => expect(orgService.getHours).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Try again')).toBeNull();
  });

  /** T3 ROUND 1, Low-1. Pressing **Try again** cleared the error, which cleared
   *  `forceOpen`, which SHUT THE SECTION UNDER THE CLICK — spinner included,
   *  since the loading arm lives inside the body that had just been unmounted.
   *  An owner saw everything vanish and read it as a broken button. */
  it('STAYS OPEN through a Try again, rather than shutting under the click', async () => {
    orgService.getHours.mockRejectedValueOnce(offline());
    drawSettings();
    fireEvent.click(await screen.findByText('Try again'));
    await waitFor(() => expect(screen.queryByText(/Couldn't reach the server/i)).toBeNull());
    // The section did not close between the error going away and the answer arriving.
    expect(screen.getByRole('button', { name: /^When we're open/ }).getAttribute('aria-expanded')).toBe('true');
  });

  /** And it is then an ordinary open section again: the force is spent, so an
   *  owner can shut it. Without this, "latch it open" would quietly become
   *  "never closes", which is a different defect wearing the fix's clothes. */
  it('can be closed again once the error is gone', async () => {
    orgService.getHours.mockRejectedValueOnce(offline());
    drawSettings();
    fireEvent.click(await screen.findByText('Try again'));
    await waitFor(() => expect(screen.queryByText(/Couldn't reach the server/i)).toBeNull());
    const heading = screen.getByRole('button', { name: /^When we're open/ });
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
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
    orgService.getMine.mockResolvedValue({ data: { orgs: [managerWith(NO_SETTINGS_POWER)] } });
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
    orgService.getMine.mockResolvedValue({ data: { orgs: [managerWith(NO_SETTINGS_POWER)] } });
    drawShell();
    await waitFor(() => expect(screen.getAllByText('Members').length).toBeGreaterThan(0));
    expect(screen.queryByText('Settings')).toBeNull();
  });
});

describe('attendance on Settings', () => {
  // The member's own tap is switched off for every gym (ROADMAP 16c; RULINGS 2026-09-21),
  // so its on/off switch has left this screen: a visit is made at the front desk.
  it.each([true, false])('has no "Marking attendance" switch, whatever the gym once set (%s)', async (manualAttendanceEnabled) => {
    orgService.getMine.mockResolvedValue({ data: { orgs: [{ ...ORG, manualAttendanceEnabled }], formerOrgs: [] } });
    drawSettings();
    // Non-vacuity: Settings drew its other sections for this owner.
    expect(await screen.findByRole('button', { name: /Check-in devices/ })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Marking attendance|mark themselves in|Switched off/i);
    expect(orgService.updateOrg).not.toHaveBeenCalled();
  });
});

// 23b: Overview's Start here list opens Settings at one section. (23a-ii's link to
// Memberships now opens that page.)
describe('a link to one section of Settings', () => {
  const drawAt = (path) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/console/:orgSlug/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>,
    );
  let into;
  let had;

  beforeEach(() => {
    // jsdom draws nothing, so it has no scrollIntoView of its own.
    had = Element.prototype.scrollIntoView;
    into = vi.fn();
    Element.prototype.scrollIntoView = into;
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = had;
  });

  // Staff's is older too since 23c-ii.
  it.each(['memberships', 'staff'])('"#%s", an older address, opens Settings as it is: nothing is moved or opened', async (id) => {
    drawAt(`/console/iron-house/settings#${id}`);
    expect(await screen.findByRole('button', { name: /^Gym details/ })).toBeTruthy();
    expect(document.getElementById(id)).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(into).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { expanded: true })).toEqual([]);
  });

  // 23b: Overview's Start here list opens these two the same way.
  // 23d: a button on another page opens the gym's details, or a box inside them, at that box.
  it.each([
    ['postal-address', 'Postal address'],
    ['country', 'Country'],
  ])('"#%s" opens Gym details with that box itself in view, and no other section', async (id, label) => {
    drawAt(`/console/iron-house/settings#${id}`);
    const heading = await screen.findByRole('button', { name: /^Gym details/ });
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    const details = document.getElementById('gym-details');
    const box = document.getElementById(id);
    expect(details.contains(heading)).toBe(true);
    expect(details.contains(box)).toBe(true);
    expect(box.textContent).toContain(label);
    await waitFor(() => expect(into).toHaveBeenCalled());
    expect(into.mock.instances.every((el) => el === box)).toBe(true);
    const open = screen.getAllByRole('button', { expanded: true }).filter((button) => !details.contains(button));
    expect(open).toEqual([]);
  });

  it.each([
    ['gym-details', /^Gym details/],
    ['follow-up-emails', /^Follow-up emails to leads/],
    ['opening-hours', /^When we're open/],
    ['check-in-devices', /^Check-in devices/],
  ])('"#%s" opens the page with that section open and in view, and no other', async (id, name) => {
    drawAt(`/console/iron-house/settings#${id}`);
    const heading = await screen.findByRole('button', { name });
    const section = document.getElementById(id);
    expect(section.contains(heading)).toBe(true);
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(into).toHaveBeenCalled());
    expect(into.mock.instances.every((el) => el === section)).toBe(true);
    const open = screen.getAllByRole('button', { expanded: true }).filter((button) => !section.contains(button));
    expect(open).toEqual([]);
    // It still folds shut.
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
  });

  it('a link to another section, followed while Settings is already open, opens that section too (23d)', async () => {
    render(
      <MemoryRouter initialEntries={['/console/iron-house/settings#opening-hours']}>
        <Link to="/console/iron-house/settings#follow-up-emails">elsewhere</Link>
        <Routes>
          <Route path="/console/:orgSlug/settings" element={<Settings />} />
        </Routes>
      </MemoryRouter>,
    );
    const hours = await screen.findByRole('button', { name: /^When we're open/ });
    const emails = screen.getByRole('button', { name: /^Follow-up emails to leads/ });
    expect(hours.getAttribute('aria-expanded')).toBe('true');
    expect(emails.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('link', { name: 'elsewhere' }));
    await waitFor(() => expect(emails.getAttribute('aria-expanded')).toBe('true'));
    // The one opened first is left as it was, and the new one still folds shut and stays shut.
    expect(hours.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(emails);
    expect(emails.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(hours);
    expect(hours.getAttribute('aria-expanded')).toBe('false');
    expect(emails.getAttribute('aria-expanded')).toBe('false');
  });

  it('with no section named, every section starts closed and nothing is moved', async () => {
    drawAt('/console/iron-house/settings');
    expect(await screen.findByRole('button', { name: /^Gym details/ })).toBeTruthy();
    expect(screen.queryAllByRole('button', { expanded: true })).toEqual([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(into).not.toHaveBeenCalled();
  });

  it('a section the page does not have moves nothing, and opens nothing', async () => {
    drawAt('/console/iron-house/settings#nowhere');
    expect(await screen.findByRole('button', { name: /^Gym details/ })).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(into).not.toHaveBeenCalled();
    expect(screen.queryAllByRole('button', { expanded: true })).toEqual([]);
  });
});
