import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, AppState, StyleSheet, View } from "react-native";
import { userProfileResponseSchema } from "@app/shared";
import { colours } from "../look/colours";
import { useSession } from "../session/SessionProvider";
import { NOTE_CHECK_WAIT_MS } from "./BeforeYouStart";
import { Setup } from "./setup/Setup";

// Setup in front of the tabs until it is finished (ROADMAP Stage 5 item 14c; the browser's own rule):
// after "Before you start" and any invitation, a person who has not finished setup meets it, with
// Sign out its only way out. A finish the server confirmed is kept with the sign-in, and the
// server is not asked again. Until then it is asked on every opening; with no internet, or no
// answer in a few seconds, the tabs open, as the other gates do, and it is asked again each time
// the app comes back to the front. Unlike the invitations, an answer that says "not finished"
// puts setup in front of tabs already open, a late first answer as well: nobody uses the app
// without setup. An answer that says "finished" (in the browser, say) lets them through.
//
// A look first (14d, Kd 2026-11-07): a sign-in made in this run of the app shows the tabs for
// LOOK_MS, counted while the app is in front, then setup comes up over them. Meanwhile a press on
// any tab's page opens setup at once; the tab bar and scrolling stay free. Reopened unfinished,
// setup comes at once. A screen reader skips the look: the pages are hidden from it while it lasts.

export const LOOK_MS = 8_000;

/** "look": the tabs, look only; "over": setup over the tabs after the look; "setup": setup alone. */
type Phase = "checking" | "look" | "over" | "setup" | "through";

/** While the person is looking, what a press on a page does: open setup. Null otherwise. */
const LookContext = createContext<(() => void) | null>(null);

/** Round each tab's page. While the person is looking it takes every touch that starts on the page
 *  before any button can, and a touch let go there opens setup; a drag is the page's own scroll. */
export function LookOnly({ children }: { children: ReactNode }) {
  const openSetup = useContext(LookContext);
  if (openSetup === null) return <>{children}</>;
  return (
    <View
      testID="look only"
      style={styles.fill}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      onStartShouldSetResponderCapture={() => true}
      onResponderTerminationRequest={() => true}
      onResponderRelease={openSetup}
    >
      {children}
    </View>
  );
}

export function SetupGate({ children, lookMs = LOOK_MS }: { children: ReactNode; lookMs?: number }) {
  const { session } = useSession();
  const [phase, setPhase] = useState<Phase>(() => (session.setupDone() ? "through" : "checking"));

  const [known] = useState(phase === "through");
  // Read once: a sign-in made in this run is given the look; one read from the key store is not.
  const [lookable] = useState(() => session.signedInHere());
  const looked = useRef(false);

  useEffect(() => {
    if (known) return;
    const run = { live: true };
    // Read as a call, as the gate can be left while an answer is away.
    const live = () => run.live;
    const notDone = (now: Phase): Phase => {
      if (now === "look" || now === "over" || now === "setup") return now;
      return lookable && !looked.current ? "look" : "setup";
    };
    const ask = async () => {
      const answer = await session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema);
      if (!live()) return;
      if (answer.kind !== "ok") {
        setPhase((now) => (now === "checking" ? "through" : now));
        return;
      }
      const done = answer.data.user.onboardingCompleted;
      await session.keepSetupDone(done);
      if (live()) setPhase((now) => (done ? "through" : notDone(now)));
    };
    const shown = setTimeout(() => {
      if (run.live) setPhase((now) => (now === "checking" ? "through" : now));
    }, NOTE_CHECK_WAIT_MS);
    void ask();
    const front = AppState.addEventListener("change", (state) => {
      if (state === "active" && !session.setupDone()) void ask();
    });
    return () => {
      run.live = false;
      clearTimeout(shown);
      front.remove();
    };
  }, [known, lookable, session]);

  const openSetup = useCallback(() => {
    setPhase((now) => (now === "look" ? "over" : now));
  }, []);

  // The look's time runs only while the app is in front.
  useEffect(() => {
    if (phase !== "look") return;
    looked.current = true;
    let left = lookMs;
    let since = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const go = () => {
      since = Date.now();
      timer = setTimeout(openSetup, left);
    };
    go();
    const heard = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (timer === null) go();
        return;
      }
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      left = Math.max(0, left - (Date.now() - since));
    });
    void AccessibilityInfo.isScreenReaderEnabled().then(
      (on) => {
        if (on) openSetup();
      },
      () => undefined,
    );
    return () => {
      if (timer !== null) clearTimeout(timer);
      heard.remove();
    };
  }, [phase, lookMs, openSetup]);

  const through = useCallback(() => {
    setPhase("through");
  }, []);

  if (phase === "checking") return <View style={styles.page} />;
  if (phase === "setup") return <Setup open mode="front" onClose={through} />;
  // One shape for the look, setup over it and the way through, so the tabs are never drawn again.
  return (
    <>
      <LookContext.Provider value={phase === "look" ? openSetup : null}>{children}</LookContext.Provider>
      {phase === "over" ? <Setup open mode="front" onClose={through} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  fill: { flex: 1 },
});
