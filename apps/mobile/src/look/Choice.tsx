import { Fragment, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colours, orangeGradient, sizes } from "./colours";
import { Icon } from "./Icon";
import { fonts, Txt } from "./Txt";

// What a person picks by tapping. One of a few with a line each: rows in ONE rounded group, a
// round mark on the picked one, as a phone's own settings lists draw it. Any number of short
// ones: chips. A short scale (kg or lb, 1 to 7 days): segments in one track. Picked reads orange.

export interface Option<V> {
  value: V;
  label: string;
  desc?: string;
  /** A short gold line: why this one suits the person. */
  note?: string | null;
}

/** One of a few, in one group. */
export function Options<V extends string | number>({
  options,
  selected,
  onPick,
}: {
  options: readonly Option<V>[];
  selected: V | null | undefined;
  onPick: (value: V) => void;
}) {
  return (
    <View style={styles.group}>
      {options.map((o, i) => {
        const on = o.value === selected;
        return (
          <Fragment key={String(o.value)}>
            {i === 0 ? null : <View style={styles.rule} />}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: on }}
              onPress={() => {
                onPick(o.value);
              }}
              style={({ pressed }) => [styles.row, pressed ? styles.pressedRow : null]}
            >
              <View style={styles.grow}>
                <Txt style={[styles.rowLabel, on ? styles.rowLabelOn : null]}>{o.label}</Txt>
                {o.desc === undefined ? null : <Txt style={styles.desc}>{o.desc}</Txt>}
                {o.note === undefined || o.note === null ? null : <Txt style={styles.note}>{o.note}</Txt>}
              </View>
              <View style={[styles.mark, on ? styles.markOn : null]}>
                {on ? <Icon name="check" size={12} colour="onOrange" /> : null}
              </View>
            </Pressable>
          </Fragment>
        );
      })}
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
      style={({ pressed }) => [styles.chip, selected ? styles.chipOn : null, pressed ? styles.pressed : null]}
    >
      {selected ? <Icon name="check" size={13} colour="orangeLight" /> : null}
      <Txt style={[styles.chipLabel, selected ? styles.chipLabelOn : null]}>{label}</Txt>
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
}

/** One of a few, side by side in one track. */
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
    <View style={styles.track}>
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
            style={({ pressed }) => [styles.segment, on ? styles.segmentOn : null, pressed ? styles.pressed : null]}
          >
            <Txt numberOfLines={1} style={[styles.segmentLabel, on ? styles.segmentLabelOn : null]}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: 16,
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.line,
    overflow: "hidden",
  },
  rule: { height: 1, marginLeft: 14, backgroundColor: colours.line },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.button, paddingHorizontal: 14, paddingVertical: 10 },
  pressedRow: { backgroundColor: colours.raised },
  grow: { flex: 1, gap: 1 },
  rowLabel: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, color: colours.text },
  rowLabelOn: { fontFamily: fonts.semibold, color: colours.orangeLight },
  desc: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colours.textFaint },
  note: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colours.gold },
  mark: {
    width: 20,
    height: 20,
    borderRadius: sizes.round,
    borderWidth: 1.5,
    borderColor: colours.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  markOn: { borderColor: colours.orange, backgroundColor: colours.orange },
  pressed: { opacity: 0.8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    height: sizes.press,
    paddingHorizontal: 14,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.box,
  },
  chipOn: { borderColor: colours.orange, backgroundColor: colours.raised },
  chipLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colours.textSoft },
  chipLabelOn: { color: colours.orangeLight },
  track: {
    flexDirection: "row",
    padding: 3,
    gap: 3,
    borderRadius: sizes.round,
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.lineStrong,
  },
  segment: {
    flex: 1,
    height: sizes.press - 6,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderRadius: sizes.round,
  },
  segmentOn: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  segmentLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colours.textSoft },
  segmentLabelOn: { fontFamily: fonts.semibold, color: colours.onOrange },
});
