import { useEffect, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { myInvitationsResponseSchema, type MyInvitation } from "@app/shared";
import { Button } from "../look/Button";
import { Logo } from "../look/Card";
import { colours, sizes } from "../look/colours";
import { fonts, Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { InvitationList, invitationsPath } from "./Invitation";
import { NOTE_CHECK_WAIT_MS } from "./BeforeYouStart";

// "You're invited" (spec Part 3 §10.2): straight after "Before you start", a person whose address
// a gym has invited answers it before the tabs, so somebody who stops halfway through setup is
// already in their gym. It is asked only when the phone has already reached the server (a sign-in,
// or a refresh that is done), so opening with no internet never waits for it; a read that fails,
// or has not answered in a few seconds, lets them on. The Gym tab lists the same invitations.

type Phase = { kind: "checking" } | { kind: "ask"; invitations: MyInvitation[] } | { kind: "through" };

export function InvitationsGate({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [phase, setPhase] = useState<Phase>(() => (session.accessToken() === null ? { kind: "through" } : { kind: "checking" }));
  const [ask] = useState(phase.kind === "checking");

  useEffect(() => {
    if (!ask) return;
    const run = { live: true };
    const shown = setTimeout(() => {
      if (run.live) setPhase((now) => (now.kind === "checking" ? { kind: "through" } : now));
    }, NOTE_CHECK_WAIT_MS);
    void (async () => {
      const answer = await session.signedIn({ method: "GET", path: invitationsPath }, myInvitationsResponseSchema);
      if (!run.live) return;
      const waiting = answer.kind === "ok" ? answer.data.invitations.filter((one) => one.state === "pending") : [];
      // A late answer never puts this in front of tabs already open.
      setPhase((now) => (now.kind !== "checking" ? now : waiting.length === 0 ? { kind: "through" } : { kind: "ask", invitations: waiting }));
    })();
    return () => {
      run.live = false;
      clearTimeout(shown);
    };
  }, [ask, session]);

  if (phase.kind === "through") return <>{children}</>;
  if (phase.kind === "checking") return <View style={styles.page} />;
  return (
    <YoureInvited
      invitations={phase.invitations}
      onDone={() => {
        setPhase({ kind: "through" });
      }}
    />
  );
}

function YoureInvited({ invitations, onDone }: { invitations: MyInvitation[]; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const allAnswered = invitations.every((one) => answered.has(one.id));
  return (
    <ScrollView
      style={styles.page}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.fill, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
    >
      <View style={styles.brand}>
        <Logo />
        <Txt kind="strong" style={styles.brandName}>
          AI Home Gym
        </Txt>
      </View>
      <View style={styles.head}>
        <Txt kind="hero">{invitations.length === 1 ? "You’re invited" : `You have ${String(invitations.length)} invitations`}</Txt>
        <Txt>You can also reply later from the Gym tab.</Txt>
      </View>
      <InvitationList
        invitations={invitations}
        onAnswered={(id) => {
          setAnswered((before) => new Set(before).add(id));
        }}
      />
      <View style={styles.grow} />
      {allAnswered ? (
        <Button label="Continue" wide onPress={onDone} />
      ) : (
        <Button label="Not now" kind="quiet" style={styles.middle} onPress={onDone} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  fill: { flexGrow: 1, paddingHorizontal: sizes.edge, gap: 20 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandName: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  head: { gap: 8, marginTop: 12 },
  middle: { alignSelf: "center" },
  grow: { flex: 1 },
});
