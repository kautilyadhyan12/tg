// THE MEMBER'S PASS ON SCREEN (ROADMAP 16c). What a person sees while it is open: a code
// that renews itself, never an old one left behind by a failed renewal, and nothing asked
// for once it is closed.
//
// Every timer is faked, so "30 seconds later" is a statement and not a wait.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { passCells, passPath } from './checkinPassView';

const api = { getCheckinPass: vi.fn() };
vi.mock('../../api/orgsApi', () => ({
  orgService: api,
  // The server's own sentence where the failure carries one, as the real one reads it.
  errorText: (err, fallback) => err?.response?.data?.message ?? fallback,
}));

const CheckinPass = (await import('./CheckinPass')).default;

const NOW = new Date('2026-10-03T10:00:12.000Z');
const PASS_A = 'AHGPLG763ESHTVB2ZAG44DJVO6OZTIBY55AU7C4WIZRMWOB6SNIWULCDANFKYI';
const PASS_B = 'AHGPRB32WCZWQNH5DPF72VQT4RBYDABY55AVGD2T7324JFIASG2F7CA45QCLBQ';
const PASS_C = 'AHGPLIQVH3B3TFBQRGYIT4QBSLEYBABY55AWLYH5DPJHU5IYRWH74YHME353JM';
const answer = (pass, refreshAt) => ({ data: { pass, refreshAt } });
const drawnPath = (pass) => passPath(passCells(pass));

/** The code on screen, as the path it is drawn with, or null when no code is drawn. */
const codeOnScreen = () => screen.queryByRole('img', { name: 'Your check-in pass' })?.querySelector('path')?.getAttribute('d') ?? null;

