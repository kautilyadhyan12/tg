// No page of ours inside another site's frame (ROADMAP 18d-ii, round one): a framed console
// draws nothing to press; a gym's public page as its embed is the one page that may be framed.
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FrameGuard from './FrameGuard';
import { isFramed, mayBeFramed } from './framing';

afterEach(cleanup);

const at = (path, framed) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <FrameGuard framed={framed}>
        <button type="button">Remove card</button>
      </FrameGuard>
    </MemoryRouter>,
  );

describe('FrameGuard', () => {
  it('a console page inside another site’s frame draws nothing to press', () => {
    at('/console/iron-house/members?person=x', true);
    expect(screen.queryByRole('button', { name: 'Remove card' })).toBeNull();
    expect(screen.getByText(/This page opens in its own tab/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('target')).toBe('_blank');
  });

  it('the same page in its own tab is drawn as usual', () => {
    at('/console/iron-house/members', false);
    expect(screen.getByRole('button', { name: 'Remove card' })).toBeTruthy();
  });

  it("only a gym's public page as its embed may be framed", () => {
    at('/gyms/iron-house?embed=1', true);
    expect(screen.getByRole('button', { name: 'Remove card' })).toBeTruthy();
    expect(mayBeFramed('/gyms/iron-house', '?embed=1')).toBe(true);
    expect(mayBeFramed('/gyms/iron-house', '')).toBe(false);
    expect(mayBeFramed('/gyms/iron-house/members', '?embed=1')).toBe(false);
    expect(mayBeFramed('/console/iron-house', '?embed=1')).toBe(false);
  });

  it('a window we may not ask about counts as framed', () => {
    expect(isFramed({ self: 1, top: 1 })).toBe(false);
    expect(isFramed({ self: 1, top: 2 })).toBe(true);
    const guarded = { self: 1 };
    Object.defineProperty(guarded, 'top', {
      get() {
        throw new Error('cross-origin');
      },
    });
    expect(isFramed(guarded)).toBe(true);
  });
});
