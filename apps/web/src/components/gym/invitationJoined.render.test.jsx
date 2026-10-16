// What the Join card says once somebody is in. A join can end the gym's free trial (ROADMAP
// Stage 3 item 2d), so "features are on" is said only when the server says they are.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => ({
  ...(await importOriginal()),
  orgService: {
    getInvitations: vi.fn(),
    acceptInvitation: vi.fn(),
    declineInvitation: vi.fn(),
    notMeInvitation: vi.fn(),
  },
}));

const { orgService } = await import('../../api/orgsApi');
const InvitationCard = (await import('./InvitationCard')).default;

const GYM = { id: '7d3f5a10-2b4c-4e6d-8f9a-0b1c2d3e4f5a', name: 'Iron House', city: 'Leeds', orgType: 'gym' };
const INVITATION = { id: 'b0c7c4b0-8f7e-4d6a-9a3b-1f2e3d4c5b6a', state: 'pending', gym: GYM, canTakeMembers: true, notMe: false, yourPlan: null, waiver: null };
const joined = (extra) => ({ data: { outcome: 'joined', gym: { id: GYM.id, slug: 'iron-house', name: 'Iron House', orgType: 'gym' }, ...extra } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the Join card once somebody is in', () => {
  it.each([
    ['the features are on', { featuresOn: true }, "Your gym's features are on."],
    ['an older api says nothing', {}, "Your gym's features are on."],
    ['the join ended the free trial', { featuresOn: false }, "Your gym's features aren't on right now."],
  ])('%s', async (_name, extra, line) => {
    orgService.acceptInvitation.mockResolvedValue(joined(extra));
    render(<InvitationCard invitation={INVITATION} />);
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    expect(await screen.findByText("You're in Iron House.")).toBeTruthy();
    expect(screen.getByText(line)).toBeTruthy();
  });
});
