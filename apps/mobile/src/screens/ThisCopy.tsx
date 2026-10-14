import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { PhoneAppExtra } from "@app/shared";
import { Button } from "../look/Button";
import { Txt } from "../look/Txt";
import { checkServer, type ServerState } from "../serverCheck";

export type Ask = Parameters<typeof checkServer>[1];

/** Which folder's copy this is and how it asks its server; null when the copy opened with no settings. */
export const CopyContext = createContext<{ extra: PhoneAppExtra | null; ask: Ask }>({ extra: null, ask: fetch });

/** A test copy says, in one line, which folder's it is and whether it reaches that folder's server. */
export function ThisCopy() {
  const { extra, ask } = useContext(CopyContext);
  const [state, setState] = useState<ServerState | "checking">("checking");

  const newest = useRef(0);

  const check = useCallback(() => {
    if (extra === null) return;
    const mine = ++newest.current;
    setState("checking");
    // Only the newest check's answer is shown, whichever comes back last.
    void checkServer(extra.apiUrl, ask).then((answer) => {
      if (mine === newest.current) setState(answer);
    });
  }, [extra, ask]);

  useEffect(check, [check]);

  if (extra === null) {
    return (
      <Txt kind="small" colour="badText" style={styles.centre}>
        This copy of the app has no settings. Stop it and start it again from the laptop.
      </Txt>
    );
  }
  // The store's app has no copy to name: it says nothing here while its server is reached.
  if (extra.copyName === undefined && state !== "unreachable") return null;
  const copy = extra.copyName === undefined ? "" : `${extra.copyName} test copy · `;
  if (state === "unreachable") {
    return (
      <View style={styles.row}>
        <Txt kind="small" colour="badText">
          {copy}Can’t reach the server
        </Txt>
        <Button label="Try again" kind="link" onPress={check} />
      </View>
    );
  }
  return (
    <Txt kind="small" colour="textFaint" style={styles.centre}>
      {copy}
      {state === "checking" ? "Checking…" : "Connected"}
    </Txt>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8 },
  centre: { textAlign: "center" },
});
