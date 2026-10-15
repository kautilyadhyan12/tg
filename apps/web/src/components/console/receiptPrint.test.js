// @vitest-environment jsdom
// PRINTING ONE RECEIPT (ROADMAP 18g-i): the page goes in a frame nobody sees, the frame is
// printed on the next turn, and the frame goes once the print window has closed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { printHtml } from './receiptPrint';

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('iframe').forEach((f) => f.remove());
});

describe('printHtml', () => {
  it('prints a hidden frame holding the receipt alone, then takes the frame away', () => {
    vi.useFakeTimers();
    printHtml('<!doctype html><html><head><title>Receipt #7</title></head><body><p>Receipt no. 7</p></body></html>');
    const frame = document.querySelector('iframe[title="Receipt to print"]');
    expect(frame).not.toBeNull();
    expect(frame.style.visibility).toBe('hidden');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.contentDocument.body.textContent).toBe('Receipt no. 7');
    const print = vi.spyOn(frame.contentWindow, 'print').mockImplementation(() => undefined);
    vi.advanceTimersByTime(0);
    expect(print).toHaveBeenCalledTimes(1);
    frame.contentWindow.dispatchEvent(new Event('afterprint'));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('a print window that never says it closed still loses its frame in time', () => {
    vi.useFakeTimers();
    printHtml('<p>Receipt no. 8</p>');
    const frame = document.querySelector('iframe');
    vi.spyOn(frame.contentWindow, 'print').mockImplementation(() => undefined);
    vi.advanceTimersByTime(60_000);
    expect(document.querySelector('iframe')).toBeNull();
  });
});
