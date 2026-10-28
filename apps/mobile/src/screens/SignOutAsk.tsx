import { StyleSheet, View } from "react-native";
import { Button } from "../look/Button";
import { Sheet } from "../look/Sheet";
import { useSession } from "../session/SessionProvider";

/** "Sign out?" from the bottom: nothing happens until the person says so. */
export function SignOutAsk({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session } = useSession();
  return (
    <Sheet open={open} title="Sign out?" onClose={onClose}>
      <View style={styles.two}>
        <Button label="Cancel" kind="plain" style={styles.half} onPress={onClose} />
        <Button label="Sign out" kind="danger" icon="logout" style={styles.half} onPress={() => void session.signOut()} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
