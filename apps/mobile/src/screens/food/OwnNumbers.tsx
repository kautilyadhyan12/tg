import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { nutritionTargetsResponseSchema, type NutritionTargetsResponse, type OwnNutritionTargets } from "@app/shared";
import { Button } from "../../look/Button";
import { Options } from "../../look/Choice";
import { Field } from "../../look/Field";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { count } from "../dashboard/words";
import { fourWords, holdWords, macroKcal, wholeNumber } from "./numbers";

// The rings' numbers (ROADMAP 32b-ii-b; RULINGS 2026-09-17): the app's plan, or the person's own four
// numbers, as the browser's switch over the rings offers them. Every rule is the server's: whether
// typed calories are allowed (the app's floor, and no cut below what keeps the weight for a plan that
// holds none), and whether stored numbers are held because the answers under them changed. This shows
// what it says and sends what was typed; it never decides a number. A gym's plan joins the two once a
// gym can write one (ROADMAP 19e): a choice with nothing behind it is not shown.

const NO_CONNECTION = "No connection. Try again.";

const FIELDS = [
  { key: "kcal", label: "Calories (kcal)" },
  { key: "proteinG", label: "Protein (g)" },
  { key: "carbsG", label: "Carbs (g)" },
  { key: "fatG", label: "Fat (g)" },
] as const;
type Key = (typeof FIELDS)[number]["key"];

type Source = NutritionTargetsResponse["source"];

/** The box: the app's plan or your own numbers, and one Save. `onSaved` has the server's answer. */
export function OwnNumbers({
  open,
  targets,
  onClose,
  onSaved,
}: {
  open: boolean;
  targets: NutritionTargetsResponse;
  onClose: () => void;
  onSaved: (answer: NutritionTargetsResponse) => void;
}) {
  const { session } = useSession();
  const { height } = useWindowDimensions();
  const start = targets.own ?? targets.appTargets;
  const typedFrom = (): Record<Key, string> => ({
    kcal: start === null ? "" : String(start.kcal),
    proteinG: start === null ? "" : String(start.proteinG),
    carbsG: start === null ? "" : String(start.carbsG),
    fatG: start === null ? "" : String(start.fatG),
  });
  const [choice, setChoice] = useState<Source>(targets.source);
  const [typed, setTyped] = useState<Record<Key, string>>(typedFrom);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setChoice(targets.source);
    setTyped(typedFrom());
    setBusy(false);
    setTrouble(null);
    // Opened afresh from what the server last said.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const values = { kcal: wholeNumber(typed.kcal), proteinG: wholeNumber(typed.proteinG), carbsG: wholeNumber(typed.carbsG), fatG: wholeNumber(typed.fatG) };
  const four: OwnNutritionTargets | null =
    values.kcal === null || values.proteinG === null || values.carbsG === null || values.fatG === null
      ? null
      : { kcal: values.kcal, proteinG: values.proteinG, carbsG: values.carbsG, fatG: values.fatG };
  const hold = holdWords(targets.ownHeld);

  const save = async () => {
    if (busy) return;
    if (choice === "own" && four === null) return;
    const same =
      choice === targets.source &&
      (choice === "app" || (targets.own !== null && four !== null && FIELDS.every((f) => four[f.key] === targets.own?.[f.key])));
    if (same) {
      onClose();
      return;
    }
    setBusy(true);
    setTrouble(null);
    const body = choice === "app" || four === null ? { source: "app" } : { source: "own", ...four };
    const answer = await session.signedIn({ method: "PUT", path: "/v1/nutrition/targets", body }, nutritionTargetsResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") onSaved(answer.data);
    else if (answer.kind === "refused" && answer.error.startsWith("own_targets_")) setTrouble(answer.message);
    else if (answer.kind === "refused" && answer.status === 400) setTrouble("Enter whole numbers, as you would on a food label.");
    else setTrouble(NO_CONNECTION);
  };

  return (
    <Sheet open={open} title="Daily numbers" onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.72 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
      <Options
        solid
        options={[
          { value: "app", label: "App’s plan", desc: targets.appTargets === null ? "Not worked out yet" : fourWords(targets.appTargets) },
          { value: "own", label: "My own", desc: targets.own === null ? "Set your own numbers" : fourWords(targets.own) },
        ]}
        selected={choice}
        onPick={(v: Source) => {
          setChoice(v);
          setTrouble(null);
        }}
        disabled={busy}
      />
      {choice === "own" ? (
        <>
          <View style={styles.fields}>
            {FIELDS.map((f) => (
              <View key={f.key} style={styles.half}>
                <Field
                  label={f.label}
                  value={typed[f.key]}
                  onChange={(text) => {
                    setTyped((before) => ({ ...before, [f.key]: text }));
                  }}
                  keyboard="number-pad"
                  maxLength={6}
                />
              </View>
            ))}
          </View>
          <Txt kind="small">
            {four === null
              ? "Fill in all four numbers."
              : `Your protein, carbs and fat come to ${count(macroKcal(four))} kcal. They don’t have to match your calories.`}
          </Txt>
        </>
      ) : null}
      {trouble === null && hold === null ? null : (
        <Txt kind="small" colour="gold">
          {trouble ?? hold}
        </Txt>
      )}
      <Button
        label={choice === "own" ? "Use my numbers" : "Use the app’s plan"}
        wide
        disabled={(choice === "own" && four === null) || (choice === "app" && targets.appTargets === null)}
        busy={busy}
        onPress={() => {
          void save();
        }}
      />
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingBottom: 4 },
  fields: { flexDirection: "row", flexWrap: "wrap", columnGap: 10 },
  half: { flexGrow: 1, flexBasis: 140 },
});
