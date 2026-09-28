// Back to top and Go to the bottom (Kd, 2026-09-28): each shows only when it would move the
// page, and moves it to that end.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import ScrollJump from './ScrollJump';

const page = (scrollY, height = 5000, innerHeight = 800) => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: height });
};
const scrolled = (y) => {
  page(y);
  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
};
const up = () => screen.queryByRole('button', { name: 'Back to top' });
const down = () => screen.queryByRole('button', { name: 'Go to the bottom' });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Back to top and Go to the bottom', () => {
  it('at the top of a long page: only Go to the bottom', () => {
    page(0);
    render(<ScrollJump />);
    expect(up()).toBeNull();
    expect(down()).toBeTruthy();
  });

  it('in the middle: both; at the bottom: only Back to top', () => {
    page(0);
    render(<ScrollJump />);
    scrolled(2000);
    expect([up() !== null, down() !== null]).toEqual([true, true]);
    scrolled(4200);
    expect([up() !== null, down() !== null]).toEqual([true, false]);
  });

  it('a short page shows neither', () => {
    page(0, 900);
    render(<ScrollJump />);
    expect(screen.queryByTestId('scroll-jump')).toBeNull();
  });

  it('each moves the page to its end', () => {
    const to = vi.fn();
    window.scrollTo = to;
    page(2000);
    render(<ScrollJump />);
    fireEvent.click(up());
    expect(to).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    fireEvent.click(down());
    expect(to).toHaveBeenLastCalledWith({ top: 5000, behavior: 'smooth' });
  });

  it('sits over the phone selection bar when it shows', () => {
    page(2000);
    render(<ScrollJump raised />);
    expect(screen.getByTestId('scroll-jump').className).toContain('c-jump-raised');
  });
});
