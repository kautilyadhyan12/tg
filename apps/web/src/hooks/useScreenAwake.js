import { useEffect } from 'react';

/** Keeps the screen from dimming and locking while the component is shown: a pass held up
 *  to the desk, or the desk's own tablet. The system lets go of it when the page is hidden,
 *  so it is asked for again when the page comes back. Nothing on a browser without it. */
export default function useScreenAwake() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    let over = false;

    const hold = async () => {
      if (over || document.visibilityState !== 'visible') return;
      try {
        const got = await navigator.wakeLock.request('screen');
        if (over) void got.release().catch(() => {});
        else lock = got;
      } catch {
        // Refused (a low battery): the screen dims as it always did.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void hold();
    };

    void hold();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      over = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release().catch(() => {});
    };
  }, []);
}
