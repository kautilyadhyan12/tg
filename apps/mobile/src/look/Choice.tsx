import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colours, sizes } from "./colours";
import { Icon } from "./Icon";
import { fonts, Txt } from "./Txt";

// What a person picks by tapping, as the browser's setup draws it: a card for one of a few
// answers with a line under each, a chip for any number of short ones, and a row of segments
// for a short scale (1 to 7 days, kilograms or pounds). Picked reads orange, with a tick.

interface ChoiceProps {
  label: string;
  desc?: string;
  /** A short gold line under the description: why this one suits the person. */
  note?: string | null;
  selected: boolean;
  onPress: () => void;
}

/** One answer, the width of the page. */
export function Choice({ label, desc, note, selected, onPress }: ChoiceProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, selected ? styles.on : null, pressed ? styles.pressed : null]}
    >
      <View style={styles.grow}>
        <Txt kind="strong" colour={selected ? "text" : "textSoft"}>
          {label}
        </Txt>
        {desc === undefined ? null : <Txt kind="small">{desc}</Txt>}
        {note === undefined || note === null ? null : (
          <Txt colour="orangeLight" style={styles.note}>
            {note}
          </Txt>
        )}
      </View>
      {selected ? <Picked /> : null}
    </Pressable>
  );
}

function Picked() {
  return (
    <View style={styles.tick}>
      <Icon name="check" size={13} colour="onOrange" />
    </View>
  );
}

/** One of any number: a short word in a round box. */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected ? styles.on : null, pressed ? styles.pressed : null]}
    >
      {selected ? <Icon name="check" size={14} colour="orange" /> : null}
      <Txt colour={selected ? "text" : "textSoft"} style={styles.chipLabel}>
        {label}
      </Txt>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

interface Segment<V> {
  value: V;
  label: string;
  /** What a screen reader says, where the label is only a number. */
  say?: string;
  /** A second, smaller line. */
  desc?: string;
}

/** One of a few, side by side in one row. */
export function Segments<V extends string | number>({
  options,
  selected,
  onPick,
}: {
  options: readonly Segment<V>[];
  selected: V | null | undefined;
  onPick: (value: V) => void;
}) {
  return (
    <View style={styles.segments}>
      {options.map((o) => {
        const on = o.value === selected;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityLabel={o.say ?? o.label}
            accessibilityState={{ selected: on }}
            onPress={() => {
              onPick(o.value);
            }}
            style={({ pressed }) => [styles.segment, on ? styles.on : null, pressed ? styles.pressed : null]}
          >
            <Txt colour={on ? "text" : "textSoft"} style={styles.segmentLabel}>
              {o.label}
            </Txt>
            {o.desc === undefined ? null : (
              <Txt kind="tiny" style={styles.centre}>
                {o.desc}
              </Txt>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: sizes.button + 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colours.lineStrong,
    backgroundColor: colours.box,
  },
  on: { borderColor: colours.orange, backgroundColor: colours.orangeFill },
  pressed: { opacity: 0.85 },
  grow: { flex: 1, gap: 2 },
  note: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, marginTop: 2 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: sizes.round,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.orange,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignSelf: "flex-start",
    alignItems: "center",
    gap: 6,
    height: sizes.press,
    paddingHorizontal: 14,
    borderRadius: sizes.round,
    borderWidth: 1.5,
    borderColor: colours.lineStrong,
    backgroundColor: colours.box,
  },
  chipLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  segments: { flexDirection: "row", gap: 6 },
  segment: {
    flex: 1,
    minHeight: sizes.press,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colours.lineStrong,
    backgroundColor: colours.box,
  },
  segmentLabel: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, textAlign: "center" },
  centre: { textAlign: "center" },
});
