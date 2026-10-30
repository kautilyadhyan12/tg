import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { mealPreviewSchema, type OwnFoodItem } from "@app/shared";
import { Button } from "../../look/Button";
import { Field } from "../../look/Field";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { kcalWords } from "./day";
import { formatAmount } from "./measures";
import { ownFoodOf, type Typed } from "./ownFoodRule";

// A food no list has, added with the person's own numbers (ROADMAP Stage 5 33b-i; Kd, 2026-10-30), as
// MyFitnessPal's Quick Add and Cronometer's custom food: its name, how much was eaten, and its protein,
// carbs and fat for that much. The server prices it, its calories from those three (4, 4 and 9 a gram).

const typedOf = (food: OwnFoodItem | null, name: string, grams: number | null): Typed =>
  food === null
    ? { name, grams: grams === null ? "" : formatAmount(grams), proteinG: "", carbsG: "", fatG: "" }
    : { name: food.name, grams: formatAmount(food.grams), proteinG: formatAmount(food.own.proteinG), carbsG: formatAmount(food.own.carbsG), fatG: formatAmount(food.own.fatG) };

/** The form: the food being changed, or the name the search was for and the grams the food it takes
 *  the place of weighs. `action` names the button: "Add" or "Save". */
export function OwnFood({
  start,
  name,
  grams = null,
  action,
  onDone,
}: {
  start: OwnFoodItem | null;
  name: string;
  grams?: number | null;
  action: "Add" | "Save";
  onDone: (food: OwnFoodItem) => void;
}) {
  const { session } = useSession();
  const [typed, setTyped] = useState<Typed>(() => typedOf(start, name, grams === null ? null : Math.max(1, Math.round(grams))));
  const [kcal, setKcal] = useState<{ for: string; kcal: number } | null>(null);
  // What is missing is said once the person has typed anything, never as a grey button alone.
  const [touched, setTouched] = useState(false);
  const made = ownFoodOf(typed);
  const key = "food" in made ? JSON.stringify(made.food) : "";

  // The server's calories for it, a moment after it changes.
  useEffect(() => {
    if (key === "") return undefined;
    let stale = false;
    const timer = setTimeout(() => {
      void session.signedIn({ method: "POST", path: "/v1/nutrition/meals/preview", body: { items: [JSON.parse(key) as unknown] } }, mealPreviewSchema).then((answer) => {
        if (!stale && answer.kind === "ok") setKcal({ for: key, kcal: answer.data.totals.kcalPoint });
      });
    }, 300);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [key, session]);

  const set = (field: keyof Typed) => (value: string) => {
    setTouched(true);
    setTyped((now) => ({ ...now, [field]: value }));
  };
  const shown = kcal !== null && kcal.for === key ? kcal.kcal : null;
  return (
    <View style={styles.form}>
      <Field label="Food name" value={typed.name} onChange={set("name")} maxLength={80} />
      <Field label="How much you ate, in grams" value={typed.grams} onChange={set("grams")} keyboard="decimal-pad" maxLength={8} />
      <View style={styles.three}>
        <View style={styles.grow}>
          <Field label="Protein (g)" value={typed.proteinG} onChange={set("proteinG")} keyboard="decimal-pad" maxLength={8} />
        </View>
        <View style={styles.grow}>
          <Field label="Carbs (g)" value={typed.carbsG} onChange={set("carbsG")} keyboard="decimal-pad" maxLength={8} />
        </View>
        <View style={styles.grow}>
          <Field label="Fat (g)" value={typed.fatG} onChange={set("fatG")} keyboard="decimal-pad" maxLength={8} />
        </View>
      </View>
      <Txt kind="tiny">Calories are worked out from protein, carbs and fat.</Txt>
      {"missing" in made && touched ? (
        <Txt kind="small" colour="badText">
          {made.missing}
        </Txt>
      ) : null}
      <Button
        label={"food" in made ? `${action} ${made.food.name}${shown === null ? "" : ` · ${kcalWords(shown)}`}` : action}
        wide
        disabled={!("food" in made)}
        onPress={() => {
          if ("food" in made) onDone(made.food);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  three: { flexDirection: "row", gap: 8 },
  grow: { flex: 1 },
});
