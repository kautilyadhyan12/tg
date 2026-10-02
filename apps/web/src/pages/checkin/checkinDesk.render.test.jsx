// THE FRONT DESK, as the person at it sees it (spec Part 3 §12.3; ROADMAP 16b-i).
//
// The worst thing this screen could do to a real person: leave one member's name and
// payment word up for the next person in the queue to read, or let its set-up link make a
// second desk. Those are the first tests; the rest draw every answer the scan can give.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CHECKIN_WORDS } from '@app/shared';

vi.mock('../../api/checkinApi', () => ({
  checkinService: { claimDevice: vi.fn(), scan: vi.fn() },
}));
vi.mock('jsqr', () => ({ default: vi.fn() }));

const { checkinService } = await import('../../api/checkinApi');
const jsQR = (await import('jsqr')).default;
const CheckinDesk = (await import('./CheckinDesk')).default;
const { DESK_NAMES_KEY, RESULT_SHOW_MS } = await import('./deskView');

const TOKEN = 'a'.repeat(20) + 'B_-' + 'c'.repeat(20);
const PASS = 'AHGP' + 'A'.repeat(58);

const checkedIn = (name, notice = { status: null, payment: null, onList: true }) => ({
  result: 'checked_in',
  gymName: 'Iron House',
  person: { name },
  notice,
});

function mount(path = '/check-in') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/check-in/setup" element={<CheckinDesk />} />
        <Route path="/check-in" element={<CheckinDesk />} />
      </Routes>
    </MemoryRouter>,
  );
}

function scan(code) {
  const box = screen.getByLabelText(/scanner/i);
  fireEvent.change(box, { target: { value: code } });
  fireEvent.submit(box.closest('form'));
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the worst thing: somebody else’s details left on the desk', () => {
  it('a name and payment word leave the screen after a few seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    checkinService.scan.mockResolvedValue(checkedIn('Olivia Bennett', { status: 'Active', payment: 'Overdue', onList: true }));
    mount();
    scan(PASS);
    expect(await screen.findByText('Olivia Bennett')).toBeTruthy();
    expect(screen.getByText('Status: Active · Payment: Overdue')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(RESULT_SHOW_MS - 100);
    });
    expect(screen.queryByText('Olivia Bennett')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText('Olivia Bennett')).toBeNull();
    expect(screen.queryByText(/Overdue/)).toBeNull();
    expect(screen.getByText('Scan your pass or key tag')).toBeTruthy();
  });

  it('the next scan takes the last person off the screen at once, before its answer comes', async () => {
    let answerSecond;
    checkinService.scan
      .mockResolvedValueOnce(checkedIn('Olivia Bennett'))
      .mockImplementationOnce(() => new Promise((resolve) => (answerSecond = resolve)));
    mount();
    scan(PASS);
    expect(await screen.findByText('Olivia Bennett')).toBeTruthy();

    scan('1002');
    expect(screen.queryByText('Olivia Bennett')).toBeNull();
    expect(screen.getByText('Checking…')).toBeTruthy();

    await act(async () => answerSecond(checkedIn('Liam Hughes')));
    expect(screen.getByText('Liam Hughes')).toBeTruthy();
    expect(screen.queryByText('Olivia Bennett')).toBeNull();
  });

  it('a device switched off between two scans does not bring the last person back', async () => {
    checkinService.scan
      .mockResolvedValueOnce(checkedIn('Olivia Bennett', { status: null, payment: 'Overdue', onList: true }))
      .mockRejectedValueOnce({ response: { status: 401, data: { error: 'device_not_recognised' } } });
    mount();
    scan(PASS);
    expect(await screen.findByText('Olivia Bennett')).toBeTruthy();
    scan(PASS);
    expect(await screen.findByText(CHECKIN_WORDS.device_not_recognised)).toBeTruthy();
    expect(screen.queryByText('Olivia Bennett')).toBeNull();
    expect(screen.queryByText(/Overdue/)).toBeNull();
  });

  it('an answer that arrives after a newer scan is never shown', async () => {
    let answerFirst;
    checkinService.scan
      .mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce(checkedIn('Liam Hughes'));
    mount();
    scan(PASS);
    scan('1002');
    expect(await screen.findByText('Liam Hughes')).toBeTruthy();
    await act(async () => answerFirst(checkedIn('Olivia Bennett')));
    expect(screen.queryByText('Olivia Bennett')).toBeNull();
    expect(screen.getByText('Liam Hughes')).toBeTruthy();
  });
});

