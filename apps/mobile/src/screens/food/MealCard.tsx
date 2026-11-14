import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { DietPlanMeal, MealType } from "@app/shared";
import { Card } from "../../look/Card";
import { colours, shadows } from "../../look/colours";
import { Icon, type IconName } from "../../look/Icon";
import { pictures, type PictureName } from "../../look/pictures";
import { fonts, Txt } from "../../look/Txt";
import { count } from "../dashboard/words";
import { mealTypeName } from "./day";
import { loggedAmount } from "./measures";
import { foodTitle } from "./rows";

// The pieces of the food boxes (Recommended For You, What to eat next), in one order for every choice
// (Kd, 2026-11-08): whose it is, the meal, its numbers, a note, the one thing to do, the allergy line.

/** The picture's room on the Dashboard: the words beside it never run under it. */
export const ART_SIZE = 104;

/** What to eat's box (drawings 5b, 5c): Suggested, the gym and My plan above it, the box under them. The
 *  tab above already says "What to eat", so the box has no title of its own. */
export function FoodBox({ choices, testID, children }: { choices: ReactNode; testID?: string; children: ReactNode }) {
  return (
    <View style={styles.box}>
      {choices}
      <Card raised style={styles.boxCard} {...(testID === undefined ? {} : { testID })}>
        {children}
      </Card>
    </View>
  );
}

/** "Picked for you" across the top of the ideas, the food picture at its right (drawing 5b). */
export function PickedTop() {
  return (
    <View style={styles.picked}>
      <View style={styles.pickedArt}>
        <Image source={pictures.foodbowl} resizeMode="contain" style={styles.fill} accessible={false} />
      </View>
      <FromRow badge={{ icon: "sparkles" }} title="Picked for you" sub={null} />
    </View>
  );
}

/** Each meal's own picture (32c-i), on the meals of the day and of a meal plan. */
export const MEAL_PICTURES: Record<MealType, PictureName> = { breakfast: "mealbreakfast", lunch: "meallunch", dinner: "mealdinner", snack: "mealsnack" };

