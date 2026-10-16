// STAFF ACTIVITY, drawn (ROADMAP 4d). Only the network is mocked: what the owner sees is
// read off the real tab, with the address's who and when held as the page holds them.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

const svc = { list: vi.fn() };
vi.mock('../../api/staffActivityApi', () => ({ staffActivityService: svc }));

const StaffActivity = (await import('./StaffActivity')).default;
const { gymToday } = await import('./hoursView');
const { addDays } = await import('./staffActivityView');

const TZ = 'Asia/Kolkata';
const today = gymToday(TZ);
const OWNER = { userId: '00000000-0000-4000-8000-000000000001', name: 'Kiran Owner', current: true };
const RAVI = { userId: '00000000-0000-4000-8000-000000000002', name: 'Ravi Desk', current: true };
const ANITA = { userId: '00000000-0000-4000-8000-000000000003', name: 'Anita Former', current: false };
const line = (id, day, minute, worker, text) => ({ id, day, minute, workerId: worker.userId, worker: worker.name, line: text });
const answer = (over = {}) => ({ lines: [], next: null, workers: [OWNER, RAVI, ANITA], today, ...over });

function Harness({ start = {}, onInviteStaff = () => undefined }) {
  const [filters, setFilters] = useState({ worker: null, when: 'any', day: null, ...start });
  return <StaffActivity gymId="g1" timezone={TZ} clockFormat="12h" filters={filters} onFilters={setFilters} onInviteStaff={onInviteStaff} />;
}

beforeEach(() => {
  svc.list.mockReset();
});
afterEach(cleanup);

describe('Staff activity tab', () => {
  it('lists each line under its day, with the time and who did it, newest first', async () => {
    svc.list.mockResolvedValue(
      answer({
        lines: [
          line('3', today, 1092, RAVI, 'Removed Priya Shah from the app'),
          line('2', addDays(today, -1), 600, ANITA, 'Changed the price of “Gold monthly” from ₹1,000.00 to ₹1,200.00'),
          line('1', addDays(today, -1), 545, OWNER, 'Added Ravi Desk to the staff as Manager'),
        ],
      }),
    );
    render(<Harness />);
    const days = await screen.findAllByRole('region', { name: /Today|Yesterday/ });
    expect(days.map((d) => d.getAttribute('aria-label'))).toEqual([expect.stringMatching(/^Today · /), expect.stringMatching(/^Yesterday · /)]);
    expect(within(days[0]).getByTestId('activity-line').textContent).toBe('6:12 PMRavi Desk · Removed Priya Shah from the app');
    expect(within(days[1]).getAllByTestId('activity-line').map((l) => l.textContent)).toEqual([
      '10:00 AMAnita Former · Changed the price of “Gold monthly” from ₹1,000.00 to ₹1,200.00',
      '9:05 AMKiran Owner · Added Ravi Desk to the staff as Manager',
    ]);
    expect(svc.list).toHaveBeenCalledWith('g1', { worker: null, from: null, to: null, after: null });
  });

  it('offers everybody in Who, with former staff under their own heading, and asks again for one of them', async () => {
    svc.list.mockResolvedValue(answer({ lines: [line('1', today, 600, OWNER, 'Hid Start here')] }));
    render(<Harness />);
    const who = await screen.findByLabelText('Who');
    await waitFor(() => expect(within(who).getAllByRole('option').map((o) => o.textContent)).toEqual(['Everyone', 'Kiran Owner', 'Ravi Desk', 'Anita Former']));
    expect(who.querySelector('optgroup')?.getAttribute('label')).toBe('No longer on staff');
    fireEvent.change(who, { target: { value: ANITA.userId } });
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith('g1', { worker: ANITA.userId, from: null, to: null, after: null }));
  });

  it('asks for the gym’s own days for each time choice, and waits for a picked day before asking', async () => {
    svc.list.mockResolvedValue(answer({ lines: [line('1', today, 600, OWNER, 'Hid Start here')] }));
    render(<Harness />);
    const when = await screen.findByLabelText('When');
    fireEvent.change(when, { target: { value: '7' } });
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith('g1', { worker: null, from: addDays(today, -6), to: today, after: null }));
    fireEvent.change(when, { target: { value: 'yesterday' } });
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith('g1', { worker: null, from: addDays(today, -1), to: addDays(today, -1), after: null }));
    const calls = svc.list.mock.calls.length;
    fireEvent.change(when, { target: { value: 'day' } });
    expect(await screen.findByText('Choose a day')).toBeTruthy();
    expect(svc.list.mock.calls.length).toBe(calls);
  });

  it('Show more adds the next page under the first, and goes when there is no more', async () => {
    svc.list
      .mockResolvedValueOnce(answer({ lines: [line('2', today, 600, OWNER, 'Hid Start here')], next: 'cursor-1' }))
      .mockResolvedValueOnce(answer({ lines: [line('1', today, 540, RAVI, 'Showed Start here again')], next: null }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(screen.getAllByTestId('activity-line')).toHaveLength(2));
    expect(svc.list).toHaveBeenLastCalledWith('g1', { worker: null, from: null, to: null, after: 'cursor-1' });
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
  });

  it('an empty filter says so and offers to show everything; a gym with no staff is offered Invite staff', async () => {
    const invite = vi.fn();
    svc.list.mockResolvedValueOnce(answer({ workers: [OWNER] })).mockResolvedValue(answer({ workers: [OWNER], lines: [line('1', today, 600, OWNER, 'Set up the gym in the app')] }));
    render(<Harness start={{ worker: OWNER.userId, when: 'today' }} onInviteStaff={invite} />);
    expect((await screen.findByTestId('activity-empty')).textContent).toContain('Nothing here for this person and time.');
    fireEvent.click(screen.getByRole('button', { name: 'Invite staff' }));
    expect(invite).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show everything' }));
    await waitFor(() => expect(svc.list).toHaveBeenLastCalledWith('g1', { worker: null, from: null, to: null, after: null }));
    expect(await screen.findByText('Set up the gym in the app', { exact: false })).toBeTruthy();
  });

  it('a Show more that failed says so under the list, and a new Who or When starts clean', async () => {
    svc.list
      .mockResolvedValueOnce(answer({ lines: [line('2', today, 600, OWNER, 'Hid Start here')], next: 'cursor-1' }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(answer({ lines: [line('3', today, 610, RAVI, 'Showed Start here again')], next: 'cursor-2' }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Who'), { target: { value: RAVI.userId } });
    await screen.findByText('Showed Start here again', { exact: false });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed read says why and tries again', async () => {
    svc.list.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(answer({ lines: [line('1', today, 600, OWNER, 'Hid Start here')] }));
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('activity-line')).toBeTruthy();
  });
});
