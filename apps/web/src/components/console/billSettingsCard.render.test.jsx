// The Bills box on the Memberships page (ROADMAP 18a-i; the billing day, 18y): the day is picked,
// said with a real date, and waits for Save; staff without the payments tick read it only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../api/orgsApi', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, orgService: { getBillSettings: vi.fn(), saveBillSettings: vi.fn() } };
});

const { orgService } = await import('../../api/orgsApi');
const BillSettingsCard = (await import('./BillSettingsCard')).default;

const GYM = '11111111-1111-4111-8111-111111111111';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the billing day on the Bills box', () => {
  it('picked, said with a real date, and saved with the grace as it is', async () => {
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 3, billDay: null, canChange: true } });
    orgService.saveBillSettings.mockResolvedValue({ data: { overdueAfterDays: 3, billDay: 1, canChange: true } });
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    const select = await screen.findByTestId('bill-day');
    expect(select.value).toBe('');
    expect(screen.getByText('Each membership is billed on the day of the month it started.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);

    fireEvent.change(select, { target: { value: '1' } });
    expect(screen.getByText(/Somebody who joins on 20 Mar pays for 20 Mar to 31 Mar first, then the full price on the 1st: each month for a monthly membership, each year for a yearly one\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.saveBillSettings).toHaveBeenCalledWith(GYM, { overdueAfterDays: 3, billDay: 1 }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('the freeze fee (18z): typed, said with a real date, saved; a typo is refused with nothing sent', async () => {
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 0, billDay: null, freezeFeeMinor: 0, currency: 'USD', canChange: true } });
    orgService.saveBillSettings.mockResolvedValue({ data: { overdueAfterDays: 0, billDay: null, freezeFeeMinor: 1000, currency: 'USD', canChange: true } });
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    const box = await screen.findByTestId('freeze-fee');
    expect(box.value).toBe('0');
    expect(screen.getByText(/^Charged each month a membership is frozen/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);

    fireEvent.change(box, { target: { value: '10' } });
    expect(screen.getByText(/^A member frozen on 5 March is charged \$10\.00 that day, then on 5 April, and so on until they are unfrozen\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.saveBillSettings).toHaveBeenCalledWith(GYM, { overdueAfterDays: 0, billDay: null, freezeFeeMinor: 1000 }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(box.value).toBe('10.00');

    fireEvent.change(box, { target: { value: '1.2.3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Type the freeze fee as an amount, or 0 for no fee.')).toBeTruthy();
    expect(orgService.saveBillSettings).toHaveBeenCalledTimes(1);
  });

  it('the reminder before a card expires (18d-iii-c): ticked, it lists who is emailed and who is not, and waits for Save', async () => {
    const person = (n, outcome) => ({ entryId: `00000000-0000-4000-8000-00000000000${String(n)}`, name: `Person ${String(n)}`, brand: 'VISA', last4: '1111', outcome, on: null });
    const preview = {
      month: '2026-11',
      people: [person(1, 'will_email'), person(2, 'will_email'), person(3, 'will_email'), person(4, 'will_email'), person(5, 'no_email'), person(6, 'not_renewing')],
    };
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 0, billDay: null, cardExpiryReminders: false, cardExpiry: preview, canChange: true } });
    orgService.saveBillSettings.mockResolvedValue({
      data: { overdueAfterDays: 0, billDay: null, cardExpiryReminders: true, cardExpiry: { ...preview, people: [person(1, 'sending'), ...preview.people.slice(1)] }, canChange: true },
    });
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    const tick = await screen.findByTestId('card-expiry-reminders');
    expect(tick.checked).toBe(false);
    expect(screen.getByText('Email a reminder before a saved card expires')).toBeTruthy();
    // Nothing listed until it is ticked.
    expect(screen.queryByTestId('card-expiry-box')).toBeNull();

    fireEvent.click(tick);
    expect(screen.getByText('Saved cards that expire in November 2026')).toBeTruthy();
    expect(screen.getByText('Will be emailed once you save (4)')).toBeTruthy();
    expect(screen.getByText('Person 1 · Visa ending 1111')).toBeTruthy();
    expect(screen.queryByText('Person 4 · Visa ending 1111')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'and 1 more · See all' }));
    expect(screen.getByText('Person 4 · Visa ending 1111')).toBeTruthy();
    expect(screen.getByText('Not emailed: no email address on their record (1)')).toBeTruthy();
    expect(screen.getByText('Not emailed: their card pays for no membership that renews (1)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(orgService.saveBillSettings).toHaveBeenCalledWith(GYM, { overdueAfterDays: 0, billDay: null, cardExpiryReminders: true }));
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByText('Being sent (1)')).toBeTruthy();
    expect(screen.getByText('Will be emailed today (3)')).toBeTruthy();
  });

  it('a gym with no saved cards to remind about (not connected to Square) has no reminder tick', async () => {
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 0, billDay: null, cardExpiryReminders: false, cardExpiry: null, canChange: true } });
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    await screen.findByTestId('bill-day');
    expect(screen.queryByTestId('card-expiry-reminders')).toBeNull();
  });

  it('staff without the payments tick read the day and cannot change it', async () => {
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 0, billDay: 15, canChange: false } });
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    const select = await screen.findByTestId('bill-day');
    expect(select.value).toBe('15');
    expect(select.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