describe('the worst thing: a set-up link that makes a second desk', () => {
  it('the link is spent once, leaves the address bar, and only the names are kept', async () => {
    checkinService.claimDevice.mockResolvedValue({ gymName: 'Iron House', deviceName: 'Front desk' });
    window.history.replaceState(null, '', `/check-in/setup#${TOKEN}`);
    mount('/check-in/setup');

    expect(await screen.findByText('Scan your pass or key tag')).toBeTruthy();
    expect(checkinService.claimDevice).toHaveBeenCalledTimes(1);
    expect(checkinService.claimDevice).toHaveBeenCalledWith(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    const kept = window.localStorage.getItem(DESK_NAMES_KEY);
    expect(JSON.parse(kept)).toEqual({ gymName: 'Iron House', deviceName: 'Front desk' });
    expect(kept).not.toContain(TOKEN);
    expect(screen.getByText('Iron House')).toBeTruthy();
    expect(screen.getByText('Check-in · Front desk')).toBeTruthy();
  });

  it('a link already used says it cannot be used and opens no desk', async () => {
    checkinService.claimDevice.mockRejectedValue({ response: { status: 404, data: { error: 'link_not_valid' } } });
    window.history.replaceState(null, '', `/check-in/setup#${TOKEN}`);
    mount('/check-in/setup');

    expect(await screen.findByText(CHECKIN_WORDS.link_not_valid)).toBeTruthy();
    expect(screen.getByText("This link can't be used")).toBeTruthy();
    expect(screen.queryByLabelText(/scanner/i)).toBeNull();
    expect(window.location.hash).toBe('');
    expect(window.localStorage.getItem(DESK_NAMES_KEY)).toBeNull();
  });

  it('a link with no token spends nothing', async () => {
    window.history.replaceState(null, '', '/check-in/setup#not-a-token');
    mount('/check-in/setup');
    expect(await screen.findByText(CHECKIN_WORDS.link_not_valid)).toBeTruthy();
    expect(checkinService.claimDevice).not.toHaveBeenCalled();
  });
});

describe('the desk is locked', () => {
  it('has no link, so nothing on it leads into the console', async () => {
    checkinService.scan.mockResolvedValue(checkedIn('Olivia Bennett'));
    const { container } = mount();
    expect(container.querySelectorAll('a').length).toBe(0);
    scan(PASS);
    await screen.findByText('Olivia Bennett');
    expect(container.querySelectorAll('a').length).toBe(0);
  });

  it('a switched-off device says so, keeps saying so, and forgets its names', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.setItem(DESK_NAMES_KEY, JSON.stringify({ gymName: 'Iron House', deviceName: 'Front desk' }));
    checkinService.scan.mockRejectedValue({ response: { status: 401, data: { error: 'device_not_recognised' } } });
    mount();
    expect(screen.getByText('Iron House')).toBeTruthy();
    scan(PASS);
    expect(await screen.findByText(CHECKIN_WORDS.device_not_recognised)).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(RESULT_SHOW_MS * 3);
    });
    expect(screen.getByText(CHECKIN_WORDS.device_not_recognised)).toBeTruthy();
    expect(screen.queryByText('Iron House')).toBeNull();
    expect(window.localStorage.getItem(DESK_NAMES_KEY)).toBeNull();
  });
});