/** A meal's round picture. */
export function MealThumb({ type, size = 48 }: { type: MealType; size?: number }) {
  return (
    <View style={[styles.thumb, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image source={pictures[MEAL_PICTURES[type]]} resizeMode="cover" style={styles.fill} accessible={false} />
    </View>
  );
}

/** "Logged", in a small green pill: a planned meal already on today's list. */
export function LoggedPill() {
  return (
    <View style={styles.loggedPill}>
      <Icon name="check" size={13} colour="goodText" />
      <Txt kind="small" colour="goodText" style={styles.loggedWords}>
        Logged
      </Txt>
    </View>
  );
}

/** The day shown, in a round bar with a round arrow each side. */
export function DayBar({ label, onBack, onGo }: { label: string; onBack: () => void; onGo: () => void }) {
  return (
    <View style={styles.dayBar}>
      <DayArrow name="back" say="Previous day" onPress={onBack} />
      <Txt kind="strong" style={styles.dayName}>
        {label}
      </Txt>
      <DayArrow name="go" say="Next day" onPress={onGo} />
    </View>
  );
}

function DayArrow({ name, say, onPress }: { name: "back" | "go"; say: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say} onPress={onPress} style={styles.arrow}>
      <View style={styles.arrowRing}>
        <Icon name={name} size={16} colour="textSoft" />
      </View>
    </Pressable>
  );
}

/** Whose meal: a round badge, a name and one small line. */
export function FromRow({ badge, title, sub }: { badge: { initials: string } | { icon: IconName }; title: string; sub: string | null }) {
  return (
    <View style={styles.from}>
      <View style={styles.badge}>
        {"icon" in badge ? (
          <Icon name={badge.icon} size={14} colour="orange" />
        ) : (
          <Txt kind="tiny" colour="orange" style={styles.initials} numberOfLines={1}>
            {badge.initials}
          </Txt>
        )}
      </View>
      <View style={styles.grow}>
        <Txt kind="small" colour="text" style={styles.fromTitle}>
          {title}
        </Txt>
        {sub === null ? null : <Txt kind="tiny">{sub}</Txt>}
      </View>
    </View>
  );
}

/** A writer's initials for the badge: "Maya Okafor" → "MO". */
export const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter((w) => w !== "")
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

/** The small orange line over the meal: "NEXT MEAL · LUNCH", "TODAY’S IDEA". */
export function Eyebrow({ words }: { words: string }) {
  return (
    <Txt kind="tiny" colour="orange" style={styles.eyebrow}>
      {words.toUpperCase()}
    </Txt>
  );
}

export interface FoodLine { name: string; amount: string }

/** One food: its name large, its amount beside it. Several: one line each, amounts lined up on the right. */
export function FoodLines({ foods, list = false }: { foods: readonly FoodLine[]; list?: boolean }) {
  const [only] = foods;
  if (!list && foods.length === 1 && only !== undefined) {
    return (
      <Txt colour="text" style={styles.oneFood}>
        {only.name}{" "}
        <Txt kind="small" colour="textFaint">
          {only.amount.replace(/ /g, KEEP_TOGETHER)}
        </Txt>
      </Txt>
    );
  }
  return (
    <View style={styles.foods}>
      {foods.map((f, at) => (
        <View key={String(at)} style={styles.foodLine}>
          <Txt kind="small" colour="text" style={styles.foodName}>
            {f.name}
          </Txt>
          <Leader />
          <Txt kind="tiny">{f.amount}</Txt>
        </View>
      ))}
    </View>
  );
}

/** The dotted line from a food to its amount. Android draws no dotted border on one side, so it is dots. */
function Leader() {
  return (
    <View style={styles.leader} accessible={false} importantForAccessibility="no-hide-descendants">
      <Text numberOfLines={1} ellipsizeMode="clip" style={styles.dots}>
        {DOTS}
      </Text>
    </View>
  );
}

const DOTS = "·".repeat(80);

/** A plan meal's foods on one line, as drawn: "Oats 1/2 cup · Milk 1 cup". An amount never splits from its unit. */
export const foodsLine = (meal: DietPlanMeal): string =>
  meal.items.map((f) => `${foodTitle(f)} ${loggedAmount(f).replace(/ /g, KEEP_TOGETHER)}`).join(" · ");

export const planFoods = (meal: DietPlanMeal): FoodLine[] => meal.items.map((f) => ({ name: foodTitle(f), amount: loggedAmount(f) }));

/** The meal's numbers as a row of tiles: kcal, then each macro with a thin bar of its share. */
export function NumberTiles({ kcal, proteinG, carbsG, fatG = null }: { kcal: number; proteinG: number; carbsG: number; fatG?: number | null }) {
  const macros: { label: string; grams: number; colour: "blue" | "gold" | "purple" }[] = [
    { label: "Protein", grams: proteinG, colour: "blue" },
    { label: "Carbs", grams: carbsG, colour: "gold" },
    ...(fatG === null ? [] : [{ label: "Fat", grams: fatG, colour: "purple" as const }]),
  ];
  const total = macros.reduce((n, m) => n + m.grams, 0);
  return (
    <View style={styles.tiles}>
      <View style={styles.tile}>
        <Txt colour="orangeLight" style={styles.tileNumber}>
          {count(Math.round(kcal))}
        </Txt>
        <Txt kind="tiny">kcal</Txt>
      </View>
      {macros.map((m) => (
        <View key={m.label} style={[styles.tile, styles.tileLine]}>
          <Txt colour="text" style={styles.tileNumber}>
            {count(Math.round(m.grams))}
            <Txt kind="tiny" colour="textSoft">
              {" g"}
            </Txt>
          </Txt>
          <Txt kind="tiny">{m.label}</Txt>
          <View style={styles.bar}>
            <View style={[styles.barFill, { flex: total > 0 ? m.grams / total : 0, backgroundColor: colours[m.colour] }]} />
            <View style={{ flex: total > 0 ? 1 - m.grams / total : 1 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** A plan's meal: the line over it, its foods and its numbers. */
export function PlanMealCard({ meal, eyebrow }: { meal: DietPlanMeal; eyebrow: string }) {
  return (
    <View style={styles.meal}>
      <View style={styles.mealWords}>
        <Eyebrow words={eyebrow} />
        <FoodLines foods={planFoods(meal)} />
      </View>
      <NumberTiles kcal={meal.totals.kcalPoint} proteinG={meal.totals.proteinG} carbsG={meal.totals.carbsG} fatG={meal.totals.fatG} />
    </View>
  );
}

export const nextMealWords = (meal: DietPlanMeal): string => `Next meal · ${mealTypeName(meal.mealType)}`;

/** A line to heed, in a soft gold frame: only its sign is gold. */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <View style={styles.notice}>
      <Icon name="warn" size={14} colour="gold" />
      <Txt kind="small" style={styles.grow}>
        {children}
      </Txt>
    </View>
  );
}

/** Nothing to show: a dashed box with its sign and its words. */
export function EmptyBox({ title, line, icon = "utensils" }: { title: string; line: string | null; icon?: IconName }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptySign}>
        <Icon name={icon} size={16} colour="textSoft" />
      </View>
      <View style={styles.grow}>
        <Txt kind="small" colour="text" style={styles.fromTitle}>
          {title}
        </Txt>
        {line === null ? null : <Txt kind="tiny">{line}</Txt>}
      </View>
    </View>
  );
}

/** The allergy lines at the box's foot, under a thin line. */
export function AllergyFoot({ lines }: { lines: readonly (string | null)[] }) {
  return (
    <View style={styles.foot}>
      {lines.map((l, at) =>
        l === null ? null : (
          <View key={String(at)} style={styles.footLine}>
            {at === 0 ? <Icon name="shield" size={12} colour="textFaint" /> : <View style={styles.footGap} />}
            <Txt kind="tiny" style={styles.grow}>
              {l}
            </Txt>
          </View>
        ),
      )}
    </View>
  );
}

/** A space a line never breaks at: an amount is never split from its unit. */
const KEEP_TOGETHER = " ";

const styles = StyleSheet.create({
  grow: { flex: 1 },
  from: { flexDirection: "row", alignItems: "center", gap: 9 },
  badge: {
    minWidth: 30,
    minHeight: 30,
    paddingHorizontal: 3,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.orangeFill,
    borderWidth: 1,
    borderColor: colours.orangeLine,
  },
  initials: { fontFamily: fonts.bold },
  fromTitle: { fontFamily: fonts.semibold },
  eyebrow: { fontFamily: fonts.bold, letterSpacing: 1.1 },
  meal: { gap: 12 },
  mealWords: { gap: 4 },
  oneFood: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  foods: { gap: 4 },
  foodLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  foodName: { flexShrink: 1 },
  leader: { flex: 1, minWidth: 8, overflow: "hidden" },
  dots: { color: colours.textFaint, fontSize: 12, lineHeight: 16, letterSpacing: 2 },
  box: { gap: 12 },
  boxCard: { gap: 12 },
  picked: { minHeight: 84, justifyContent: "center", paddingRight: 128 },
  pickedArt: { position: "absolute", top: -18, right: -10, bottom: -10, width: 150 },
  fill: { width: "100%", height: "100%" },
  thumb: { overflow: "hidden", borderWidth: 2, borderColor: colours.lineStrong, boxShadow: shadows.chip },
  loggedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 30,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.goodLine,
    backgroundColor: colours.goodFill,
    marginRight: 6,
  },
  loggedWords: { fontFamily: fonts.semibold },
  dayBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    paddingHorizontal: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
  },
  dayName: { flexShrink: 1, textAlign: "center" },
  arrow: { minWidth: 44, minHeight: 48, alignItems: "center", justifyContent: "center" },
  arrowRing: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colours.raised, borderWidth: 1, borderColor: colours.lineStrong },
  tiles: { flexDirection: "row", backgroundColor: colours.raised, borderWidth: 1, borderColor: colours.line, borderRadius: 14 },
  tile: { flex: 1, alignItems: "center", paddingVertical: 9, paddingHorizontal: 2, gap: 1 },
  tileLine: { borderLeftWidth: 1, borderLeftColor: colours.line },
  tileNumber: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20 },
  bar: { flexDirection: "row", width: 32, height: 3, borderRadius: 2, marginTop: 4, backgroundColor: colours.track, overflow: "hidden" },
  barFill: { height: 3, borderRadius: 2 },
  notice: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.goldLine,
    backgroundColor: colours.goldFill,
  },
  empty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colours.lineStrong,
  },
  emptySign: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colours.fill },
  foot: { gap: 4, paddingTop: 10, marginTop: 2, borderTopWidth: 1, borderTopColor: colours.line },
  footLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  footGap: { width: 12 },
});

