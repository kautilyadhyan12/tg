import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { PhoneAppExtra } from "@app/shared";
import { Button } from "../look/Button";
import { Badge, Card } from "../look/Card";
import { Txt } from "../look/Txt";
import { checkServer, type ServerState } from "../serverCheck";

export type Ask = Parameters<typeof checkServer>[1];

/** Which folder's copy this is and how it asks its server; null when the copy opened with no settings. */
export const CopyContext = createContext<{ extra: PhoneAppExtra | null; ask: Ask }>({ extra: null, ask: fetch });

/** A test copy says which folder's it is and whether it reaches that folder's server. */
export function ThisCopy() {
  const { extra, ask } = useContext(CopyContext);
  const [state, setState] = useState<ServerState | "checking">("checking");

  const check = useCallback(() => {
    if (extra === null) return;
    setState("checking");
    void checkServer(extra.apiUrl, ask).then(setState);
  }, [extra, ask]);

  useEffect(check, [check]);

  return (
    <Card>
      <View style={styles.head}>
        <Badge icon="phone" tone="plain" />
        <Txt kind="h3">This copy of the app</Txt>
      </View>
      {extra === null ? (
        <Txt colour="badText">
          This copy of the app has no settings. Stop it and start it again from the laptop.
        </Txt>
      ) : (
        <>
          {extra.copyName === undefined ? null : <Txt>This is the {extra.copyName} copy, for testing.</Txt>}
          {state === "checking" ? (
            <Txt>Checking the server…</Txt>
          ) : state === "connected" ? (
            <Txt colour="goodText">Connected to the server.</Txt>
          ) : (
            <>
              <Txt colour="badText">
                Can’t reach the server. Check that the phone’s cable is in and the server is running on the
                laptop.
              </Txt>
              <Button label="Try again" kind="plain" onPress={check} wide />
            </>
          )}
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
});
