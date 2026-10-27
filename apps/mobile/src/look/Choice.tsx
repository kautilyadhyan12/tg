import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colours, orangeGradient, sizes } from "./colours";
import { Icon } from "./Icon";
import { fonts, Txt } from "./Txt";

// What a person picks by tapping, drawn over a page's own picture, which shows through every box
// (Kd, 2026-10-27). One of a few with a line each: a card each, spaced apart, a round mark on the
// picked one. Several short ones: a grid of equal boxes, a few to a row, never a scatter. A short
// scale (kg or lb, lose · keep · gain): segments in one track. Picked reads orange.

export interface Option<V> {
  value: V;
  label: string;
  desc?: string;
  /** A short gold line: why this one suits the person. */
  note?: string | null;
}

/** One of a few: a card each. */
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
    <View style={styles.cards}>
      {options.map((o) => {
        const on = o.value === selected;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityLabel={[o.label, o.desc, o.note].filter((words) => typeof words === "string" && words !== "").join(". ")}
            accessibilityState={{ selected: on }}
            onPress={() => {
              onPick(o.value);
            }}
            style={({ pressed }) => [styles.card, on ? styles.on : null, pressed ? styles.pressed : null]}
          >
            <View style={styles.grow}>
              <Txt style={[styles.cardLabel, on ? styles.labelOn : null]}>{o.label}</Txt>
              {o.desc === undefined ? null : <Txt style={styles.desc}>{o.desc}</Txt>}
              {o.note === undefined || o.note === null ? null : <Txt style={styles.note}>{o.note}</Txt>}
            </View>
            <View style={[styles.mark, on ? styles.markOn : null]}>
              {on ? <Icon name="check" size={12} colour="onOrange" /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface Cell {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  /** What a screen reader says, where the label alone does not. */
  say?: string;
}

/** Short choices in rows of equal boxes, `columns` to a row; a last row short of boxes keeps their width. */
export function Grid({ cells, columns }: { cells: readonly Cell[]; columns: number }) {
  const rows: Cell[][] = [];
  cells.forEach((cell, i) => {
    if (i % columns === 0) rows.push([]);
    rows[rows.length - 1]?.push(cell);
  });
  return (
    <View style={styles.cards}>
      {rows.map((row, r) => (
        <View key={`row-${String(r)}`} style={styles.gridRow}>
          {row.map((cell) => (
            <Pressable
              key={cell.key}
              accessibilityRole="button"
              accessibilityLabel={cell.say ?? cell.label}
              accessibilityState={{ selected: cell.selected }}
              onPress={cell.onPress}
              style={({ pressed }) => [styles.cell, cell.selected ? styles.on : null, pressed ? styles.pressed : null]}
            >
              {cell.selected ? <Icon name="check" size={14} colour="orangeLight" /> : null}
              <Txt numberOfLines={1} style={[styles.cellLabel, cell.selected ? styles.labelOn : null]}>
                {cell.label}
              </Txt>
            </Pressable>
          ))}
          {Array.from({ length: columns - row.length }, (_, i) => (
            <View key={`gap-${String(i)}`} accessible={false} style={[styles.cell, styles.unseen]} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** One of any number, alone on its line: "Not sure". */
export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected ? styles.on : null, pressed ? styles.pressed : null]}
    >
      {selected ? <Icon name="check" size={13} colour="orangeLight" /> : null}
      <Txt style={[styles.cellLabel, selected ? styles.labelOn : null]}>{label}</Txt>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={styles.chips}>{children}</View>;
}

interface Segment<V> {
  value: V;
  label: string;
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

const box = {
  borderRadius: 14,
  borderWidth: 1,
  borderColor: colours.lineStrong,
  backgroundColor: colours.overPicture,
} as const;

const styles = StyleSheet.create({
  cards: { gap: 10 },
  card: { ...box, flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.button + 8, paddingHorizontal: 14, paddingVertical: 12 },
  on: { borderColor: colours.orange, backgroundColor: colours.orangeFill },
  pressed: { opacity: 0.8 },
  grow: { flex: 1, gap: 2 },
  cardLabel: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colours.text },
  labelOn: { color: colours.orangeLight },
  desc: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 17, color: colours.textSoft },
  note: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colours.gold },
  mark: {
    width: 22,
    height: 22,
    borderRadius: sizes.round,
    borderWidth: 1.5,
    borderColor: colours.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  markOn: { borderColor: colours.orange, backgroundColor: colours.orange },
  gridRow: { flexDirection: "row", gap: 10 },
  cell: { ...box, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: sizes.button, paddingHorizontal: 8 },
  // The empty place at the end of a short row is a box like the others, unseen, so every box is one width.
  unseen: { opacity: 0 },
  cellLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colours.text },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { ...box, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 6, height: sizes.press, paddingHorizontal: 16, borderRadius: sizes.round },
  track: {
    flexDirection: "row",
    padding: 3,
    gap: 3,
    borderRadius: sizes.round,
    backgroundColor: colours.overPicture,
    borderWidth: 1,
    borderColor: colours.lineStrong,
  },
  segment: { flex: 1, height: sizes.press - 6, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, borderRadius: sizes.round },
  segmentOn: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  segmentLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colours.textSoft },
  segmentLabelOn: { fontFamily: fonts.semibold, color: colours.onOrange },
});
