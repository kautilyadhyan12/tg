import { useEffect, useState } from "react";
import { screenCaptureNative } from "./screenCaptureNative";

/** Screenshots and screen recordings blank while `on` (Add card's card numbers, 20d); true once the mark is on, and the
 *  page is opened only then. A page over the app (`Modal`) is a window of its own, and Android copies the mark into it
 *  only when it opens. Off again when `on` ends or the screen goes. A phone that cannot (an older copy of the app, a
 *  mark refused) still opens the page. */
export function useNoScreenshots(on: boolean): boolean {
  const [marked, setMarked] = useState(false);
  useEffect(() => {
    if (!on) return;
    const native = screenCaptureNative;
    if (native === null) {
      setMarked(true);
      return () => {
        setMarked(false);
      };
    }
    let live = true;
    const opened = () => {
      if (live) setMarked(true);
    };
    native.preventScreenCapture().then(opened, opened);
    return () => {
      live = false;
      setMarked(false);
      // Sent after the mark, on the same queue: never left on by a page closed while it was being set.
      native.allowScreenCapture().catch(() => undefined);
    };
  }, [on]);
  return on && marked;
}
