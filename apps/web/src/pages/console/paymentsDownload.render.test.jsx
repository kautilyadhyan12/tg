// Download payments (ROADMAP 18n), drawn: the box on Reports and the button in the plan box.
// Only the network is mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { paymentsSummaryLine } from './paymentsDownloadView';

const svc = { paymentsSummary: vi.fn(), downloadPayments: vi.fn() };
vi.mock('../../api/reportsApi', () => ({ reportsService: svc }));

const PaymentsDownload = (await import('./PaymentsDownload')).default;
const PaymentsDownloadAll = (await import('../../components/console/PaymentsDownloadAll')).default;

const PERIOD = { key: '4w', from: '2026-09-23', to: '2026-10-20' };
const TODAY = '2026-10-20';
const summaryOf = (lines, totals = [{ currency: 'GBP', paidMinor: 6000, soldMinor: 500, refundedMinor: 0, netMinor: 6500 }]) => ({ from: PERIOD.from, to: PERIOD.to, lines, totals });

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
  svc.paymentsSummary.mockResolvedValue(summaryOf(4));
  svc.downloadPayments.mockResolvedValue({ blob: new Blob(['x']), filename: 'Payments 23 Sep 2026 – 20 Oct 2026.xlsx' });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('the box on Reports', () => {
  it('asks nothing until it is opened, then says what the file will hold and downloads those days', async () => {
    render(<PaymentsDownload gymId="g1" period={PERIOD} today={TODAY} />);
    expect(svc.paymentsSummary).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Download payments' }));
    expect(await screen.findByText('4 transactions · Memberships £60.00 · Product sales £5.00 · Collected £65.00')).toBeTruthy();
    expect(svc.paymentsSummary).toHaveBeenCalledWith('g1', { from: '2026-09-23', to: '2026-10-20' });
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(svc.downloadPayments).toHaveBeenCalledWith('g1', { from: '2026-09-23', to: '2026-10-20' }));
    expect((await screen.findByRole('status')).textContent).toBe(
      'Downloaded Payments 23 Sep 2026 – 20 Oct 2026.xlsx. Open it in Excel or Google Sheets, or send it to your accountant.',
    );
    // What was done is said where it was pressed; the way out reads Done.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('region', { name: 'Download payments' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download payments' })).toBeTruthy();
  });

  it('a download that fails says so in the box and can be pressed again', async () => {
    svc.downloadPayments.mockRejectedValueOnce(new Error('network'));
    render(<PaymentsDownload gymId="g1" period={PERIOD} today={TODAY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download payments' }));
    await screen.findByText(/4 transactions/);
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't reach the server. Check your connection and try again.");
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(svc.downloadPayments).toHaveBeenCalledTimes(2));
  });

  it('a count that cannot be read is said, and Download waits for it', async () => {
    svc.paymentsSummary.mockRejectedValueOnce(new Error('network'));
    render(<PaymentsDownload gymId="g1" period={PERIOD} today={TODAY} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download payments' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't reach the server. Check your connection and try again.");
    expect(screen.getByRole('button', { name: 'Download' }).disabled).toBe(true);
  });
});

describe("the box's line", () => {
  it.each([
    ['nothing on the days', summaryOf(0), 'No payments, refunds or sales on these days. The file will have its headings only.'],
    ['one transaction', summaryOf(1, [{ currency: 'INR', paidMinor: 236000, soldMinor: 0, refundedMinor: 0, netMinor: 236000 }]), '1 transaction · Memberships ₹2,360.00 · Collected ₹2,360.00'],
    [
      'more given back than taken',
      summaryOf(2, [{ currency: 'GBP', paidMinor: 0, soldMinor: 0, refundedMinor: 1000, netMinor: -1000 }]),
      '2 transactions · Refunded -£10.00 · Collected -£10.00',
    ],
    [
      'two currencies, each its own',
      summaryOf(3, [
        { currency: 'GBP', paidMinor: 1000, soldMinor: 0, refundedMinor: 0, netMinor: 1000 },
        { currency: 'USD', paidMinor: 0, soldMinor: 250, refundedMinor: 0, netMinor: 250 },
      ]),
      '3 transactions · Memberships £10.00 · Collected £10.00 · Product sales $2.50 · Collected $2.50',
    ],
  ])('%s', (_what, summary, line) => {
    expect(paymentsSummaryLine(summary)).toBe(line);
  });
});

describe('the plan box', () => {
  const OWNER = { id: 'g1', orgType: 'gym', staffRole: 'owner' };

  it('downloads every day for staff who may record payments, and says so', async () => {
    render(<PaymentsDownloadAll org={OWNER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Download payments' }));
    await waitFor(() => expect(svc.downloadPayments).toHaveBeenCalledWith('g1'));
    expect(svc.paymentsSummary).toHaveBeenCalledWith('g1');
    expect((await screen.findByRole('status')).textContent).toBe('Your payments were downloaded.');
  });

  it('is not there with nothing to download, for staff who may not see payments, or when the count fails', async () => {
    svc.paymentsSummary.mockResolvedValueOnce(summaryOf(0));
    render(<PaymentsDownloadAll org={OWNER} />);
    await waitFor(() => expect(svc.paymentsSummary).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();

    render(<PaymentsDownloadAll org={{ id: 'g1', orgType: 'gym', staffRole: 'trainer', privileges: ['members.read', 'members.confirm'] }} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(svc.paymentsSummary).toHaveBeenCalledTimes(1);
    cleanup();

    svc.paymentsSummary.mockRejectedValueOnce(new Error('network'));
    render(<PaymentsDownloadAll org={OWNER} />);
    await waitFor(() => expect(svc.paymentsSummary).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
