import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, StyleSheet, View } from "react-native";
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

type Phase = "checking" | "setup" | "through";

export function SetupGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [phase, setPhase] = useState<Phase>(() => (session.setupDone() ? "through" : "checking"));

  const [known] = useState(phase === "through");

  useEffect(() => {
    if (known) return;
    const run = { live: true };
    // Read as a call, as the gate can be left while an answer is away.
    const live = () => run.live;
    const ask = async () => {
      const answer = await session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema);
      if (!live()) return;
      if (answer.kind !== "ok") {
        setPhase((now) => (now === "checking" ? "through" : now));
        return;
      }
      const done = answer.data.user.onboardingCompleted;
      await session.keepSetupDone(done);
      if (live()) setPhase(done ? "through" : "setup");
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
  }, [known, session]);

  const through = useCallback(() => {
    setPhase("through");
  }, []);

  if (phase === "through") return <>{children}</>;
  if (phase === "checking") return <View style={styles.page} />;
  return <Setup open mode="front" onClose={through} />;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
});
