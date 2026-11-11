// @vitest-environment jsdom
// Overview's Cancelled in the app (ROADMAP 18l): who cancelled in the app, each opening their page; at a gym whose front
// desk lets everyone on its list in, the line saying they can still check in, with the button for whoever may change it
// and who can for whoever may not.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../api/appCancelsApi', () => ({ appCancelsService: svc }));
vi.mock('./liveNews', () => ({ useLiveNews: () => undefined }));
vi.mock('./MemberListPerson', () => ({
  default: ({ entryId, onClose }) => (
    <div role="dialog" aria-label={`person ${entryId}`}>
      <button type="button" onClick={onClose}>
        Close page
      </button>
    </div>
  ),
}));

const { default: AppCancelsCard } = await import('../../components/console/AppCancelsCard');
const { appCancelsHeadline, canSeeAppCancels } = await import('./appCancelsView');

const ENTRY = '11111111-1111-4111-8111-111111111111';
const org = { id: '77777777-7777-4777-8777-777777777777', orgType: 'gym', slug: 'demo' };
const row = (over = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  entryId: ENTRY,
  name: 'Maya Test',
  past: false,
  membershipName: 'Gold Monthly',
  on: '2026-11-11',
  endsOn: '2026-11-30',
  when: 'period_end',
  reason: 'cost',
  ...over,
});
const answer = (rows, over = {}) => ({ count: rows.length, rows, letsEveryoneIn: false, today: '2026-11-12', ...over });

function Settings() {
  return <p data-testid="settings">{window.location.hash}</p>;
}
const draw = (privileges = ['members.confirm']) =>
  render(
    <MemoryRouter initialEntries={['/console/demo']}>
      <Routes>
        <Route path="/console/demo" element={<AppCancelsCard org={org} orgSlug="demo" privileges={privileges} readOnly={false} />} />
        <Route path="/console/demo/settings" element={<Settings />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => svc.list.mockReset());
afterEach(cleanup);

describe('Cancelled in the app', () => {
  it('the headline and who may read it', () => {
    expect(appCancelsHeadline(1)).toBe('1 member cancelled in the app');
    expect(appCancelsHeadline(3)).toBe('3 members cancelled in the app');
    expect(canSeeAppCancels(['members.confirm'])).toBe(true);
    expect(canSeeAppCancels(['billing.members'])).toBe(false);
    expect(canSeeAppCancels(null)).toBe(false);
  });

  it('lists each one with what it was and why, and opens their page', async () => {
    svc.list.mockResolvedValue(answer([row(), row({ id: '33333333-3333-4333-8333-333333333333', entryId: null, name: null, reason: null, when: 'cooling_off', endsOn: '2026-11-11' })], { count: 4 }));
    draw();
    expect((await screen.findByTestId('app-cancels-headline')).textContent).toBe('4 members cancelled in the app');
    expect(screen.getByText('Gold Monthly · Cancelled 11 Nov 2026 · Ends 30 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Reason: Cost')).toBeTruthy();
    expect(screen.getByText('Gold Monthly · Cancelled 11 Nov 2026 · Ended in its cooling-off period')).toBeTruthy();
    expect(screen.getByText('Deleted for good')).toBeTruthy();
    expect(screen.getByText('and 2 more')).toBeTruthy();
    expect(screen.queryByTestId('app-cancels-checkin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: "Open Maya Test's page" }));
    expect(screen.getByRole('dialog', { name: `person ${ENTRY}` })).toBeTruthy();
  });

  it('where everyone on the list is let in, says so, with the button for the owner and who can for others', async () => {
    svc.list.mockResolvedValue(answer([row()], { letsEveryoneIn: true }));
    draw(['members.confirm', 'org.manage']);
    expect(await screen.findByText('Your front desk lets in everyone on your list, so members who cancelled can still check in after their membership ends.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Change who can check in' }).getAttribute('href')).toBe('/console/demo/settings#who-can-check-in');
    cleanup();
    draw(['members.confirm']);
    expect(await screen.findByText('The owner can change who your front desk lets in.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Change who can check in' })).toBeNull();
  });

  it('draws nothing with none, a failed read, or without the member-list tick', async () => {
    svc.list.mockResolvedValue(answer([]));
    const { container } = draw();
    await waitFor(() => expect(svc.list).toHaveBeenCalled());
    expect(container.innerHTML).toBe('');
    cleanup();
    svc.list.mockRejectedValueOnce({ response: { status: 500 } });
    const failed = draw();
    await waitFor(() => expect(svc.list).toHaveBeenCalledTimes(2));
    expect(failed.container.innerHTML).toBe('');
    cleanup();
    svc.list.mockClear();
    const not = draw(['billing.members']);
    expect(not.container.innerHTML).toBe('');
    expect(svc.list).not.toHaveBeenCalled();
  });
});