/** Let promises settle and move the clock. */
const pass = async (ms) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const setVisibility = (state) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  api.getCheckinPass.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the pass, open', () => {
  it('draws the pass the server sent, as that pass’s own code', async () => {
    api.getCheckinPass.mockResolvedValue(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
    render(<CheckinPass onClose={() => {}} />);
    expect(screen.getByText('Getting your pass…')).toBeTruthy();
    await pass(0);
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));
    expect(screen.getByText('Hold this up to the scanner to check in.')).toBeTruthy();
    expect(screen.queryByText('Getting your pass…')).toBeNull();
  });

  it('asks for the next pass when this one’s window ends, and draws it in place of the old', async () => {
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T10:00:30.000Z'))
      .mockResolvedValueOnce(answer(PASS_B, '2026-10-03T10:01:00.000Z'))
      .mockResolvedValueOnce(answer(PASS_C, '2026-10-03T10:01:30.000Z'));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(1);

    // 17 seconds in, the window (18 s long from here) has not ended: nothing is asked.
    await pass(17_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(1);
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));

    await pass(1_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);
    expect(codeOnScreen()).toBe(drawnPath(PASS_B));

    await pass(30_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(3);
    expect(codeOnScreen()).toBe(drawnPath(PASS_C));
  });

  it('takes the old pass off the screen when the next one cannot be had, says so, and asks no more by itself', async () => {
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T10:00:30.000Z'))
      .mockRejectedValueOnce(new Error('offline'));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));

    await pass(18_000);
    expect(codeOnScreen()).toBeNull();
    expect(screen.getByText("We couldn't get your pass just now. Please try again.")).toBeTruthy();

    await pass(10 * 60_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);
    expect(codeOnScreen()).toBeNull();
  });

  it('gets a pass again on Try again, and goes back to renewing it', async () => {
    api.getCheckinPass
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(answer(PASS_B, '2026-10-03T10:00:30.000Z'))
      .mockResolvedValueOnce(answer(PASS_C, '2026-10-03T10:01:00.000Z'));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    expect(codeOnScreen()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Getting your pass…')).toBeTruthy();
    await pass(0);
    expect(codeOnScreen()).toBe(drawnPath(PASS_B));

    await pass(18_000);
    expect(codeOnScreen()).toBe(drawnPath(PASS_C));
    expect(api.getCheckinPass).toHaveBeenCalledTimes(3);
  });

  it('says the server’s own words when passes are switched off there', async () => {
    api.getCheckinPass.mockRejectedValue({
      response: { status: 503, data: { error: 'passes_off', message: "Passes aren't working right now. Staff can check you in." } },
    });
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    expect(screen.getByText("Passes aren't working right now. Staff can check you in.")).toBeTruthy();
    expect(codeOnScreen()).toBeNull();
  });

  // The server allows 10 passes a minute a person. A phone whose clock is ahead sees
  // every window as already over.
  it('never asks more than nine times a minute, however wrong this device’s clock is', async () => {
    api.getCheckinPass.mockImplementation(() => Promise.resolve(answer(PASS_A, '2026-10-03T09:00:00.000Z')));
    render(<CheckinPass onClose={() => {}} />);
    await pass(60_000);
    expect(api.getCheckinPass.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(api.getCheckinPass.mock.calls.length).toBeLessThanOrEqual(9);
  });

  it('asks for the next pass after 25 seconds at the latest, when this device’s clock is behind', async () => {
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T12:00:00.000Z'))
      .mockResolvedValueOnce(answer(PASS_B, '2026-10-03T12:00:30.000Z'));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    await pass(24_999);
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));
    await pass(1);
    expect(codeOnScreen()).toBe(drawnPath(PASS_B));
  });

  // A phone that loses its signal inside the gym stalls the request rather than failing
  // it. The pass on screen runs out at the desk meanwhile, so it must not stay up.
  it('takes the pass off after 30 seconds when the next one never answers, and offers Try again once the wait is given up', async () => {
    let fail;
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T10:00:30.000Z'))
      .mockReturnValueOnce(new Promise((_resolve, reject) => (fail = reject)));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);

    await pass(18_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);
    await pass(11_999);
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));

    await pass(1);
    expect(codeOnScreen()).toBeNull();
    expect(screen.getByText('Getting your pass…')).toBeTruthy();
    expect(screen.queryByText(/Hold this up/)).toBeNull();

    await pass(60_000);
    expect(codeOnScreen()).toBeNull();
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);

    // The request's own 10-second limit gives up on it (`orgsApi.getCheckinPass`).
    fail(new Error('timeout of 10000ms exceeded'));
    await pass(0);
    expect(screen.getByText("We couldn't get your pass just now. Please try again.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  // The server made the pass when it was asked, so a slow answer has less time left.
  it('counts a pass’s 30 seconds from when it was asked for, not from when it arrived', async () => {
    let land;
    api.getCheckinPass
      .mockReturnValueOnce(new Promise((resolve) => (land = resolve)))
      .mockReturnValueOnce(new Promise(() => {}));
    render(<CheckinPass onClose={() => {}} />);
    await pass(8_000);
    land(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
    await pass(0);
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));

    // 8 seconds went on the way: the next is asked for sooner, and 22 seconds after
    // arriving the pass is off.
    await pass(21_999);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));
    await pass(1);
    expect(codeOnScreen()).toBeNull();
    expect(screen.getByText('Getting your pass…')).toBeTruthy();
  });

  it('a late answer still draws the new pass, after the old one was taken off', async () => {
    let land;
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T10:00:30.000Z'))
      .mockReturnValueOnce(new Promise((resolve) => (land = resolve)))
      .mockReturnValueOnce(new Promise(() => {}));
    render(<CheckinPass onClose={() => {}} />);
    await pass(30_000);
    expect(codeOnScreen()).toBeNull();
    land(answer(PASS_B, '2026-10-03T10:01:00.000Z'));
    await pass(0);
    expect(codeOnScreen()).toBe(drawnPath(PASS_B));
    // And the new pass gets its own 30 seconds, from when it was asked for (12 seconds
    // before it landed), not what was left of the old one's.
    await pass(17_999);
    expect(codeOnScreen()).toBe(drawnPath(PASS_B));
    await pass(1);
    expect(codeOnScreen()).toBeNull();
  });

  it('tells a personal trainer’s client to hold it up for the trainer, not for a scanner', async () => {
    api.getCheckinPass.mockResolvedValue(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
    render(<CheckinPass onClose={() => {}} orgType="personal_trainer" />);
    await pass(0);
    expect(screen.getByText('Hold this up for your trainer to scan.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/scanner/);
  });
});

describe('the pass, closed or out of view', () => {
  it('asks for nothing after it is closed, and a late answer draws nothing', async () => {
    let land;
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T10:00:30.000Z'))
      .mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const view = render(<CheckinPass onClose={() => {}} />);
    await pass(18_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);

    view.unmount();
    land(answer(PASS_B, '2026-10-03T10:01:00.000Z'));
    await pass(10 * 60_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);
    expect(codeOnScreen()).toBeNull();
  });

  it('asks for nothing while the page is out of view; back in view the old pass is not shown while the new one is fetched', async () => {
    let land;
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T10:00:30.000Z'))
      .mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);

    setVisibility('hidden');
    await pass(5 * 60_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await pass(0);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);
    // The answer has not landed: no five-minute-old code under "Hold this up".
    expect(codeOnScreen()).toBeNull();
    expect(screen.getByText('Getting your pass…')).toBeTruthy();

    land(answer(PASS_B, '2026-10-03T10:06:00.000Z'));
    await pass(0);
    expect(codeOnScreen()).toBe(drawnPath(PASS_B));
  });

  // A browser slows a hidden page's timers, so the 30-second timer cannot be relied on
  // there: coming back is what takes an old pass off.
  it('takes an old pass off on coming back even if the hidden page’s own timer never ran', async () => {
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T10:00:30.000Z'))
      .mockReturnValueOnce(new Promise(() => {}));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    setVisibility('hidden');
    // The clock moves five minutes and no timer runs, as on a sleeping phone.
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000));
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));

    await act(async () => {
      setVisibility('visible');
    });
    expect(codeOnScreen()).toBeNull();
    expect(screen.getByText('Getting your pass…')).toBeTruthy();
  });

  it('a short look away keeps a pass that is still good on screen while the next is fetched', async () => {
    api.getCheckinPass
      .mockResolvedValueOnce(answer(PASS_A, '2026-10-03T10:00:30.000Z'))
      .mockReturnValueOnce(new Promise(() => {}));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    setVisibility('hidden');
    await pass(5_000);
    setVisibility('visible');
    await pass(0);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(2);
    expect(codeOnScreen()).toBe(drawnPath(PASS_A));
  });

  it('after a failure, coming back to the page asks nothing: the person presses Try again', async () => {
    api.getCheckinPass.mockRejectedValue(new Error('offline'));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await pass(1_000);
    setVisibility('visible');
    await pass(60_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('closes on the X, on Escape and on a tap outside, and not on a tap on the pass', async () => {
    api.getCheckinPass.mockResolvedValue(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
    const onClose = vi.fn();
    render(<CheckinPass onClose={onClose} />);
    await pass(0);

    fireEvent.click(screen.getByRole('img', { name: 'Your check-in pass' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('dialog').parentElement);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  // ROADMAP 16f: a phone that dims or locks while it is held up to the desk cannot be read.
  describe('the screen stays awake', () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release }));
    beforeEach(() => {
      release.mockClear();
      request.mockClear();
      Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    });
    afterEach(() => {
      delete navigator.wakeLock;
    });

    it('while the pass is open, and is let go when it closes', async () => {
      api.getCheckinPass.mockResolvedValue(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
      const view = render(<CheckinPass onClose={() => {}} />);
      await pass(0);
      expect(request.mock.calls).toEqual([['screen']]);
      expect(release).not.toHaveBeenCalled();
      view.unmount();
      await pass(0);
      expect(release).toHaveBeenCalledTimes(1);
    });

    it('is asked for again when the page comes back into view, since the phone lets go of it', async () => {
      api.getCheckinPass.mockResolvedValue(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
      render(<CheckinPass onClose={() => {}} />);
      await pass(0);
      setVisibility('hidden');
      await pass(0);
      expect(request).toHaveBeenCalledTimes(1);
      setVisibility('visible');
      await pass(0);
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('a phone that refuses still shows the pass', async () => {
      request.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
      api.getCheckinPass.mockResolvedValue(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
      render(<CheckinPass onClose={() => {}} />);
      await pass(0);
      expect(codeOnScreen()).toBe(drawnPath(PASS_A));
    });
  });

  it('says what to do when it does not scan', async () => {
    api.getCheckinPass.mockResolvedValue(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
    render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    expect(screen.getByText("If it doesn't scan, turn your screen's brightness up.")).toBeTruthy();
  });

  // My Gyms re-renders every half minute and hands over a new `onClose` each time.
  it('does not ask again because the screen behind it drew again', async () => {
    api.getCheckinPass.mockResolvedValue(answer(PASS_A, '2026-10-03T10:00:30.000Z'));
    const view = render(<CheckinPass onClose={() => {}} />);
    await pass(0);
    view.rerender(<CheckinPass onClose={() => {}} />);
    view.rerender(<CheckinPass onClose={() => {}} />);
    await pass(1_000);
    expect(api.getCheckinPass).toHaveBeenCalledTimes(1);
  });
});
