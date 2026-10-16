import { dayWords, coversWords } from '@app/shared';
import { moneyText } from './reportsMoneyView';

// Download payments' words (spec Part 3 §14.3; ROADMAP 18n): the line that says what the file
// will hold before it is downloaded, in Reports' own words for the same totals.

/** "1 Oct – 31 Oct 2026", or one day. */
export const daysText = (from, to) => (from === to ? dayWords(from) : coversWords(from, to));

/** "4 transactions": the file's lines, voided ones too. */
function linesText(n) {
  return n === 1 ? '1 transaction' : `${n.toLocaleString('en-GB')} transactions`;
}

/** What the file will hold: "4 transactions · Memberships $54.13 · Product sales $5.00 · Refunded -$10.00 ·
 *  Collected $49.13", a part left out where it is nothing. Each currency is said on its own. */
export function paymentsSummaryLine(summary) {
  if (summary.lines === 0) return 'No payments, refunds or sales on these days. The file will have its headings only.';
  const parts = summary.totals.map((t) => {
    const said = [];
    if (t.paidMinor !== 0) said.push(`Memberships ${moneyText(t.paidMinor, t.currency)}`);
    if (t.soldMinor !== 0) said.push(`Product sales ${moneyText(t.soldMinor, t.currency)}`);
    if (t.refundedMinor !== 0) said.push(`Refunded ${moneyText(-t.refundedMinor, t.currency)}`);
    said.push(`Collected ${moneyText(t.netMinor, t.currency)}`);
    return said.join(' · ');
  });
  return `${linesText(summary.lines)} · ${parts.join(' · ')}`;
}

const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The quick choices, as Square's and Mindbody's date pickers offer them, from the gym's today:
 *  this month so far, the whole of last month, and this year so far. */
export function quickDays(today) {
  const [y, m] = today.split('-').map(Number);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return [
    { key: 'this-month', label: 'This month', from: `${y}-${pad(m)}-01`, to: today },
    { key: 'last-month', label: 'Last month', from: `${prevY}-${pad(prevM)}-01`, to: `${prevY}-${pad(prevM)}-${pad(lastDay(prevY, prevM))}` },
    { key: 'this-year', label: 'This year', from: `${y}-01-01`, to: today },
  ];
}

/** Said in the box once the file is saved. */
export const downloadedLine = (filename) => `Downloaded ${filename}. Open it in Excel or Google Sheets, or send it to your accountant.`;

export const DOWNLOAD_FAILED = "We couldn't download the file. Please try again.";
export const SUMMARY_FAILED = "We couldn't count the payments on these days. Please try again.";
