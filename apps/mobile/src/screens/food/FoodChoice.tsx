import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { dietPlanResponseSchema, type DietPlanResponse, type FoodChoice } from "@app/shared";
import { Chip } from "../../look/Chip";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";

// Recommended For You's choice for food (ROADMAP Stage 5 31f; spec Part 6 §16.6): the app's own ideas
// or the person's own meal plan, kept on the server, so the Dashboard, Food and a second phone show
// the same one. The gym's plan joins with 31g.

export const CHOICE_PATH = "/v1/nutrition/diet-plan/choice";
const NO_CONNECTION = "No connection. Try again.";

const WORDS: Readonly<Record<FoodChoice, string>> = { suggested: "Suggested", mine: "My plan" };
const ORDER: readonly FoodChoice[] = ["suggested", "mine"];

interface PlanRead {
  begun: () => number;
  shownFrom: number;
  again: () => void;
}

/** The choice shown: the one being sent, then the server's answer to it until a read begun after it
 *  lands, then the plan read's own. A pick that gets no answer goes back, and says so. */
export function useFoodChoice(fromRead: FoodChoice | null, read: PlanRead, onAnswer?: (data: DietPlanResponse) => void) {
  const { session } = useSession();
  const [sending, setSending] = useState<FoodChoice | null>(null);
  const [held, setHeld] = useState<{ choice: FoodChoice; after: number } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const sendingNow = useRef(false);
  const { begun, shownFrom, again } = read;
  useEffect(() => {
    if (held !== null && shownFrom > held.after) setHeld(null);
  }, [held, shownFrom]);
  const shown = sending ?? held?.choice ?? fromRead;

  const pick = useCallback(
    async (choice: FoodChoice) => {
      if (sendingNow.current || choice === shown) return;
      sendingNow.current = true;
      setSending(choice);
      setTrouble(null);
      const answer = await session.signedIn({ method: "PUT", path: CHOICE_PATH, body: { choice } }, dietPlanResponseSchema);
      sendingNow.current = false;
      setSending(null);
      if (answer.kind === "ok") {
        setHeld({ choice: answer.data.choice, after: begun() });
        onAnswer?.(answer.data);
        again();
        return;
      }
      setTrouble(answer.kind === "no_answer" || answer.message === "" ? NO_CONNECTION : answer.message);
    },
    [session, shown, begun, again, onAnswer],
  );
  return { shown, pick, trouble, quiet: () => { setTrouble(null); } };
}

/** The row of choices, under the box's title: the picked one glows. */
export function FoodChoiceRow({ shown, pick, trouble }: { shown: FoodChoice; pick: (c: FoodChoice) => Promise<void>; trouble: string | null }) {
  return (
    <View style={styles.box}>
      <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Whose meals">
        {ORDER.map((c) => (
          <Chip key={c} label={WORDS[c]} on={shown === c} small onPress={() => { void pick(c); }} />
        ))}
      </View>
      {trouble === null ? null : (
        <Txt kind="small" colour="badText">
          {trouble}
        </Txt>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 6 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
