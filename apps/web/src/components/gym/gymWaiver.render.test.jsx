// A gym's waiver as a person meets it (ROADMAP 3e-i): on the Join card, and on their gym's
// card in My Gyms.
//
// The worst thing these screens could do: send a signature for words the person was not
// shown, or without their name and their tick. So Join and Sign wait for both, the id sent
// is the one drawn, and words that changed underneath are drawn again unticked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WAIVER_AGREE_LABEL } from '@app/shared';

vi.mock('../../api/orgsApi', async (importOriginal) => ({
  ...(await importOriginal()),
  orgService: {
    getInvitations: vi.fn(),
    acceptInvitation: vi.fn(),
    declineInvitation: vi.fn(),
    notMeInvitation: vi.fn(),
    getMyWaiver: vi.fn(),
    signMyWaiver: vi.fn(),
  },
}));

const { orgService } = await import('../../api/orgsApi');
const InvitationCard = (await import('./InvitationCard')).default;
const GymWaiverNote = (await import('./GymWaiverNote')).default;

const GYM = { id: '7d3f5a10-2b4c-4e6d-8f9a-0b1c2d3e4f5a', name: 'Iron House', city: 'Leeds', orgType: 'gym' };
const V1 = { id: '22222222-2222-4222-8222-000000000001', version: 1, text: 'RELEASE\n\n1. I take part at my own risk.' };
const V2 = { id: '22222222-2222-4222-8222-000000000002', version: 2, text: `${V1.text}\n2. I follow staff instructions.` };
const INVITATION = { id: 'b0c7c4b0-8f7e-4d6a-9a3b-1f2e3d4c5b6a', state: 'pending', gym: GYM, canTakeMembers: true, notMe: false, yourPlan: null, waiver: V1 };
const JOINED = { outcome: 'joined', gym: { id: GYM.id, slug: 'iron-house', name: 'Iron House', orgType: 'gym' } };
const refusal = (error, message) => ({ response: { status: 409, data: { error, message } } });

const words = () => screen.getByRole('region', { name: "Iron House's waiver" });
const nameBox = () => screen.getByLabelText('Your full name');
const tick = () => screen.getByLabelText(WAIVER_AGREE_LABEL);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Join card at a gym with a waiver', () => {
  const join = () => screen.getByRole('button', { name: 'Join' });

  it('shows the gym\'s words in full, and Join waits for a name and the tick, saying so', () => {
    render(<InvitationCard invitation={INVITATION} />);
    expect(words().textContent).toBe(V1.text);
    expect(join().disabled).toBe(true);
    expect(screen.getByText('To join, type your full name and tick the box.')).toBeTruthy();
    fireEvent.change(nameBox(), { target: { value: 'Alice Stone' } });
    expect(join().disabled).toBe(true);
    fireEvent.click(tick());
    expect(join().disabled).toBe(false);
    expect(screen.queryByText('To join, type your full name and tick the box.')).toBeNull();
    // The tick alone is not a signature either.
    fireEvent.change(nameBox(), { target: { value: ' ' } });
    expect(join().disabled).toBe(true);
    expect(orgService.acceptInvitation).not.toHaveBeenCalled();
    // No thanks never waits for the waiver.
    expect(screen.getByRole('button', { name: 'No thanks' }).disabled).toBe(false);
  });

  it('Join sends the wording drawn and the name typed', async () => {
    orgService.acceptInvitation.mockResolvedValue({ data: JOINED });
    const onAnswered = vi.fn();
    render(<InvitationCard invitation={INVITATION} onAnswered={onAnswered} />);
    fireEvent.change(nameBox(), { target: { value: 'Alice Stone' } });
    fireEvent.click(tick());
    fireEvent.click(join());
    await waitFor(() => expect(orgService.acceptInvitation).toHaveBeenCalledWith(INVITATION.id, { id: V1.id, name: 'Alice Stone' }));
    expect(await screen.findByText("You're in Iron House.")).toBeTruthy();
    expect(onAnswered).toHaveBeenCalledWith({ kind: 'joined', invitationId: INVITATION.id });
  });

  it('words the gym changed meanwhile are drawn again, unticked, with the reason; the next Join sends the new wording', async () => {
    orgService.acceptInvitation.mockRejectedValueOnce(refusal('waiver_changed', 'Iron House has changed its waiver. Read the new one below, then agree to it.'));
    orgService.getInvitations.mockResolvedValue({ data: { address: 'alice@example.com', addressProved: true, invitations: [{ ...INVITATION, waiver: V2 }] } });
    render(<InvitationCard invitation={INVITATION} />);
    fireEvent.change(nameBox(), { target: { value: 'Alice Stone' } });
    fireEvent.click(tick());
    fireEvent.click(join());
    expect(await screen.findByText('Iron House has changed its waiver. Read the new one below, then agree to it.')).toBeTruthy();
    await waitFor(() => expect(words().textContent).toBe(V2.text));
    expect(tick().checked).toBe(false);
    expect(join().disabled).toBe(true);
    orgService.acceptInvitation.mockResolvedValueOnce({ data: JOINED });
    fireEvent.click(tick());
    fireEvent.click(join());
    await waitFor(() => expect(orgService.acceptInvitation).toHaveBeenLastCalledWith(INVITATION.id, { id: V2.id, name: 'Alice Stone' }));
  });

  it('a gym that wrote its first waiver meanwhile: the Join pressed is refused and the waiver appears', async () => {
    orgService.acceptInvitation.mockRejectedValueOnce(refusal('waiver_needed', "Read Iron House's waiver, type your full name and tick the box to agree."));
    orgService.getInvitations.mockResolvedValue({ data: { address: 'alice@example.com', addressProved: true, invitations: [INVITATION] } });
    render(<InvitationCard invitation={{ ...INVITATION, waiver: null }} />);
    expect(screen.queryByLabelText('Your full name')).toBeNull();
    fireEvent.click(join());
    await waitFor(() => expect(orgService.acceptInvitation).toHaveBeenCalledWith(INVITATION.id, null));
    await waitFor(() => expect(words().textContent).toBe(V1.text));
    expect(join().disabled).toBe(true);
  });

  it('a gym with no waiver joins on the one tap, as before', async () => {
    orgService.acceptInvitation.mockResolvedValue({ data: JOINED });
    render(<InvitationCard invitation={{ ...INVITATION, waiver: null }} />);
    expect(screen.queryByText(/waiver/i)).toBeNull();
    fireEvent.click(join());
    await waitFor(() => expect(orgService.acceptInvitation).toHaveBeenCalledWith(INVITATION.id, null));
  });

  it('a gym that cannot take members shows no waiver to sign', () => {
    render(<InvitationCard invitation={{ ...INVITATION, canTakeMembers: false }} />);
    expect(screen.queryByLabelText('Your full name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
  });
});

