import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { dailyAmountsResponseSchema, type DailyAmountsResponse, type MealItem } from "@app/shared";
import { Icon } from "../../look/Icon";
import { colours } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { useRead } from "../dashboard/useRead";
import { NutrientJar } from "./NutrientJar";
import { FIGURES_LINK, figureLines, shareSaid, figuresFromALabel, missingFoodsWords } from "./figures";

// The ten further figures on the Food screen (ROADMAP Stage 5 34b): for the day, a saved meal and a
// food of a meal photo. The daily amounts beside them are a reference, never a goal.

export const DAILY_AMOUNTS_READ = "/v1/nutrition/daily-amounts";

/** The person's daily amounts; null until they have loaded, and the figures show without them. */
export function useDailyAmounts(): { daily: DailyAmountsResponse | null; again: () => void } {
  const { read, again } = useRead(DAILY_AMOUNTS_READ, dailyAmountsResponseSchema);
  return { daily: read.kind === "ok" ? read.data : null, again };
}

export function FiguresLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.link, pressed ? styles.pressed : null]}>
      <Icon name="chart" size={16} colour="orange" />
      <Txt kind="small" colour="orange" style={[styles.grow, styles.linkWords]}>
        {FIGURES_LINK}
      </Txt>
      <Icon name="go" size={16} colour="textSoft" />
    </Pressable>
  );
}

interface ListProps {
  items: readonly Pick<MealItem, "name" | "seenAs" | "canonical" | "nutritionSource" | "more">[];
  daily: DailyAmountsResponse | null;
  /** Meals of the day whose foods are not here yet; said in `partialWords`. */
  partial?: boolean;
  partialWords?: string | null;
}

/** Two nutrients to a shelf. */
const shelves = <T,>(lines: readonly T[]): T[][] => Array.from({ length: Math.ceil(lines.length / 2) }, (_, i) => lines.slice(i * 2, i * 2 + 2));

export function FiguresList({ items, daily, partial = false, partialWords = null }: ListProps) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
      {partialWords === null ? null : (
        <Txt kind="small" colour="gold">
          {partialWords}
        </Txt>
      )}
      {missingFoodsWords(items) === null ? null : <Txt kind="small">{missingFoodsWords(items)}</Txt>}
      {/* The pantry (32c-ii-a, Kd's drawing 4b): two to a shelf, each nutrient filled to its share. */}
      {shelves(figureLines(items, partial, daily?.amounts ?? null)).map((shelf) => (
        <View key={shelf.map((l) => l.key).join("-")} style={styles.shelf}>
          {shelf.map((line) => (
            <View key={line.key} style={styles.jar} accessible accessibilityLabel={`${line.name}, ${line.value}${line.note === null ? "" : `. ${line.note}`}${shareSaid(line)}`}>
              <NutrientJar nutrient={line.key} share={line.share} limit={line.limit} incomplete={line.incomplete} />
              <Txt kind="small" colour="text" style={styles.centre}>
                {line.name}
              </Txt>
              <Txt kind="strong" colour={line.value === "No data" ? "textSoft" : "text"} style={styles.centre}>
                {line.value}
              </Txt>
              {line.note === null ? null : (
                <Txt kind="tiny" style={styles.centre}>
                  {line.note}
                </Txt>
              )}
            </View>
          ))}
        </View>
      ))}
      {figuresFromALabel(items) ? <Txt kind="tiny">Packaged food values are from the label.</Txt> : null}
      {daily === null ? null : (
        <View style={styles.foot}>
          <Txt kind="tiny">
            {daily.forWhom === null ? "Daily amounts are the US Daily Values used on food labels." : `Daily amounts for ${daily.forWhom}.`}
          </Txt>
          {daily.forWhom === null ? null : <Txt kind="tiny">The saturated fat limit is the US Daily Value.</Txt>}
          <Txt kind="tiny">These are general guidelines, not goals set by the app.</Txt>
          <Txt kind="tiny">Pregnancy or a health condition can change them.</Txt>
          <Txt kind="tiny">Sources: Health Canada and the US FDA.</Txt>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  link: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  pressed: { opacity: 0.6 },
  linkWords: { fontFamily: fonts.semibold },
  grow: { flex: 1 },
  scroll: { flexShrink: 1 },
  list: { gap: 12, paddingBottom: 4 },
  shelf: { flexDirection: "row", gap: 10, paddingBottom: 12, borderBottomWidth: 3, borderBottomColor: colours.track },
  jar: { flex: 1, alignItems: "center", gap: 2, paddingTop: 8 },
  centre: { textAlign: "center" },
  foot: { gap: 4, paddingTop: 4 },
});
