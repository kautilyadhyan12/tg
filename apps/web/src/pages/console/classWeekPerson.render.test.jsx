// A PERSON OPENED FROM A CLASS ON THE CALENDAR (ROADMAP 17c-iii): what the Calendar hands
// the person's page. The page itself is mocked here, so its props are what is read: a
// viewer without the remove tick, or a gym that can only read, must reach it as such.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const api = { getClassWeek: vi.fn(), getClassBookings: vi.fn(), getMemberList: vi.fn() };
vi.mock('../../api/orgsApi', async (importOriginal) => ({ ...(await importOriginal()), orgService: api }));
const page = vi.fn(() => <div role="dialog" />);
vi.mock('./MemberListPerson', () => ({ default: (props) => page(props) }));

const ClassWeek = (await import('./ClassWeek')).default;

const MAYA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LIST = { fields: [{ key: 'locker', label: 'Locker' }] };
const SPIN = {
  id: 'x1', classTypeId: 't1', scheduleId: 's1', name: 'Spin', colour: 'teal', openGym: false, localDate: '2026-09-22', startMinute: 1080,
  startsAt: '2026-09-22T17:00:00.000Z', minutes: 45, places: 12, coachUserId: null, coachName: null, status: 'scheduled', changedAlone: false, started: false,
};
const org = (privileges) => ({ id: 'g1', slug: 'iron-house', name: 'Iron House', orgType: 'studio', timezone: 'Europe/London', clockFormat: '24h', staffRole: 'manager', privileges });

beforeEach(() => {
  page.mockClear();
  api.getClassWeek.mockReset().mockResolvedValue({
    data: { timezone: 'Europe/London', clockFormat: '24h', today: '2026-09-22', weekStart: '2026-09-21', lastWeekStart: '2026-11-09', sessions: [SPIN] },
  });
  api.getClassBookings.mockReset().mockResolvedValue({
    data: {
      sessionId: '00000000-0000-4000-8000-0000000000aa', className: 'Spin', startsAt: SPIN.startsAt, cancelled: false, places: 12,
      booked: [{ bookingId: '00000000-0000-4000-8000-000000000101', name: 'Maya Shah', initials: 'MS', status: 'booked', membership: null, packCharged: null, entryId: MAYA, at: '2026-09-20T09:00:00.000Z' }],
      waitlisted: [], lateCancelled: [], lateCancelledTotal: 0,
    },
  });
  api.getMemberList.mockReset().mockResolvedValue({ data: { list: LIST } });
});
afterEach(cleanup);

const openMaya = async (viewer, readOnly) => {
  render(<ClassWeek gymId="g1" org={viewer} readOnly={readOnly} staff={[]} locked={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Spin on Tue 22 Sep 2026 at 18:00' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Maya Shah' }));
  await screen.findByRole('dialog');
  // The gym's own columns arrive a moment after the page opens.
  await vi.waitFor(() => expect(page.mock.lastCall[0].list).toEqual(LIST));
  return page.mock.lastCall[0];
};

describe("the person's page opened from a class", () => {
  it('is handed the person, the gym and its words, and may remove only where the viewer holds that tick', async () => {
    const viewer = org(['members.read', 'members.confirm', 'members.remove', 'schedule.manage']);
    const props = await openMaya(viewer, false);
    expect(props).toMatchObject({ gymId: 'g1', gym: viewer, entryId: MAYA, readOnly: false, canRemove: true });
    expect(props.words.it).toBe('studio');
  });

  it('a viewer without the remove tick, in a gym that can only read, reaches it as exactly that', async () => {
    const props = await openMaya(org(['members.read', 'members.confirm', 'schedule.manage']), true);
    expect(props).toMatchObject({ entryId: MAYA, readOnly: true, canRemove: false });
  });
});
