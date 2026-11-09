import { useEffect } from "react";
import { AppState } from "react-native";
import type { TextStore } from "../screens/food/outbox";
import { createMinuteCounter, sendAsOwner, TICK_MS } from "./appMinutes";
import { useSession } from "./SessionProvider";
import { phoneTimeZone } from "./TimeZoneSync";

/** Counts the minutes the app is on screen for the person signed in (ROADMAP Stage 5 21f). Mounted
 *  once for each sign-in: another person gets another counter, and another file. */
export function AppMinutes({ userId, store }: { userId: string; store: (userId: string) => TextStore }): null {
  const { session } = useSession();

  useEffect(() => {
    const counter = createMinuteCounter({ store: store(userId), send: sendAsOwner(session, userId), now: () => Date.now(), zone: phoneTimeZone });
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = { live: true };
    const startTicking = () => {
      if (!run.live) return;
      counter.opened();
      timer ??= setInterval(() => void counter.tick(), TICK_MS);
    };
    const stopTicking = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    void counter.start().then(() => {
      if (AppState.currentState === "active") startTicking();
      // What an earlier opening counted and could not send, sent now.
      void counter.send();
    });
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        startTicking();
        void counter.send();
      } else {
        stopTicking();
        void counter.closed();
      }
    });
    return () => {
      run.live = false;
      heard.remove();
      stopTicking();
      // Signed out or another person: what was counted is kept in this person's own file, for their next sign-in.
      void counter.closed(false);
    };
  }, [session, userId, store]);

  return null;
}
