import { useEffect, useRef } from 'react';
import { useCameBack } from './useCameBack';

// CLAUDE.md §4, Pages stay current by themselves: the worker's answer from Square tells no page, so a list holding a refund
// still with Square reads again every 30 seconds, for at most 15 minutes, and whenever staff come back to it.
const EVERY_MS = 30_000;
const AT_MOST_MS = 15 * 60_000;

export function useReadWhileSquareWaits(waiting, read, everyMs = EVERY_MS) {
  const latest = useRef(read);
  useEffect(() => {
    latest.current = read;
  });
  useCameBack(waiting, () => latest.current());
  useEffect(() => {
    if (!waiting) return undefined;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > AT_MOST_MS) {
        clearInterval(timer);
        return;
      }
      latest.current();
    }, everyMs);
    return () => clearInterval(timer);
  }, [waiting, everyMs]);
}
