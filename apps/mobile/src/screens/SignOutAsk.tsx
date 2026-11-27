import { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../look/Button";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { runNow, subscribeRun } from "./running/recorder";

/** "Sign out?" from the bottom: nothing happens until the person says so. A run of theirs not saved yet is
 *  finished and saved first (37o), and the box says so. */
export function SignOutAsk({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, state } = useSession();
  const run = useSyncExternalStore(subscribeRun, runNow);
  const mine = run !== null && state.kind === "in" && run.userId === state.user.id ? run : null;
  return (
    <Sheet open={open} title="Sign out?" onClose={onClose}>
      {mine === null ? null : (
        <Txt kind="body" colour="textSoft" style={styles.line}>
          {mine.phase === "finished" ? "Your run will be saved first." : "Your run will be finished and saved first."}
        </Txt>
      )}
      <View style={styles.two}>
        <Button label="Cancel" kind="plain" style={styles.half} onPress={onClose} />
        <Button label="Sign out" kind="danger" icon="logout" style={styles.half} onPress={() => void session.signOut()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  line: { marginBottom: 16 },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
