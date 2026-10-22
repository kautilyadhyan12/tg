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

  it('staff without the payments tick read the day and cannot change it', async () => {
    orgService.getBillSettings.mockResolvedValue({ data: { overdueAfterDays: 0, billDay: 15, canChange: false } });
    render(<BillSettingsCard gymId={GYM} readOnly={false} />);
    const select = await screen.findByTestId('bill-day');
    expect(select.value).toBe('15');
    expect(select.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
