import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CURRENT_DISCLAIMER_VERSION,
  DISCLAIMER_WORDINGS,
  consentRecordResponseSchema,
  userProfileResponseSchema,
} from "@app/shared";
import { appVersion } from "../appExtra";
import { Button } from "../look/Button";
import { Card, Logo } from "../look/Card";
import { colours, orangeGradient, sizes } from "../look/colours";
import { Icon } from "../look/Icon";
import { fonts, Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { NO_ANSWER } from "./SignIn";

// "Before you start": the sign-up note (RULINGS 2026-09-14; ROADMAP Stage 5 item 12c), the
// browser's own page fitted to a phone. Nothing of the app is shown until the server holds
// this person's tick on today's words; a tick it confirmed is kept with the sign-in on the
// phone, so the app opens with no internet for a person who ticked.

export const NOTE_VERSION = CURRENT_DISCLAIMER_VERSION.sign_up;
const noteWords = DISCLAIMER_WORDINGS.sign_up[NOTE_VERSION];
if (noteWords === undefined) throw new Error(`no words for the sign-up note ${NOTE_VERSION}`);
export const NOTE_WORDS = noteWords;

/** How long the server is waited for before the note is shown anyway, with its tick ready. */
export const NOTE_CHECK_WAIT_MS = 3_000;

type Phase = "checking" | "ask" | "through";

/** The tabs, once this person's tick on today's note is known; until then, the note. */
export function SignUpNoteGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [phase, setPhase] = useState<Phase>(() => (session.signUpNote() === NOTE_VERSION ? "through" : "checking"));
  const [offline, setOffline] = useState(false);
  // Asked once, when this person's app opens; its answer counts even after the note is shown.
  const [checkServer] = useState(phase === "checking");

  useEffect(() => {
    if (!checkServer) return;
    // Left by a sign-out or another person while the server was away: its answer is nobody's.
    const run = { live: true };
    const shown = setTimeout(() => {
      if (run.live) setPhase((now) => (now === "checking" ? "ask" : now));
    }, NOTE_CHECK_WAIT_MS);
    void (async () => {
      const answer = await session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema);
      if (!run.live) return;
      if (answer.kind === "ok" && answer.data.user.signUpDisclaimerAgreed) {
        setPhase("through");
        await session.keepSignUpNote(NOTE_VERSION);
        return;
      }
      setOffline(answer.kind !== "ok");
      setPhase((now) => (now === "through" ? now : "ask"));
    })();
    return () => {
      run.live = false;
      clearTimeout(shown);
    };
  }, [checkServer, session]);

  if (phase === "through") return <>{children}</>;
  if (phase === "checking") return <View style={styles.page} />;
  return (
    <BeforeYouStart
      problemAtStart={offline ? NO_ANSWER : ""}
      onThrough={() => {
        setPhase("through");
      }}
    />
  );
}

function BeforeYouStart({ problemAtStart, onThrough }: { problemAtStart: string; onThrough: () => void }) {
  const { session } = useSession();
  const insets = useSafeAreaInsets();
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Continue's write to the phone is away: Sign out waits for it. */
  const [going, setGoing] = useState(false);
  const [problem, setProblem] = useState(problemAtStart);

  useEffect(() => {
    setProblem(problemAtStart);
  }, [problemAtStart]);

  /** Kept on the server the moment it is made, as the browser does: Continue waits for it. */
  const tick = async () => {
    setBusy(true);
    setProblem("");
    const answer = await session.signedIn(
      {
        method: "POST",
        path: "/v1/users/me/consents",
        body: { purpose: "sign_up", wordingVersion: NOTE_VERSION, appVersion: appVersion() },
      },
      consentRecordResponseSchema,
    );
    setBusy(false);
    if (answer.kind === "ok") setTicked(true);
    else setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
  };

  const goOn = async () => {
    setGoing(true);
    await session.keepSignUpNote(NOTE_VERSION);
    onThrough();
  };

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={[styles.fill, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={styles.brand}>
        <Logo />
        <Txt kind="strong" style={styles.brandName}>
          AI Home Gym
        </Txt>
      </View>

      <Txt kind="hero">Before you start</Txt>

      <Card style={styles.card}>
        <Txt colour="text" style={styles.words}>
          {NOTE_WORDS}
        </Txt>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel="I have read and understood this"
          accessibilityState={{ checked: ticked, disabled: ticked || busy, busy }}
          disabled={ticked || busy}
          onPress={() => void tick()}
          style={styles.tickRow}
        >
          <View testID="note-tick-box" style={[styles.box, ticked ? styles.boxOn : null]}>
            {ticked ? <Icon name="check" size={13} colour="onOrange" /> : null}
          </View>
          <Txt colour={ticked ? "text" : "textSoft"} style={styles.tickLabel}>
            I have read and understood this
          </Txt>
        </Pressable>
        {ticked ? null : <Txt kind="tiny">Tick this to continue.</Txt>}
      </Card>

      {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}

      <Button label="Continue" wide disabled={!ticked} busy={busy || going} onPress={() => void goOn()} />
      <Button
        label="Sign out"
        kind="quiet"
        icon="logout"
        style={styles.middle}
        disabled={busy || going}
        onPress={() => void session.signOut()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  fill: { flexGrow: 1, justifyContent: "center", paddingHorizontal: sizes.edge, gap: 20 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandName: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  card: { padding: 18, gap: 14 },
  words: { fontSize: 14, lineHeight: 22 },
  tickRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.press },
  box: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colours.textFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { borderColor: colours.orange, backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  tickLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  middle: { alignSelf: "center" },
});
