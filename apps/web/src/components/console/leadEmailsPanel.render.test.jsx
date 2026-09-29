// Settings → Follow-up emails to leads (ROADMAP 20c-v): what the owner sees, and what
// Save sends. The switch and the address wait for Save together.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
