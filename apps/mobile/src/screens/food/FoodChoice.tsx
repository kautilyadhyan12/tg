import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { dietPlanResponseSchema, type DietPlanResponse, type FoodChoice } from "@app/shared";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";

// Recommended For You's choice for food (ROADMAP Stage 5 31f, 31g; spec Part 6 §16.6): the app's own
// ideas, the plan a gym gave the person, or their own meal plan, kept on the server, so the Dashboard,
// Food and a second phone show the same one.

export const CHOICE_PATH = "/v1/nutrition/diet-plan/choice";
const NO_CONNECTION = "No connection. Try again.";

/** A choice as shown: the gym's plan names the gym. */
export interface Shown { choice: FoodChoice; gymId: string | null }
export const shownOf = (plan: Pick<DietPlanResponse, "choice" | "choiceGymId">): Shown => ({ choice: plan.choice, gymId: plan.choice === "gym" ? plan.choiceGymId : null });
const same = (a: Shown | null, b: Shown | null): boolean => a !== null && b !== null && a.choice === b.choice && a.gymId === b.gymId;

interface PlanRead {
  begun: () => number;
  shownFrom: number;
  again: () => void;
}

/** The choice shown: the one being sent, then the server's answer to it until a read begun after it
 *  lands, then the plan read's own. A pick that gets no answer goes back, and says so. */
export function useFoodChoice(fromRead: Shown | null, read: PlanRead, onAnswer?: (data: DietPlanResponse) => void) {
  const { session } = useSession();
  const [sending, setSending] = useState<Shown | null>(null);
  const [held, setHeld] = useState<{ shown: Shown; after: number } | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const sendingNow = useRef(false);
  const { begun, shownFrom, again } = read;
  useEffect(() => {
    if (held !== null && shownFrom > held.after) setHeld(null);
  }, [held, shownFrom]);
  const shown = sending ?? held?.shown ?? fromRead;

  const pick = useCallback(
    async (next: Shown) => {
      if (sendingNow.current || same(next, shown)) return;
      sendingNow.current = true;
      setSending(next);
      setTrouble(null);
      const body = next.choice === "gym" ? { choice: "gym", gymId: next.gymId } : { choice: next.choice };
      const answer = await session.signedIn({ method: "PUT", path: CHOICE_PATH, body }, dietPlanResponseSchema);
      sendingNow.current = false;
      setSending(null);
      if (answer.kind === "ok") {
        setHeld({ shown: shownOf(answer.data), after: begun() });
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

/** The choices as one switch, under the box's title: Suggested, each gym the person is a member of,
 *  My plan. The picked one is orange and glows (Kd's drawing, 2026-11-08). */
export function FoodChoiceRow({ shown, pick, trouble, gyms }: {
  shown: Shown;
  pick: (c: Shown) => Promise<void>;
  trouble: string | null;
  gyms: readonly { gymId: string; name: string }[];
}) {
  const choices: { key: string; label: string; to: Shown }[] = [
    { key: "suggested", label: "Suggested", to: { choice: "suggested", gymId: null } },
    ...gyms.map((g) => ({ key: g.gymId, label: g.name, to: { choice: "gym" as const, gymId: g.gymId } })),
    { key: "mine", label: "My plan", to: { choice: "mine", gymId: null } },
  ];
  return (
    <View style={styles.box}>
      <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel="Whose meals">
        {choices.map((c) => {
          const on = same(shown, c.to);
          return (
            <Pressable
              key={c.key}
              accessibilityRole="radio"
              accessibilityLabel={c.label}
              accessibilityState={{ selected: on }}
              hitSlop={SLOP}
              onPress={() => { void pick(c.to); }}
              style={({ pressed }) => [styles.part, on ? styles.on : null, pressed ? styles.pressed : null]}
            >
              <Txt colour={on ? "onOrange" : "textSoft"} style={styles.label}>
                {c.label}
              </Txt>
            </Pressable>
          );
        })}
      </View>
      {trouble === null ? null : (
        <Txt kind="small" colour="badText">
          {trouble}
        </Txt>
      )}
    </View>
  );
}

const SLOP = { top: 6, bottom: 6, left: 0, right: 0 };

const styles = StyleSheet.create({
  box: { gap: 6 },
  track: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 3,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.fill,
  },
  part: { flexGrow: 1, flexBasis: "auto", minHeight: 34, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderRadius: sizes.round },
  on: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.chip },
  pressed: { opacity: 0.85 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
});
