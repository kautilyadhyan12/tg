import { createContext, useContext, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colours } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";

// Recommended For You's kinds across the box's top (spec Part 6 §16.6): Food, and Running with the run
// plan (37d-iii-a). Workout joins with item 36's weekly plan. The box of whichever kind is open draws
// the tabs, so they stay where they are when the kind changes.

export type RecommendedKind = "food" | "running";

const KINDS: readonly { value: RecommendedKind; label: string }[] = [
  { value: "food", label: "Food" },
  { value: "running", label: "Running" },
];

/** `onPick` null: a box shown alone, with its one kind. */
export function KindTabs({ kind, onPick }: { kind: RecommendedKind; onPick: ((kind: RecommendedKind) => void) | null }) {
  const shown = onPick === null ? KINDS.filter((k) => k.value === kind) : KINDS;
  return (
    <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel="What to recommend">
      {shown.map((k) => {
        const on = k.value === kind;
        return (
          <Pressable
            key={k.value}
            accessibilityRole="radio"
            accessibilityLabel={k.label}
            accessibilityState={{ selected: on }}
            hitSlop={SLOP}
            onPress={() => {
              onPick?.(k.value);
            }}
            style={[styles.option, on ? styles.on : null]}
          >
            <Txt kind="tiny" colour={on ? "orange" : "textSoft"} style={styles.word}>
              {k.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The tabs the Dashboard hands to whichever box is open. */
export const KindTabsContext = createContext<ReactNode>(null);

/** The tabs from the Dashboard, or the box's one kind when it is shown alone. */
export function useKindTabs(kind: RecommendedKind): ReactNode {
  const given = useContext(KindTabsContext);
  return given ?? <KindTabs kind={kind} onPick={null} />;
}

const SLOP = { top: 12, bottom: 12, left: 8, right: 8 };

const styles = StyleSheet.create({
  options: { flexDirection: "row", gap: 18 },
  option: { alignSelf: "flex-start", paddingBottom: 3, borderBottomWidth: 2, borderBottomColor: "transparent" },
  on: { borderBottomColor: colours.orange },
  word: { fontFamily: fonts.semibold },
});
