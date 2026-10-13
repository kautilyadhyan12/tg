import { useCallback, useEffect, useState } from "react";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { readAppExtra } from "./appExtra";
import { checkServer, type ServerState } from "./serverCheck";

// Item 11 draws the app's look and its building blocks; this first screen has
// only these colours, in the light look alone, and they go when it does.
const look = {
  page: "#ffffff",
  ink: "#111827",
  soft: "#4b5563",
  good: "#15803d",
  bad: "#b91c1c",
  button: "#111827",
  onButton: "#ffffff",
};

const extra = readAppExtra();

export function App() {
  const [state, setState] = useState<ServerState | "checking">("checking");

  const check = useCallback(() => {
    if (extra === null) return;
    setState("checking");
    void checkServer(extra.apiUrl, fetch).then(setState);
  }, []);

  useEffect(check, [check]);

  return (
    <View style={[styles.page, { backgroundColor: look.page }]}>
      <StatusBar barStyle="dark-content" backgroundColor={look.page} />
      <Text style={[styles.title, { color: look.ink }]}>AI Home Gym</Text>
      {extra === null ? (
        <Text style={[styles.line, { color: look.bad }]}>
          This copy of the app has no settings. Stop it and start it again from the laptop.
        </Text>
      ) : (
        <>
          {extra.copyName === undefined ? null : (
            <Text style={[styles.line, { color: look.soft }]}>
              This is the {extra.copyName} copy, for testing.
            </Text>
          )}
          {state === "checking" ? (
            <Text style={[styles.line, { color: look.soft }]}>Checking the server…</Text>
          ) : state === "connected" ? (
            <Text style={[styles.line, { color: look.good }]}>Connected to the server.</Text>
          ) : (
            <>
              <Text style={[styles.line, { color: look.bad }]}>
                Can&apos;t reach the server. Check that the phone&apos;s cable is in and the server
                is running on the laptop.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={check}
                style={[styles.button, { backgroundColor: look.button }]}
              >
                <Text style={[styles.buttonText, { color: look.onButton }]}>Try again</Text>
              </Pressable>
            </>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: "700" },
  line: { fontSize: 16, lineHeight: 22, textAlign: "center" },
  button: {
    minHeight: 48,
    minWidth: 160,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    marginTop: 8,
  },
  buttonText: { fontSize: 16, fontWeight: "600" },
});
