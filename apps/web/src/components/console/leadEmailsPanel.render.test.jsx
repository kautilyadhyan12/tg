// Settings → Follow-up emails to leads (ROADMAP 20c-v): what the owner sees, and what
// Save sends. The switch and the address wait for Save together.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LEAD_EMAIL_SETTINGS_WORDS } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: {
      getLeadEmailSettings: vi.fn(),
      updateLeadEmailSettings: vi.fn(),
    },
  };
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'owner@ironhouse.example.com' } }),
}));

const { orgService } = await import('../../api/orgsApi');
const LeadEmailsPanel = (await import('./LeadEmailsPanel')).default;

const ORG = { id: '11111111-1111-1111-1111-111111111111', name: 'Iron House', orgType: 'gym' };
const OFF = { sendForMe: false, replyTo: null, perMonth: 100, usedThisMonth: 0, hasPostalAddress: true, stopped: false, appSending: 'on' };
const answer = (settings) => Promise.resolve({ data: { settings } });

/** Opens the section, which starts closed like its neighbours. */
const open = async () => {
  fireEvent.click(await screen.findByRole('button', { name: /Follow-up emails to leads/ }));
  return await screen.findByRole('checkbox', { name: /Send them for me/ });
};

beforeEach(() => {
  vi.mocked(orgService.getLeadEmailSettings).mockReset();
  vi.mocked(orgService.updateLeadEmailSettings).mockReset();
});
afterEach(cleanup);

describe('Follow-up emails to leads', () => {
  it('the Leads page it names has a button that opens it, for somebody who can; pressing it ticks nothing (23d)', async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer(OFF));
    const drawFor = (privileges) =>
      render(
        <MemoryRouter>
          <LeadEmailsPanel org={{ ...ORG, slug: 'iron-house', privileges }} readOnly={false} />
        </MemoryRouter>,
      );
    drawFor(['org.manage', 'members.confirm']);
    const box = await open();
    expect(screen.getByText(/the rest wait for you on the Leads page/)).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Open Leads' });
    expect(link.getAttribute('href')).toBe('/console/iron-house/leads');
    // Outside the tick's own label, so it cannot switch "Send them for me".
    expect(link.closest('label')).toBeNull();
    expect(box.checked).toBe(false);
    // With a change here not saved, the press asks before it leaves; Stay here keeps the change.
    fireEvent.click(box);
    expect(screen.queryByRole('link', { name: 'Open Leads' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Leads' }));
    expect(screen.getByRole('link', { name: 'Leave this page' }).getAttribute('href')).toBe('/console/iron-house/leads');
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(box.checked).toBe(true);
    expect(orgService.updateLeadEmailSettings).not.toHaveBeenCalled();
    cleanup();
    // Somebody who changes the gym's details and cannot open Leads is not sent there.
    drawFor(['org.manage']);
    await open();
    expect(screen.queryByRole('link', { name: 'Open Leads' })).toBeNull();
  });

  it("is off until the owner turns it on; ticking it fills in their own address, and Save sends both", async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer(OFF));
    vi.mocked(orgService.updateLeadEmailSettings).mockReturnValue(answer({ ...OFF, sendForMe: true, replyTo: 'owner@ironhouse.example.com' }));
    render(<LeadEmailsPanel org={ORG} readOnly={false} />);
    const box = await open();
    expect(box.checked).toBe(false);
    expect(screen.getByText(/They come from “Iron House via AI Home Gym”/)).toBeTruthy();
    expect(screen.getByText('0 of 100 new leads emailed for you this month.')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save.disabled).toBe(true);

    fireEvent.click(box);
    expect(screen.getByLabelText('Replies go to').value).toBe('owner@ironhouse.example.com');
    // Nothing is sent until Save.
    expect(orgService.updateLeadEmailSettings).not.toHaveBeenCalled();
    fireEvent.click(save);
    await waitFor(() =>
      expect(orgService.updateLeadEmailSettings).toHaveBeenCalledWith(ORG.id, { sendForMe: true, replyTo: 'owner@ironhouse.example.com' }),
    );
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('cannot be switched on without the postal address, and says why', async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer({ ...OFF, hasPostalAddress: false }));
    render(<LeadEmailsPanel org={ORG} readOnly={false} />);
    fireEvent.click(await open());
    expect(screen.getByText(LEAD_EMAIL_SETTINGS_WORDS.needs_postal_address)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });

  it("an emptied reply address stops Save while it is on; a stopped gym is told its emails don't go", async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer({ ...OFF, sendForMe: true, replyTo: 'desk@ironhouse.example.com', stopped: true, usedThisMonth: 37 }));
    render(<LeadEmailsPanel org={ORG} readOnly={false} />);
    await open();
    expect(screen.getByText(LEAD_EMAIL_SETTINGS_WORDS.sending_stopped)).toBeTruthy();
    expect(screen.getByText('37 of 100 new leads emailed for you this month.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Replies go to'), { target: { value: '' } });
    expect(screen.getByText('Add the email address replies should go to.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });

  it('says so when emails through the app are paused, or not set up', async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer({ ...OFF, sendForMe: true, replyTo: 'desk@ironhouse.example.com', appSending: 'paused' }));
    render(<LeadEmailsPanel org={ORG} readOnly={false} />);
    await open();
    expect(screen.getByText(LEAD_EMAIL_SETTINGS_WORDS.paused)).toBeTruthy();
    cleanup();

    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer({ ...OFF, appSending: 'off' }));
    render(<LeadEmailsPanel org={ORG} readOnly={false} />);
    fireEvent.click(await open());
    expect(screen.getByText(LEAD_EMAIL_SETTINGS_WORDS.invites_off)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
  });

  it("a lapsed gym sees the box and can't change it", async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer(OFF));
    render(<LeadEmailsPanel org={ORG} readOnly />);
    const box = await open();
    expect(box.disabled).toBe(true);
    expect(screen.getByLabelText('Replies go to').disabled).toBe(true);
  });

  it('a failed read says so and offers to try again, never a switched-off box', async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValueOnce(Promise.reject(new Error('network'))).mockReturnValueOnce(answer(OFF));
    render(<LeadEmailsPanel org={ORG} readOnly={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('checkbox', { name: /Send them for me/ })).toBeTruthy();
  });
});

