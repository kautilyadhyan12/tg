// An indoor run's own boxes (ROADMAP Stage 5 item 37q-ii-a, as the drawing in `reviews/37q-ii-drawing`): the line under
// its distance saying where it is from, and, after Finish, Treadmill distance in the Route box's place.
import { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import type { RunDistanceFrom, Units } from "@app/shared";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import { indoorFromWords, treadmillWords, typedMetres } from "./indoorWords";
import { unitWord } from "./runWords";

/** "Indoor · from the treadmill", under an indoor run's distance. */
export function IndoorFrom({ from, steps, stepsOff }: { from: RunDistanceFrom; steps: number; stepsOff: boolean }) {
  return (
    <View style={styles.from}>
      <Icon name="house" size={16} colour="orange" />
      <Txt kind="small" colour="textSoft">
        {indoorFromWords(from, steps, stepsOff)}
      </Txt>
    </View>
  );
}

/** Treadmill distance, after Finish: what the treadmill showed, typed in the person's units. `stepsM` the steps' own
 *  distance, `taken` whether the run takes the typed one (the shared rule, as the server), `onTyped` the metres typed
 *  (null for none). What it means is said under the box, in one sentence. */
export function TreadmillCard({ units, stepsM, movingS, taken, onTyped }: {
  units: Units;
  stepsM: number;
  movingS: number;
  taken: boolean;
  onTyped: (metres: number | null) => void;
}) {
  const [typed, setTyped] = useState("");
  const metres = typedMetres(typed, units);
  useEffect(() => {
    onTyped(metres);
  }, [metres, onTyped]);
  const said = treadmillWords({ typedM: metres, taken, stepsM, movingS, units });
  return (
    <View style={styles.card} testID="treadmill-card">
      <View style={styles.words}>
        <Txt kind="h3">Treadmill distance</Txt>
        <Txt kind="small" colour="textSoft">
          Ran on a treadmill? Type the distance it shows.
        </Txt>
      </View>
      <View style={[styles.field, typed !== "" ? styles.fieldOn : null]}>
        <TextInput
          accessibilityLabel={`Treadmill distance in ${units === "imperial" ? "miles" : "kilometres"}`}
          value={typed}
          onChangeText={(text) => {
            setTyped(text.slice(0, 8));
          }}
          placeholder="0.00"
          placeholderTextColor={colours.textFaint}
          keyboardType="decimal-pad"
          maxLength={8}
          style={styles.input}
          selectionColor={colours.orange}
        />
        <Txt kind="body" colour="textSoft">
          {unitWord(units)}
        </Txt>
      </View>
      {said === null ? null : (
        <Txt kind="small" colour={said.good ? "goodText" : "badText"}>
          {said.text}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  from: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: -4 },
  card: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 16, gap: 12 },
  words: { gap: 3 },
  field: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderRadius: 14, backgroundColor: colours.field, borderWidth: 1, borderColor: colours.fieldLine, paddingHorizontal: 14 },
  fieldOn: { backgroundColor: colours.fieldOn, borderColor: colours.fieldOnLine },
  input: { flex: 1, minHeight: 50, fontFamily: fonts.bold, fontSize: 20, color: colours.text, paddingVertical: 10 },
});
