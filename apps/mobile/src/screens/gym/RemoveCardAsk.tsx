import { StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { REMOVE_CARD, removeCardLine, removeCardTitle } from "./cardView";

/** What the box is showing: the card asked about, a press on its way, and a refusal's words. */
export interface RemoveAsk {
  card: { brand: string; last4: string };
  gymName: string;
  busy: boolean;
  problem: string | null;
  /** The refusal stands whatever is pressed: only Close is left. */
  final: boolean;
}

/** "Remove Visa ending 1111?" from the bottom (Stage 5 item 20e): nothing happens until the member says so. */
export function RemoveCardAsk({ ask, onRemove, onClose }: { ask: RemoveAsk | null; onRemove: () => void; onClose: () => void }) {
  return (
    <Sheet open={ask !== null} title={ask === null ? "" : removeCardTitle(ask.card)} onClose={onClose}>
      {ask === null ? null : (
        <View style={styles.body}>
          <Txt colour="textSoft">{removeCardLine(ask.gymName)}</Txt>
          {ask.problem === null ? null : (
            <View testID="remove-problem">
              <Txt colour="badText">{ask.problem}</Txt>
            </View>
          )}
          {ask.final ? (
            <Button label="Close" kind="plain" onPress={onClose} />
          ) : (
            <View style={styles.two}>
              <Button label="Cancel" kind="plain" style={styles.half} onPress={onClose} />
              <Button label={REMOVE_CARD} kind="danger" icon="trash" busy={ask.busy} style={styles.half} onPress={onRemove} />
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 14 },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
