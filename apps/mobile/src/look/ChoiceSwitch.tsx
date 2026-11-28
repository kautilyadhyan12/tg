import { Pressable, StyleSheet, View } from "react-native";
import { colours, orangeGradient, shadows, sizes } from "./colours";
import { fonts, Txt } from "./Txt";

/** Whose plan a box shows, as one switch under its title (Recommended For You's Suggested, a gym's plan,
 *  My plan; spec Part 6 §16.6). The picked one is orange and glows (Kd's drawing, 2026-11-08). */
export function ChoiceSwitch({ said, choices, trouble }: {
  /** What the switch picks, for a screen reader: "Whose meals". */
  said: string;
  choices: readonly { key: string; label: string; on: boolean; onPress: () => void }[];
  trouble: string | null;
}) {
  return (
    <View style={styles.box}>
      <View style={styles.track} accessibilityRole="radiogroup" accessibilityLabel={said}>
        {choices.map((c) => (
          <Pressable
            key={c.key}
            accessibilityRole="radio"
            accessibilityLabel={c.label}
            accessibilityState={{ selected: c.on }}
            hitSlop={SLOP}
            onPress={c.onPress}
            style={({ pressed }) => [styles.part, c.on ? styles.on : null, pressed ? styles.pressed : null]}
          >
            <Txt colour={c.on ? "onOrange" : "textSoft"} style={styles.label}>
              {c.label}
            </Txt>
          </Pressable>
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
