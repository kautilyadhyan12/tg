// Overview's "Last 7 days" box (ROADMAP 20d-ii): what it draws from the server's answer,
// and that it draws nothing rather than a nought when there is no answer.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const svc = { get: vi.fn() };
vi.mock('../../api/weekApi', () => ({ weekService: svc }));

const LastSevenDays = (await import('./LastSevenDays')).default;

const GYM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const WEEK = {
  from: '2026-10-05',
  to: '2026-10-11',
  members: { joined: 2, left: 1 },
  atRisk: { count: 3 },
  visits: { thisWeek: 212, weekBefore: 187 },
  paymentDue: { count: 2 },
};
const draw = (gymId = GYM) =>
  render(
    <MemoryRouter>
      <LastSevenDays gymId={gymId} orgSlug="iron-house" orgType="gym" />
    </MemoryRouter>,
  );

beforeEach(() => vi.resetAllMocks());
afterEach(() => cleanup());

describe("Overview's Last 7 days box", () => {
  it('says the days, each figure, and gives each a button to its own page', async () => {
    svc.get.mockResolvedValue(WEEK);
    draw();
    const box = within(await screen.findByTestId('last-7-days'));
    expect(svc.get).toHaveBeenCalledWith(GYM);
    expect(box.getByText('Last 7 days')).toBeTruthy();
    expect(box.getByText('5 Oct to 11 Oct')).toBeTruthy();
    const line = (key) => within(box.getByTestId(`last-7-days-${key}`));
    expect(line('members').getByText('2 new · 1 left')).toBeTruthy();
    expect(line('members').getByRole('link', { name: 'Open Reports' }).getAttribute('href')).toBe('/console/iron-house/reports');
    expect(line('at-risk').getByText('3 members have stopped coming')).toBeTruthy();
    expect(line('at-risk').getByRole('link', { name: 'See who' }).getAttribute('href')).toBe('/console/iron-house/at-risk');
    expect(line('visits').getByText('212 visits')).toBeTruthy();
    expect(line('visits').getByText('187 in the 7 days before')).toBeTruthy();
    expect(line('visits').getByRole('link', { name: 'Open Attendance' }).getAttribute('href')).toBe('/console/iron-house/attendance');
    expect(line('payment-due').getByText('2 members have a payment due')).toBeTruthy();
    expect(line('payment-due').getByRole('link', { name: 'See who' }).getAttribute('href')).toBe('/console/iron-house/members?show=payment-due');
  });

  it('draws only the parts the server sent', async () => {
    svc.get.mockResolvedValue({ ...WEEK, members: null, paymentDue: null });
    draw();
    const box = within(await screen.findByTestId('last-7-days'));
    expect(box.queryByTestId('last-7-days-members')).toBeNull();
    expect(box.queryByTestId('last-7-days-payment-due')).toBeNull();
    expect(box.getByTestId('last-7-days-visits')).toBeTruthy();
    expect(box.queryByText(/payment/i)).toBeNull();
  });

  it('draws nothing with no part to show, and nothing when the read fails', async () => {
    svc.get.mockResolvedValue({ ...WEEK, members: null, atRisk: null, visits: null, paymentDue: null });
    const first = draw();
    await waitFor(() => expect(svc.get).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(screen.queryByTestId('last-7-days')).toBeNull();
    first.unmount();
    svc.get.mockRejectedValue(new Error('offline'));
    draw();
    await waitFor(() => expect(svc.get).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(screen.queryByTestId('last-7-days')).toBeNull();
    expect(document.body.textContent).toBe('');
  });

  it("never draws one gym's figures under another gym", async () => {
    svc.get.mockImplementation((gymId) => (gymId === GYM ? Promise.resolve(WEEK) : new Promise(() => undefined)));
    const drawn = draw();
    await screen.findByTestId('last-7-days');
    drawn.rerender(
      <MemoryRouter>
        <LastSevenDays gymId={OTHER} orgSlug="next-door" orgType="gym" />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('last-7-days')).toBeNull();
    expect(svc.get).toHaveBeenLastCalledWith(OTHER);
  });
});
