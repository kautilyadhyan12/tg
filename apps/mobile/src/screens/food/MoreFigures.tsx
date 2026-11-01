import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { dailyAmountsResponseSchema, type DailyAmountsResponse, type MealItem } from "@app/shared";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { useRead } from "../dashboard/useRead";
import { FIGURES_LINK, figureLines, figuresFromALabel } from "./figures";

// The ten further figures on the Food screen (ROADMAP Stage 5 34b): for the day, a saved meal and a
// food of a meal photo. The daily amounts beside them are a reference, never a goal.

export const DAILY_AMOUNTS_READ = "/v1/nutrition/daily-amounts";

/** The person's daily amounts; null until they have loaded, and the figures show without them. */
export function useDailyAmounts(): DailyAmountsResponse | null {
  const { read } = useRead(DAILY_AMOUNTS_READ, dailyAmountsResponseSchema);
  return read.kind === "ok" ? read.data : null;
}

export function FiguresLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}>
      <Txt kind="small" colour="text" style={styles.grow}>
        {FIGURES_LINK}
      </Txt>
      <Icon name="go" size={16} colour="textSoft" />
    </Pressable>
  );
}

interface ListProps {
  items: readonly Pick<MealItem, "canonical" | "nutritionSource" | "more">[];
  daily: DailyAmountsResponse | null;
  /** Meals of the day whose foods are not here yet; said in `partialWords`. */
  partial?: boolean;
  partialWords?: string | null;
}

export function FiguresList({ items, daily, partial = false, partialWords = null }: ListProps) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
      {partialWords === null ? null : (
        <Txt kind="small" colour="gold">
          {partialWords}
        </Txt>
      )}
      {figureLines(items, partial, daily?.amounts ?? null).map((line) => (
        <View key={line.key} style={styles.line} accessible accessibilityLabel={`${line.name}, ${line.value}${line.note === null ? "" : `. ${line.note}`}`}>
          <View style={styles.top}>
            <Txt kind="small" colour="text" style={styles.grow}>
              {line.name}
            </Txt>
            <Txt kind="strong" style={styles.value}>
              {line.value}
            </Txt>
          </View>
          {line.note === null ? null : <Txt kind="tiny">{line.note}</Txt>}
        </View>
      ))}
      {figuresFromALabel(items) ? <Txt kind="tiny">Figures for packaged foods are from their labels.</Txt> : null}
      {daily === null ? null : (
        <View style={styles.foot}>
          <Txt kind="tiny">
            {daily.forWhom === null ? "Daily amounts are the US Daily Values shown on food labels." : `Daily amounts are for ${daily.forWhom}.`}
          </Txt>
          <Txt kind="tiny">Daily amounts are for reference. They are not goals set by the app.</Txt>
          <Txt kind="tiny">Pregnancy or a health condition can change them.</Txt>
          <Txt kind="tiny">Sources: Dietary Reference Intakes (US and Canada) and US FDA Daily Values.</Txt>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  pressed: { opacity: 0.6 },
  grow: { flex: 1 },
  scroll: { flexShrink: 1 },
  list: { gap: 12, paddingBottom: 4 },
  line: { gap: 2 },
  top: { flexDirection: "row", gap: 8, alignItems: "baseline", flexWrap: "wrap" },
  value: { flexShrink: 1 },
  foot: { gap: 4, paddingTop: 4 },
});