// 23d-ii: the two sentences that need the gym's details changed have the button to that box,
// which is on this same page.
describe('what stops "Send them for me" has the button to its box', () => {
  const OWNER_ORG = { ...ORG, slug: 'iron-house', staffRole: 'owner' };
  const drawOwner = () =>
    render(
      <MemoryRouter>
        <LeadEmailsPanel org={OWNER_ORG} readOnly={false} />
      </MemoryRouter>,
    );

  it('no postal address: Add your postal address opens that box', async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer({ ...OFF, hasPostalAddress: false }));
    drawOwner();
    const box = await open();
    expect(screen.queryByRole('link', { name: 'Add your postal address' })).toBeNull();
    fireEvent.click(box);
    expect(screen.getByText('Add your postal address first. The law asks for it at the foot of these emails.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add your postal address' }).getAttribute('href')).toBe('/console/iron-house/settings#postal-address');
  });

  it('once the address is saved higher up the page, the sentence goes and Save comes on, with the tick and the typed address kept', async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValueOnce(answer({ ...OFF, hasPostalAddress: false }));
    const draw = (org) => (
      <MemoryRouter>
        <LeadEmailsPanel org={org} readOnly={false} />
      </MemoryRouter>
    );
    const { rerender } = render(draw(OWNER_ORG));
    const box = await open();
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText('Replies go to'), { target: { value: 'desk@ironhouse.example' } });
    expect(screen.getByRole('link', { name: 'Add your postal address' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(true);
    // Gym details saves: the console's fresh copy of the gym arrives.
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValueOnce(answer({ ...OFF, hasPostalAddress: true }));
    rerender(draw({ ...OWNER_ORG }));
    await waitFor(() => expect(screen.queryByText(/Add your postal address first/)).toBeNull());
    expect(screen.queryByRole('link', { name: 'Add your postal address' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save changes' }).disabled).toBe(false);
    expect(box.checked).toBe(true);
    expect(screen.getByLabelText('Replies go to').value).toBe('desk@ironhouse.example');
    expect(orgService.getLeadEmailSettings).toHaveBeenCalledTimes(2);
  });

  it('a reply address that is missing is a reason of its own: no button to another box', async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer(OFF));
    drawOwner();
    fireEvent.click(await open());
    fireEvent.change(screen.getByLabelText('Replies go to'), { target: { value: '' } });
    expect(screen.getByText('Add the email address replies should go to.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Add your postal address' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open Gym details' })).toBeNull();
  });

  it("a save refused for the gym's name: Open Gym details; another refusal has no button", async () => {
    vi.mocked(orgService.getLeadEmailSettings).mockReturnValue(answer(OFF));
    const refused = (error, message) => Object.assign(new Error('refused'), { response: { status: 409, data: { error, message } } });
    vi.mocked(orgService.updateLeadEmailSettings).mockRejectedValueOnce(refused('gym_name', LEAD_EMAIL_SETTINGS_WORDS.gym_name));
    drawOwner();
    fireEvent.click(await open());
    fireEvent.change(screen.getByLabelText('Replies go to'), { target: { value: 'desk@ironhouse.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText("An email can't show your gym's name as it is written. Change it to the name in words first.")).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Gym details' }).getAttribute('href')).toBe('/console/iron-house/settings#gym-details');

    vi.mocked(orgService.updateLeadEmailSettings).mockRejectedValueOnce(refused('rate_limited', 'Too many changes. Try again shortly.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Too many changes. Try again shortly.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open Gym details' })).toBeNull();
  });
});