describe('every answer the scan gives', () => {
  it('green with the name, and nothing orange when the list has no words for them', async () => {
    checkinService.scan.mockResolvedValue(checkedIn('Olivia Bennett'));
    const { container } = mount();
    scan(PASS);
    expect(await screen.findByText('Checked in')).toBeTruthy();
    expect(container.querySelector('[data-tone="good"]')).not.toBeNull();
    expect(container.querySelector('[data-notice]')).toBeNull();
  });

  it('an app member the list no longer holds is green, with "Not on your list" in orange', async () => {
    checkinService.scan.mockResolvedValue(checkedIn('Arjun Shah', { status: null, payment: null, onList: false }));
    const { container } = mount();
    scan(PASS);
    expect(await screen.findByText('Not on your list')).toBeTruthy();
    expect(container.querySelector('[data-tone="good"]')).not.toBeNull();
  });

  it('a second scan in the same session says when they came, on the gym’s clock', async () => {
    checkinService.scan.mockResolvedValue({
      result: 'already',
      gymName: 'Iron House',
      person: { name: 'Olivia Bennett' },
      notice: { status: null, payment: null, onList: true },
      firstAt: '2026-10-02T12:02:00.000Z',
      timezone: 'America/New_York',
      clockFormat: '12h',
    });
    mount();
    scan(PASS);
    expect(await screen.findByText('Already checked in at 8:02 AM')).toBeTruthy();
    expect(screen.getByText('Olivia Bennett')).toBeTruthy();
  });

  it('grey for an old or used pass, and no name', async () => {
    checkinService.scan.mockResolvedValue({ result: 'fresh_pass_needed', gymName: 'Iron House' });
    const { container } = mount();
    scan(PASS);
    expect(await screen.findByText('Show a fresh pass')).toBeTruthy();
    expect(container.querySelector('[data-tone="plain"]')).not.toBeNull();
  });

  it('red for somebody who is not a member, and nothing more', async () => {
    checkinService.scan.mockResolvedValue({ result: 'not_a_member', gymName: 'Iron House' });
    const { container } = mount();
    scan('9999');
    expect(await screen.findByText('Not a member of Iron House')).toBeTruthy();
    expect(container.querySelector('[data-tone="bad"]')).not.toBeNull();
  });

  it('a key tag two people share sends them to staff', async () => {
    checkinService.scan.mockResolvedValue({ result: 'see_staff', gymName: 'Iron House' });
    mount();
    scan('1001');
    expect(await screen.findByText('Please see a member of staff')).toBeTruthy();
  });

  it('a desk whose key tags are paused says so in the server’s words', async () => {
    checkinService.scan.mockRejectedValue({ response: { status: 429, data: { error: 'key_tags_paused', message: 'x' } } });
    mount();
    scan('1001');
    expect(await screen.findByText(CHECKIN_WORDS.key_tags_paused)).toBeTruthy();
  });

  it('no connection is said as such, and the next scan still goes', async () => {
    checkinService.scan.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(checkedIn('Olivia Bennett'));
    mount();
    scan(PASS);
    expect(await screen.findByText('No connection')).toBeTruthy();
    scan(PASS);
    expect(await screen.findByText('Olivia Bennett')).toBeTruthy();
  });
});

describe('the scanner box', () => {
  it('sends what the scanner typed, trimmed, and empties itself', async () => {
    checkinService.scan.mockResolvedValue(checkedIn('Olivia Bennett'));
    mount();
    scan(`  ${PASS}  `);
    await screen.findByText('Olivia Bennett');
    expect(checkinService.scan).toHaveBeenCalledWith(PASS);
    expect(screen.getByLabelText(/scanner/i).value).toBe('');
  });

  it('an Enter with nothing typed sends nothing', () => {
    mount();
    scan('   ');
    expect(checkinService.scan).not.toHaveBeenCalled();
  });

  it('takes the focus back when something else takes it', async () => {
    mount();
    const box = screen.getByLabelText(/scanner/i);
    expect(document.activeElement).toBe(box);
    const camera = screen.getByRole('button', { name: /use the camera/i });
    camera.focus();
    fireEvent.blur(box);
    await waitFor(() => expect(document.activeElement).toBe(box));
  });
});

describe('the camera', () => {
  const stop = vi.fn();
  const restore = [];

  function stub(target, key, descriptor) {
    const before = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
    restore.push(() => (before === undefined ? delete target[key] : Object.defineProperty(target, key, before)));
  }

  beforeEach(() => {
    stop.mockClear();
    stub(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(() => Promise.resolve({ getTracks: () => [{ stop }] })) } });
    stub(HTMLMediaElement.prototype, 'readyState', { get: () => 4 });
    stub(HTMLVideoElement.prototype, 'videoWidth', { get: () => 640 });
    stub(HTMLVideoElement.prototype, 'videoHeight', { get: () => 480 });
    stub(HTMLMediaElement.prototype, 'play', { value: () => Promise.resolve() });
    stub(HTMLCanvasElement.prototype, 'getContext', {
      value: () => ({ drawImage: () => {}, getImageData: () => ({ data: new Uint8ClampedArray(4) }) }),
    });
  });

  afterEach(() => {
    while (restore.length > 0) restore.pop()();
  });

  it('reads a pass once, however many frames show it, and closing it turns the camera off', async () => {
    jsQR.mockReturnValue({ data: PASS });
    checkinService.scan.mockResolvedValue(checkedIn('Olivia Bennett'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /use the camera/i }));
    expect(await screen.findByText('Olivia Bennett')).toBeTruthy();
    // Several frames have been read by now; the one pass went once.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(jsQR.mock.calls.length).toBeGreaterThan(1);
    expect(checkinService.scan).toHaveBeenCalledTimes(1);
    expect(checkinService.scan).toHaveBeenCalledWith(PASS);

    fireEvent.click(screen.getByRole('button', { name: /close the camera/i }));
    expect(stop).toHaveBeenCalled();
  });

  it('a camera the browser refuses says what to do instead', async () => {
    navigator.mediaDevices.getUserMedia.mockImplementation(() => Promise.reject(new Error('NotAllowedError')));
    mount();
    fireEvent.click(screen.getByRole('button', { name: /use the camera/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/allow camera access/i);
  });
});
