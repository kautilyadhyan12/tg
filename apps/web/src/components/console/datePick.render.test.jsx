// THE DATE PICKER: its month grid, and that a day outside the range cannot be
// picked (Kd, 17b-ii-b-ii-b's click-through: a calendar, never a typed date).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DatePick from './DatePick';
import { dayAllowed, monthGrid, monthTitle, openingMonth, shiftMonth } from './datePickView';

afterEach(cleanup);

describe('the month grid', () => {
  it('starts each week on Monday and pads the month to whole weeks', () => {
    // 1 Oct 2026 is a Thursday; October has 31 days.
    const weeks = monthGrid('2026-10-01');
    expect(weeks[0]).toEqual([null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weeks.at(-1)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', null]);
    expect(weeks.flat().filter((d) => d !== null)).toHaveLength(31);
  });

  it.each([
    ['a leap February', '2028-02-01', 29],
    ['a plain February', '2026-02-01', 28],
    ['a month starting on Monday', '2026-06-01', 30],
  ])('%s', (_label, month, days) => {
    const cells = monthGrid(month).flat();
    expect(cells.filter((d) => d !== null)).toHaveLength(days);
    expect(cells.length % 7).toBe(0);
  });

  it('moves a month at a time across a year, and names the month', () => {
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(monthTitle('2026-10-01')).toBe('October 2026');
  });

  it('opens on the picked date, else the first allowed, else today', () => {
    expect(openingMonth('2026-11-12', '2026-09-23', '2026-09-23')).toBe('2026-11-01');
    expect(openingMonth('', '2026-12-22', '2026-09-23')).toBe('2026-12-01');
    expect(openingMonth('', '', '2026-09-23')).toBe('2026-09-01');
  });

  it.each([
    ['inside', '2026-10-05', true],
    ['the first allowed day', '2026-09-23', true],
    ['the last allowed day', '2026-11-17', true],
    ['the day before', '2026-09-22', false],
    ['the day after', '2026-11-18', false],
  ])('a day %s the range', (_label, day, ok) => {
    expect(dayAllowed(day, '2026-09-23', '2026-11-17')).toBe(ok);
  });
});

describe('the picker', () => {
  const draw = (props = {}) => {
    const onChange = vi.fn();
    render(
      <DatePick
        label="Update from"
        value="2026-09-25"
        min="2026-09-23"
        max="2026-10-10"
        today="2026-09-23"
        onChange={onChange}
        {...props}
      />,
    );
    return onChange;
  };

  it('shows the date as words, and a picked day closes the calendar and is sent', () => {
    const onChange = draw();
    const box = screen.getByRole('button', { name: 'Update from' });
    expect(box.textContent).toBe('Fri 25 Sep 2026');
    expect(box.value).toBe('2026-09-25');
    fireEvent.click(box);
    expect(screen.getByText('September 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fri 25 Sep 2026' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Mon 28 Sep 2026' }));
    expect(onChange).toHaveBeenCalledWith('2026-09-28');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never lets a day outside the range be picked, nor a month outside it be shown', () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole('button', { name: 'Update from' }));
    expect(screen.getByRole('button', { name: 'Tue 22 Sep 2026' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Previous month' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Tue 22 Sep 2026' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('button', { name: 'Sun 11 Oct 2026' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Next month' }).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on Escape without sending anything', () => {
    const onChange = draw();
    fireEvent.click(screen.getByRole('button', { name: 'Update from' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('an optional date says so when empty, and can be cleared', () => {
    const onClear = vi.fn();
    draw({ label: 'End date (optional)', value: '2026-10-01', emptyText: 'No end date', onClear });
    fireEvent.click(screen.getByRole('button', { name: 'End date (optional)' }));
    fireEvent.click(screen.getByRole('button', { name: 'No end date' }));
    expect(onClear).toHaveBeenCalledTimes(1);
    cleanup();
    draw({ label: 'End date (optional)', value: '', emptyText: 'No end date', onClear });
    expect(screen.getByRole('button', { name: 'End date (optional)' }).textContent).toBe('No end date');
  });
});

describe('a date many years back (5b-i: a date of birth)', () => {
  it('jumps to another year from the year list, and picks a day in it', () => {
    const onChange = vi.fn();
    render(<DatePick label="Date of birth" value="" min="1900-01-01" max="2026-09-25" today="2026-09-25" yearSelect onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Date of birth' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Year' }), { target: { value: '1988' } });
    fireEvent.click(screen.getByRole('button', { name: /\b14 Sep/ }));
    expect(onChange).toHaveBeenCalledWith('1988-09-14');
  });
});