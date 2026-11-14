import { StyleSheet, View } from "react-native";
import { colours } from "../../look/colours";
import { Txt } from "../../look/Txt";
import { count } from "../dashboard/words";
import { kcalWords } from "./day";

// A meal's numbers as Kd's drawings 2c and 3 have them, the same in Your meal and a meal photo's review.

/** A food's calories as Kd's drawing 3 has them: the number bold, "kcal" small beside it. */
export function Kcal({ words }: { words: string }) {
  const at = words.lastIndexOf(" kcal");
  if (at < 0) {
    return (
      <Txt kind="small" colour="text">
        {words}
      </Txt>
    );
  }
  return (
    <Txt kind="tiny" colour="textSoft">
      <Txt kind="strong">{words.slice(0, at)}</Txt> kcal
    </Txt>
  );
}

/** A meal's four numbers in four small cards (Kd's drawings 2c and 3c): calories in orange, then
 *  protein, carbs and fat, read aloud as one (`say`, where the screen has its own words for them). */
export function MealCards({ totals, say }: { totals: { kcalPoint: number; proteinG: number; carbsG: number; fatG: number }; say?: string }) {
  const cards = [
    { value: count(Math.round(totals.kcalPoint)), label: "kcal" },
    { value: `${count(Math.round(totals.proteinG))} g`, label: "Protein" },
    { value: `${count(Math.round(totals.carbsG))} g`, label: "Carbs" },
    { value: `${count(Math.round(totals.fatG))} g`, label: "Fat" },
  ];
  return (
    <View
      style={styles.cards}
      accessible
      accessibilityLabel={say ?? `${kcalWords(totals.kcalPoint)}, ${count(Math.round(totals.proteinG))} g protein, ${count(Math.round(totals.carbsG))} g carbs, ${count(Math.round(totals.fatG))} g fat`}
    >
      {cards.map((c, i) => (
        <View key={c.label} style={styles.card}>
          <Txt kind="strong" colour={i === 0 ? "orange" : "text"} numberOfLines={1} fit>
            {c.value}
          </Txt>
          <Txt kind="tiny" numberOfLines={1}>
            {c.label}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: "row", gap: 8 },
  card: { flex: 1, minHeight: 56, justifyContent: "center", paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.glass },
});