describe("a member's own gym", () => {
  const draw = () => render(<GymWaiverNote gym={GYM} />);
  const mine = (waiver, signed = null) => orgService.getMyWaiver.mockResolvedValue({ data: { gymName: 'Iron House', waiver, signed } });

  it('draws nothing where the gym asks for no waiver', async () => {
    mine(null);
    const { container } = draw();
    await waitFor(() => expect(orgService.getMyWaiver).toHaveBeenCalledWith(GYM.id));
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('asks somebody who has not signed, opens the waiver under the button, and Sign waits for a name and the tick', async () => {
    mine(V1);
    draw();
    expect(await screen.findByText('Iron House asks you to read and sign its waiver.')).toBeTruthy();
    expect(screen.queryByLabelText('Your full name')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read and sign' }));
    expect(words().textContent).toBe(V1.text);
    const sign = screen.getByRole('button', { name: 'Sign' });
    expect(sign.disabled).toBe(true);
    expect(screen.getByText('Type your full name and tick the box to sign.')).toBeTruthy();
    fireEvent.click(tick());
    expect(sign.disabled).toBe(true);
    fireEvent.change(nameBox(), { target: { value: 'Mia Hart' } });
    expect(sign.disabled).toBe(false);
    expect(orgService.signMyWaiver).not.toHaveBeenCalled();
  });

  it('Sign sends the wording drawn and the name typed, and says what happened in the same place', async () => {
    mine(V1);
    orgService.signMyWaiver.mockResolvedValue({ data: { signed: { name: 'Mia Hart', at: '2026-10-13T09:00:00.000Z' } } });
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Read and sign' }));
    fireEvent.change(nameBox(), { target: { value: 'Mia Hart' } });
    fireEvent.click(tick());
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    await waitFor(() => expect(orgService.signMyWaiver).toHaveBeenCalledWith(GYM.id, V1.id, 'Mia Hart'));
    expect((await screen.findByRole('status')).textContent).toBe("Thank you. You signed Iron House's waiver on 13 October 2026 as Mia Hart.");
    expect(screen.queryByRole('button', { name: 'Sign' })).toBeNull();
  });

  it('Not now closes the waiver and leaves the ask and its button', async () => {
    mine(V1);
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Read and sign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByLabelText('Your full name')).toBeNull();
    expect(screen.getByText('Iron House asks you to read and sign its waiver.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read and sign' })).toBeTruthy();
  });

  it('words the gym changed meanwhile are read again and drawn unticked, with the reason', async () => {
    mine(V1);
    orgService.signMyWaiver.mockRejectedValue(refusal('waiver_changed', 'Iron House has changed its waiver. Read the new one below, then agree to it.'));
    draw();
    fireEvent.click(await screen.findByRole('button', { name: 'Read and sign' }));
    fireEvent.change(nameBox(), { target: { value: 'Mia Hart' } });
    fireEvent.click(tick());
    mine(V2);
    fireEvent.click(screen.getByRole('button', { name: 'Sign' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Iron House has changed its waiver. Read the new one below, then agree to it.');
    await waitFor(() => expect(words().textContent).toBe(V2.text));
    expect(tick().checked).toBe(false);
    expect(screen.getByRole('button', { name: 'Sign' }).disabled).toBe(true);
  });

  it('somebody who has signed reads when and under what name, and can read the words again', async () => {
    mine(V1, { name: 'Mia Hart', at: '2026-10-13T09:00:00.000Z' });
    draw();
    expect(await screen.findByText('Waiver signed on 13 October 2026 as Mia Hart.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read and sign' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Read the waiver' }));
    expect(words().textContent).toBe(V1.text);
    expect(within(words()).queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the waiver' }));
    expect(screen.queryByRole('region', { name: "Iron House's waiver" })).toBeNull();
  });

  it('a read that fails says so, never that there is nothing to sign, and Try again reads it', async () => {
    orgService.getMyWaiver.mockRejectedValueOnce({ response: { status: 500, data: {} } }).mockResolvedValueOnce({ data: { gymName: 'Iron House', waiver: V1, signed: null } });
    draw();
    expect(await screen.findByText(/We couldn't check whether Iron House has a waiver for you to sign\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Read and sign' })).toBeTruthy();
  });
});
