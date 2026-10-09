// SETTINGS → HOW MEMBERS REACH YOU, drawn (ROADMAP 20a-iii). Only the network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GYM_CONTACT_WORDS } from '@app/shared';

const updateOrg = vi.fn();
const refresh = vi.fn();
vi.mock('../../api/orgsApi', () => ({
  orgService: { updateOrg },
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
}));
vi.mock('./consoleOrgs', () => ({ refreshConsoleOrgsAfterChange: refresh }));

const MemberContactPanel = (await import('../../components/console/MemberContactPanel')).default;

const ORG = { id: 'g1', slug: 'iron-house', name: 'Iron House', orgType: 'gym', contactPhone: null, contactEmail: null, billingMobile: '+919876543210' };
const answer = (contactPhone, contactEmail) => ({ data: { org: ORG, contactPhone, contactEmail } });
const draw = (org = ORG, props = {}) => render(<MemberContactPanel org={org} readOnly={false} startOpen {...props} />);
const phone = () => screen.getByLabelText('Phone number');
const email = () => screen.getByLabelText('Email address');
const save = () => screen.getByRole('button', { name: 'Save changes' });

beforeEach(() => {
  updateOrg.mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

describe('How members reach you', () => {
  it('opens empty for a gym that added neither, says who will see them, and shows no number the gym did not type here', () => {
    draw();
    expect(screen.getByText('How members reach you')).toBeTruthy();
    expect(screen.getByText('Not added yet. Your members have no phone number or email for you in the app.')).toBeTruthy();
    expect(screen.getByText(/Your members see these in the app: in their Inbox, under "Contact the gym"\./)).toBeTruthy();
    expect([phone().value, email().value]).toEqual(['', '']);
    expect(document.body.textContent).not.toContain('9876543210');
    expect(save().disabled).toBe(true);
  });

  it("saves what was typed, puts the server's own form back in the boxes, and tells the rest of the console", async () => {
    updateOrg.mockResolvedValue(answer('(212) 555-0123', 'desk@ironhouse.com'));
    draw();
    fireEvent.change(phone(), { target: { value: ' (212)  555-0123' } });
    fireEvent.change(email(), { target: { value: 'desk@ironhouse.com' } });
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(updateOrg).toHaveBeenCalledTimes(1);
    expect(updateOrg).toHaveBeenCalledWith('g1', { contactPhone: '(212)  555-0123', contactEmail: 'desk@ironhouse.com' });
    expect([phone().value, email().value]).toEqual(['(212) 555-0123', 'desk@ironhouse.com']);
    expect(screen.getByText('(212) 555-0123 · desk@ironhouse.com')).toBeTruthy();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(save().disabled).toBe(true);
  });

  it('sends only the box that changed, and null for one that was emptied', async () => {
    updateOrg.mockResolvedValue(answer('020 7946 0958', null));
    draw({ ...ORG, contactPhone: '020 7946 0958', contactEmail: 'desk@ironhouse.com' });
    expect([phone().value, email().value]).toEqual(['020 7946 0958', 'desk@ironhouse.com']);
    fireEvent.change(email(), { target: { value: '' } });
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(updateOrg).toHaveBeenCalledWith('g1', { contactEmail: null });
  });

  it('says what is wrong with a phone number or an email as it is typed, and asks the server nothing', () => {
    draw();
    fireEvent.change(phone(), { target: { value: 'ask at the desk' } });
    expect(screen.getByRole('alert').textContent).toBe(GYM_CONTACT_WORDS.bad_contact_phone);
    expect(save().disabled).toBe(true);
    fireEvent.change(phone(), { target: { value: '020 7946 0958' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(email(), { target: { value: 'ironhouse.com' } });
    expect(screen.getByRole('alert').textContent).toBe(GYM_CONTACT_WORDS.bad_contact_email);
    fireEvent.submit(save().closest('form'));
    expect(updateOrg).not.toHaveBeenCalled();
  });

  it("shows the server's own sentence when it refuses, keeps what was typed, and Save is the retry", async () => {
    updateOrg.mockRejectedValueOnce({ response: { data: { message: "Your gym isn't on a plan, so nothing can be changed." } } });
    updateOrg.mockResolvedValue(answer('020 7946 0958', null));
    draw();
    fireEvent.change(phone(), { target: { value: '020 7946 0958' } });
    fireEvent.click(save());
    expect(await screen.findByText("Your gym isn't on a plan, so nothing can be changed.")).toBeTruthy();
    expect(phone().value).toBe('020 7946 0958');
    expect(refresh).not.toHaveBeenCalled();
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(updateOrg).toHaveBeenCalledTimes(2);
  });

  it('one press, one request, however many times the form is submitted', async () => {
    let done;
    updateOrg.mockReturnValue(
      new Promise((resolve) => {
        done = resolve;
      }),
    );
    draw();
    fireEvent.change(phone(), { target: { value: '020 7946 0958' } });
    const form = save().closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(updateOrg).toHaveBeenCalledTimes(1);
    done(answer('020 7946 0958', null));
    await screen.findByText('Saved.');
  });

  it('a gym with no live plan reads why, and its boxes and Save are greyed', () => {
    draw({ ...ORG, contactPhone: '020 7946 0958' }, { readOnly: true });
    expect(phone().disabled).toBe(true);
    expect(email().disabled).toBe(true);
    expect(save().disabled).toBe(true);
    fireEvent.submit(save().closest('form'));
    expect(updateOrg).not.toHaveBeenCalled();
  });

  it('follows the gym when the console reads it again, and keeps what somebody is part-way through typing', async () => {
    const { rerender } = draw();
    rerender(<MemberContactPanel org={{ ...ORG, contactPhone: '020 7946 0958' }} readOnly={false} startOpen />);
    await waitFor(() => expect(phone().value).toBe('020 7946 0958'));
    fireEvent.change(email(), { target: { value: 'desk@iron' } });
    rerender(<MemberContactPanel org={{ ...ORG, contactPhone: '020 7946 0959' }} readOnly={false} startOpen />);
    expect(email().value).toBe('desk@iron');
    expect(phone().value).toBe('020 7946 0958');
  });

  it('a studio reads its own words', () => {
    draw({ ...ORG, orgType: 'studio' });
    expect(screen.getByText('How clients reach you')).toBeTruthy();
    expect(screen.getByText(/under "Contact the studio"/)).toBeTruthy();
  });
});
