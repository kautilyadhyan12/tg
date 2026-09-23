// The app's own dark dropdown opens where its list fits the window: below the
// field where there is room, above it where the list would run off the bottom
// and there is more room above — the measure picker at the foot of Add food ran
// off the screen (Kd's click-through of 7a-iv-a).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Select from './Select';

const options = Array.from({ length: 11 }, (_, at) => ({ value: `m${at}`, label: `Measure ${at}` }));

/** The field sits from `top` to `top + 30` in a window 800 px tall. */
function renderAt(top, extra = {}) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 30, left: 0, right: 200, width: 200, height: 30, x: 0, y: top, toJSON: () => ({}) });
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
  const onChange = vi.fn();
  render(<Select ariaLabel="Measure" value="m0" onChange={onChange} options={options} {...extra} />);
  fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
  return { list: screen.getByRole('listbox'), onChange };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('where the dropdown opens', () => {
  it('below the field where the list fits under it', () => {
    const { list } = renderAt(100, { maxListHeight: 240 });
    expect(list.className).toContain('mt-1');
    expect(list.className).not.toContain('bottom-full');
    expect(list.style.maxHeight).toBe('240px');
    expect(list.style.overflowY).toBe('auto');
  });

  it('above the field where the list would run past the bottom of the window and more room is above', () => {
    // 603 px down, 167 px left below: a 240 px list does not fit, 603 px above does.
    const { list, onChange } = renderAt(603, { maxListHeight: 240 });
    expect(list.className).toContain('bottom-full');
    expect(list.className).not.toContain('mt-1');
    // Every option is still there to pick.
    fireEvent.click(screen.getByRole('option', { name: 'Measure 10' }));
    expect(onChange).toHaveBeenCalledWith('m10');
  });

  it('below the field where there is less room above than below, scrolling inside the room there is', () => {
    // 11 options want 404 px, more than the 390 px below — but only 380 px are above: below stays,
    // and the list stops 8 px short of the window's foot.
    const { list } = renderAt(380);
    expect(list.className).toContain('mt-1');
    expect(list.style.maxHeight).toBe('382px');
    expect(list.style.overflowY).toBe('auto');
  });

  it('never runs off the top of the window: the 24 countries above a field near the foot scroll inside it', () => {
    // Kd's click-through of Stage 3 item 2a: the country list opened upward, 872 px tall,
    // and Austria to France sat above the window where nobody could reach them.
    const countries = Array.from({ length: 24 }, (_, at) => ({ value: `c${at}`, label: `Country ${at}` }));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 730, left: 0, right: 200, width: 200, height: 30, x: 0, y: 700, toJSON: () => ({}) });
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    const onChange = vi.fn();
    render(<Select ariaLabel="Country" value="" onChange={onChange} options={countries} placeholder="Choose a country" />);
    fireEvent.click(screen.getByRole('button', { name: 'Country' }));
    const list = screen.getByRole('listbox');
    expect(list.className).toContain('bottom-full');
    // 700 px above the field, less 8 px: the list's top stays inside the window.
    expect(list.style.maxHeight).toBe('692px');
    expect(list.style.overflowY).toBe('auto');
    fireEvent.click(screen.getByRole('option', { name: 'Country 0' }));
    expect(onChange).toHaveBeenCalledWith('c0');
  });
});
