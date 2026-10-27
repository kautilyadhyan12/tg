import { Children, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { colours, sizes } from "./colours";
import { Icon } from "./Icon";
import { Txt } from "./Txt";

/** Rows in one box, a thin line between them, as a phone's own settings list draws them. */
export function RowGroup({ label, children }: { label?: string; children: ReactNode }) {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.group}>
      {label === undefined ? null : (
        <Txt kind="tiny" style={styles.label}>
          {label}
        </Txt>
      )}
      <View style={styles.box}>
        {rows.map((row, at) => (
          <View key={row.key ?? at} style={at === 0 ? null : styles.line}>
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

interface RowProps {
  title: string;
  /** One line under the title: what it is and where. */
  detail?: string;
  /** Before the title: a picture or an initial. */
  lead?: ReactNode;
  /** After the title: a word about its state. */
  end?: ReactNode;
  /** A row that opens something says so with an arrow. */
  onPress?: () => void;
}

export function Row({ title, detail, lead, end, onPress }: RowProps) {
  const inner = (
    <>
      {lead}
      <View style={styles.words}>
        <Txt kind="strong" numberOfLines={1}>
          {title}
        </Txt>
        {detail === undefined ? null : (
          <Txt kind="small" numberOfLines={1}>
            {detail}
          </Txt>
        )}
      </View>
      {end}
      {onPress === undefined ? null : <Icon name="go" size={16} colour="textFaint" />}
    </>
  );
  return onPress === undefined ? (
    <View style={styles.row}>{inner}</View>
  ) : (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail === undefined ? title : `${title}, ${detail}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
    >
      {inner}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { textTransform: "uppercase", letterSpacing: 0.9, paddingHorizontal: 4 },
  box: {
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: sizes.boxRadius,
    overflow: "hidden",
  },
  line: { borderTopWidth: 1, borderTopColor: colours.line },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 68, paddingHorizontal: 14, paddingVertical: 10 },
  pressed: { backgroundColor: colours.fill },
  words: { flex: 1, gap: 2 },
});
