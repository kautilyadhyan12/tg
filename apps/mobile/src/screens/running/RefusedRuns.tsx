// Runs the server would not take, kept whole on the phone (round one of 37a, H1), each with Try again
// and Remove; Remove asks first. Shown on the Running page and at the top of Your runs (37c-i), so
// both say the same of them.
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useRunOutbox } from "./RunOutbox";

export function RefusedRuns() {
  const { view, outbox } = useRunOutbox();
  const [removing, setRemoving] = useState<{ runId: string; name: string } | null>(null);
  return (
    <>
      {view.refused.map((r) => (
        <View key={r.runId} style={styles.problem}>
          <Txt kind="small" colour="badText">
            {`${r.name}: ${r.message}`}
          </Txt>
          <View style={styles.choices}>
            {r.run === undefined ? null : (
              <Button
                kind="link"
                label="Try again"
                say={`Send ${r.name} again`}
                onPress={() => {
                  void outbox?.retryRefused(r.runId).then(() => outbox.send());
                }}
              />
            )}
            <Button
              kind="dangerLink"
              label="Remove"
              say={`Remove ${r.name}`}
              onPress={() => {
                setRemoving({ runId: r.runId, name: r.name });
              }}
            />
          </View>
        </View>
      ))}
      <Sheet
        open={removing !== null}
        title="Remove this run?"
        onClose={() => {
          setRemoving(null);
        }}
      >
        <Txt kind="body" colour="textSoft">
          {`${removing?.name ?? "This run"} will be deleted from this phone. It was never saved.`}
        </Txt>
        <Button
          kind="danger"
          label="Remove run"
          wide
          onPress={() => {
            if (removing !== null) outbox?.removeRefused(removing.runId);
            setRemoving(null);
          }}
        />
        <Button
          kind="link"
          label="Keep it"
          style={styles.middle}
          onPress={() => {
            setRemoving(null);
          }}
        />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  problem: { gap: 4, alignItems: "flex-start" },
  choices: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  middle: { alignSelf: "center" },
});
