// Download member list in the plan box a gym with no plan cannot skip (ROADMAP Stage 4
// item 14): who sees it, and that it downloads everyone, current and past.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import ListDownload from './ListDownload';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    orgService: { getMemberList: vi.fn(), selectAllMembers: vi.fn(), downloadMembersCsv: vi.fn() },
  };
});
const { orgService } = await import('../../api/orgsApi');

const OWNER = { id: '11111111-1111-4111-8111-111111111111', orgType: 'gym', staffRole: 'owner' };
const listOf = (entries, former = 0) => ({ data: { list: { counts: { entries, former, inApp: 0, canBeInvited: 0, noEmail: 0 } } } });

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
  orgService.selectAllMembers.mockResolvedValue({ data: { selection: { count: 2, digest: 'd' } } });
  orgService.downloadMembersCsv.mockResolvedValue({ blob: new Blob(['x']), filename: 'members.csv' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Download member list in the plan box', () => {
  it('downloads everyone on the list, current and past, and says so', async () => {
    orgService.getMemberList.mockResolvedValue(listOf(1, 1));
    render(<ListDownload org={OWNER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download member list' }));
    await waitFor(() => expect(orgService.downloadMembersCsv).toHaveBeenCalledTimes(1));
    expect(orgService.selectAllMembers).toHaveBeenCalledWith(OWNER.id, { records: 'all' });
    expect(orgService.downloadMembersCsv).toHaveBeenCalledWith(OWNER.id, { kind: 'all', filter: { records: 'all' }, count: 2, digest: 'd' });
    expect((await screen.findByRole('status')).textContent).toBe('Your member list was downloaded.');
  });

  it('a studio reads its own word', async () => {
    orgService.getMemberList.mockResolvedValue(listOf(3));
    render(<ListDownload org={{ ...OWNER, orgType: 'studio' }} />);
    expect(await screen.findByRole('button', { name: 'Download client list' })).toBeTruthy();
  });

  it('is not there with nobody on the list, for staff who may not read it, or when the list cannot be read', async () => {
    orgService.getMemberList.mockResolvedValue(listOf(0));
    render(<ListDownload org={OWNER} />);
    await waitFor(() => expect(orgService.getMemberList).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    orgService.getMemberList.mockClear();
    render(<ListDownload org={{ ...OWNER, staffRole: 'trainer', privileges: ['members.read'] }} />);
    expect(orgService.getMemberList).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    orgService.getMemberList.mockRejectedValue(new Error('x'));
    render(<ListDownload org={OWNER} />);
    await waitFor(() => expect(orgService.getMemberList).toHaveBeenCalled());
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a failed download says so in a sentence', async () => {
    orgService.getMemberList.mockResolvedValue(listOf(2));
    orgService.downloadMembersCsv.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 500, data: {} } }));
    render(<ListDownload org={OWNER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download member list' }));
    expect((await screen.findByRole('status')).textContent).toBe("We couldn't download the file. Please try again.");
  });
  it('says when and why the list was deleted, where the download would be', async () => {
    orgService.getMemberList.mockResolvedValue({ data: { list: { counts: { entries: 0, former: 0 }, goneForGoodDeletedAt: '2030-07-09T20:00:00.000Z' } } });
    render(<ListDownload org={{ ...OWNER, timezone: 'Asia/Kolkata' }} />);
    expect((await screen.findByTestId('plan-gone-for-good')).textContent).toBe('Your list was deleted on 10 Jul 2030 because your gym had no paid plan and nobody signed in for 6 months.');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
