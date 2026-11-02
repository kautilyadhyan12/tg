import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { dietPlanResponseSchema, type DietPlanDayReply, type DietPlanMeal, type DietPlanResponse } from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { colours } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { useRead } from "../dashboard/useRead";
import { NOT_KNOWN, count } from "../dashboard/words";
import { newGoalId } from "../goals/words";
import { mealTypeName, startOfDay } from "./day";
import { dayRows, useDayMeals } from "./dayRows";
import { ideaName } from "./ideaRules";
import { MealIdeas, type PlannedNow } from "./MealIdeas";
import { useMealOutbox } from "./MealOutbox";
import { loggedAmount } from "./measures";
import { foodsOfRow, hasMeals, loggedOfDay, planDayName, planDayOf, planMealAsMeal, stepDay } from "./planRules";
import { foodTitle } from "./rows";

export const PLAN_READ = "/v1/nutrition/diet-plan";
const NO_CONNECTION = "No connection. Try again.";
const NO_SETTLE = () => undefined;

/** What Undo puts back: the day as it stood before the last swap. */
interface Undo { id: string; day: number; meals: DietPlanMeal[] }

interface WhatToEatNextProps {
  /** The foods of each meal on today's list; null until the list is read, and nothing is logged till then. */
  foodsToday: readonly (readonly string[])[] | null;
  /** Moves when setup answers change elsewhere on the page. */
  fresh: number;
  onAnswered: () => void;
  /** Today's meals could not be read, and how to read them again. */
  todayFailed: boolean;
  retryToday: () => void;
  /** Moves when another page asks for the week to open (the Dashboard's See meal plan). */
  openWeekAt: number | null;
  onWeekOpened: () => void;
}

/** The Food page's one answer to "what do I eat now?": the plan's next meal for somebody with a plan,
 *  the meal ideas for somebody without. Every number and every refusal is the server's. */
export function WhatToEatNext({ foodsToday, fresh, onAnswered, todayFailed, retryToday, openWeekAt, onWeekOpened }: WhatToEatNextProps) {
  const { session } = useSession();
  const { height } = useWindowDimensions();
  const { read, again, begun, shownFrom } = useRead(PLAN_READ, dietPlanResponseSchema, fresh);
  const { outbox } = useMealOutbox();
  // The plan as the server answered a change, until a read begun after that answer comes back.
  const [answered, setAnswered] = useState<{ data: DietPlanResponse; after: number } | null>(null);
  useEffect(() => {
    if (answered !== null && shownFrom > answered.after) setAnswered(null);
  }, [shownFrom, answered]);
  const today = planDayOf(new Date());
  const [week, setWeek] = useState(false);
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [shownDay, setShownDay] = useState(today);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const loggingNow = useRef(false);
  const sendingNow = useRef(false);
  const [logging, setLogging] = useState(false);
  // A change whose answer never came keeps its id, so trying again can't make it twice.
  const changeIds = useRef(new Map<string, string>());
  // A plan read that lands shows what the server holds: a change sent after it is a new change.
  useEffect(() => {
    changeIds.current.clear();
  }, [shownFrom]);
  const quiet = () => {
    setSaid(null);
    setTrouble(null);
    setUndo(null);
  };
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) quiet();
  }, [focused]);

  const plan = answered?.data ?? (read.kind === "ok" ? read.data : null);
  useEffect(() => {
    if (openWeekAt === null) return;
    setShownDay(planDayOf(new Date()));
    setAsking(false);
    setWeek(true);
    onWeekOpened();
  }, [openWeekAt, onWeekOpened]);

  const send = async (key: string, method: "POST" | "PUT", path: string, body: Record<string, unknown>): Promise<boolean> => {
    if (sendingNow.current) return false;
    sendingNow.current = true;
    setBusy(true);
    setTrouble(null);
    setSaid(null);
    const changeId = changeIds.current.get(key) ?? newGoalId();
    changeIds.current.set(key, changeId);
    const answer = await session.signedIn({ method, path, body: { changeId, ...body } }, dietPlanResponseSchema);
    sendingNow.current = false;
    setBusy(false);
    if (answer.kind === "no_answer") {
      // Only Undo itself is still offered: an earlier swap's Undo beside a swap that failed would read as if it worked.
      if (!key.startsWith("undo|")) setUndo(null);
      setTrouble(NO_CONNECTION);
      return false;
    }
    changeIds.current.delete(key);
    if (answer.kind === "ok") {
      setAnswered({ data: answer.data, after: begun() });
      return true;
    }
    setUndo(null);
    setTrouble(answer.message === "" ? NO_CONNECTION : answer.message);
    // The phone's copy of the plan is older than the server's: read it again.
    if (answer.error === "plan_changed" || answer.status === 404) again();
    return false;
  };

  const make = async () => {
    if (await send("make", "POST", `${PLAN_READ}/make`, {})) {
      setUndo(null);
      setAsking(false);
      setShownDay(today);
      setSaid("Your week is ready.");
    }
  };
  const swap = async (day: number, at: number) => {
    const before = plan?.days[day - 1]?.meals ?? [];
    const shown = (before[at]?.items ?? []).map((i) => i.canonical);
    if (await send(`swap|${String(day)}|${String(at)}`, "POST", `${PLAN_READ}/days/${String(day)}/swap`, { meal: at, shown })) {
      setUndo({ id: newGoalId(), day, meals: before });
      setSaid("Meal swapped.");
    }
  };
  const undoSwap = async (u: Undo) => {
    const meals = u.meals.map((m) => ({ mealType: m.mealType, items: m.items.map((i) => ({ canonical: i.canonical, grams: i.gramsPoint })) }));
    const shown = (plan?.days[u.day - 1]?.meals ?? []).map((m) => m.items.map((i) => i.canonical));
    if (await send(`undo|${u.id}`, "PUT", `${PLAN_READ}/days/${String(u.day)}`, { meals, shown })) {
      setUndo(null);
      setSaid("Meal put back.");
    }
  };
  const log = async (meal: DietPlanMeal) => {
    if (outbox === null || foodsToday === null || loggingNow.current) return;
    loggingNow.current = true;
    setLogging(true);
    setTrouble(null);
    const kept = await outbox.add(planMealAsMeal(meal, newGoalId(), new Date()));
    loggingNow.current = false;
    setLogging(false);
    setUndo(null);
    if (kept) setSaid(`Logged to ${mealTypeName(meal.mealType)}.`);
    else {
      setSaid(null);
      setTrouble("Too many meals are waiting to send. Go online, then log this one.");
    }
  };

  // Until today's meals are read, which planned meal is next isn't known.
  const held = busy || logging || outbox === null || foodsToday === null;
  // Undo stays offered until it is done or something else happens, even after a try that got no answer.
  const saidLine =
    said === null && undo === null ? null : (
      <View style={styles.row}>
        <Txt kind="small" colour="orange" style={styles.grow}>
          {said ?? "Meal swapped."}
        </Txt>
        {undo === null ? null : <Button label="Undo" kind="link" compact disabled={busy} say="Undo the swap" onPress={() => { void undoSwap(undo); }} />}
      </View>
    );
  const troubleLine = trouble === null ? null : <Txt kind="small" colour="badText">{trouble}</Txt>;

  if (plan === null && read.kind !== "failed") {
    return (
      <Card style={styles.card}>
        <Title />
        <Txt kind="small">{NOT_KNOWN}</Txt>
      </Card>
    );
  }
  if (plan === null || !hasMeals(plan)) {
    // No plan: the meal ideas, which also ask for any answer still missing.
    return (
      <MealIdeas
        fresh={fresh}
        onAnswered={onAnswered}
        below={
          plan === null ? (
            <View style={styles.row}>
              <Txt kind="small" style={styles.grow}>
                Your meal plan couldn’t load.
              </Txt>
              <Button label="Try again" kind="link" say="Try your meal plan again" onPress={again} />
            </View>
          ) : plan.make.status === "ok" ? (
            <>
              {troubleLine}
              <Button label="Make my plan" compact disabled={busy} style={styles.start} onPress={() => { void make(); }} />
            </>
          ) : null
        }
      />
    );
  }

  const meals = plan.days[today - 1]?.meals ?? [];
  const nextAt = loggedOfDay(meals, foodsToday ?? []).indexOf(false);
  const next = meals[nextAt];
  const seeWeek = (
    <Button
      label="See the week"
      kind="link"
      compact
      onPress={() => {
        quiet();
        setShownDay(today);
        setWeek(true);
      }}
    />
  );
  const otherIdeas = (
    <Button
      label="Other ideas"
      kind="link"
      compact
      onPress={() => {
        quiet();
        setIdeasOpen(true);
      }}
    />
  );
  const shown = plan.days[shownDay - 1];
  const shownLogged = shown === undefined || shownDay !== today ? [] : loggedOfDay(shown.meals, foodsToday ?? []);
  const toDay = (by: 1 | -1) => {
    quiet();
    setShownDay(stepDay(shownDay, by));
  };
  return (
    <>
      <Card style={styles.card} testID="meal-plan-box">
        <Title />
        {week ? null : saidLine}
        {week ? null : troubleLine}
        {foodsToday === null ? (
          todayFailed ? (
            <View style={styles.row}>
              <Txt kind="small" style={styles.grow}>
                Your meals couldn’t load.
              </Txt>
              <Button label="Try again" kind="link" say="Try your meals again" onPress={retryToday} />
            </View>
          ) : (
            <Txt kind="small">{NOT_KNOWN}</Txt>
          )
        ) : next === undefined ? (
          <>
            <Txt kind="small">{meals.length === 0 ? "Nothing planned for today." : "All of today’s meals are logged."}</Txt>
            <View style={styles.actions}>
              {seeWeek}
              {otherIdeas}
            </View>
          </>
        ) : (
          <>
            <MealWords meal={next} />
            <OutsideDiet meal={next} />
            <View style={styles.actions}>
              <Button label="Log meal" compact disabled={held} say={`Log ${ideaName(next)}`} onPress={() => { void log(next); }} />
              <Button label="Swap" kind="link" compact disabled={held} say={`Swap ${ideaName(next)}`} onPress={() => { void swap(today, nextAt); }} />
              {seeWeek}
              {otherIdeas}
            </View>
            <Txt kind="tiny">{plan.caution}</Txt>
            {plan.labelCaution === null ? null : <Txt kind="tiny">{plan.labelCaution}</Txt>}
          </>
        )}
      </Card>
      <Sheet
        open={ideasOpen}
        title="Other ideas"
        onClose={() => {
          setIdeasOpen(false);
        }}
      >
        <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={styles.list}>
          {ideasOpen ? <MealIdeas bare fresh={fresh} onAnswered={onAnswered} /> : null}
        </ScrollView>
      </Sheet>
      <Sheet
        open={week}
        title={asking ? "Make a new plan?" : "Your meal plan"}
        onClose={() => {
          quiet();
          setWeek(false);
          setAsking(false);
        }}
        onBack={() => {
          if (!asking) return false;
          setTrouble(null);
          setAsking(false);
          return true;
        }}
      >
        {shown === undefined ? null : asking ? (
          <>
            <Txt kind="small">This replaces your whole week, and any meals you swapped.</Txt>
            {troubleLine}
            <Button label="Make new plan" wide disabled={busy} onPress={() => { void make(); }} />
            <Button label="Keep my plan" kind="quiet" wide onPress={() => { setTrouble(null); setAsking(false); }} />
          </>
        ) : (
          <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={styles.list}>
            {plan.make.status === "ok" ? (
              <Button label="Make a new plan" kind="link" compact style={styles.start} onPress={() => { quiet(); setAsking(true); }} />
            ) : null}
            <View style={styles.dayRow}>
              <DayArrow name="back" say="Previous day" onPress={() => { toDay(-1); }} />
              <Txt kind="h3" style={styles.dayName}>
                {shownDay === today ? `Today · ${planDayName(shownDay)}` : planDayName(shownDay)}
              </Txt>
              <DayArrow name="go" say="Next day" onPress={() => { toDay(1); }} />
            </View>
            <DayNumbers day={shown} />
            {saidLine}
            {troubleLine}
            {shown.meals.length === 0 ? <Txt kind="small">Nothing planned for this day.</Txt> : null}
            {shown.meals.map((meal, at) => (
              <View key={String(at)} style={styles.meal}>
                <MealWords meal={meal} />
                <OutsideDiet meal={meal} />
                {shownLogged[at] === true ? (
                  <View style={styles.row}>
                    <Icon name="check" size={14} colour="goodText" />
                    <Txt kind="small" colour="goodText">
                      Logged
                    </Txt>
                  </View>
                ) : (
                  <View style={styles.actions}>
                    {shownDay === today ? (
                      <Button label="Log meal" kind="soft" compact disabled={held} say={`Log ${ideaName(meal)}`} onPress={() => { void log(meal); }} />
                    ) : null}
                    <Button label="Swap" kind="link" compact disabled={held} say={`Swap ${ideaName(meal)}`} onPress={() => { void swap(shownDay, at); }} />
                  </View>
                )}
              </View>
            ))}
            <Txt kind="tiny">{plan.caution}</Txt>
            {plan.labelCaution === null ? null : <Txt kind="tiny">{plan.labelCaution}</Txt>}
          </ScrollView>
        )}
      </Sheet>
    </>
  );
}

/** The Dashboard's Recommended box: the same answer as the Food page's. Today's meals are read only
 *  for somebody with a plan. */
export function Recommended({ onMore, onPlan }: { onMore: () => void; onPlan: () => void }) {
  const { read, again } = useRead(PLAN_READ, dietPlanResponseSchema);
  if (read.kind === "loading") return <MealIdeas onMore={onMore} planned="loading" />;
  // Never the ideas as if there were no plan: Food says the same.
  if (read.kind === "failed") return <MealIdeas onMore={onMore} planned={{ failed: "Your meal plan couldn’t load.", retry: again }} />;
  if (hasMeals(read.data)) return <RecommendedFromPlan plan={read.data} onMore={onPlan} />;
  return <MealIdeas onMore={onMore} />;
}

function RecommendedFromPlan({ plan, onMore }: { plan: DietPlanResponse; onMore: () => void }) {
  const { view } = useMealOutbox();
  const dayStart = startOfDay(new Date()).getTime();
  const day = useMemo(() => new Date(dayStart), [dayStart]);
  // The Food page is the one that tells the outbox a read has caught up.
  const { read: mealsRead, again } = useDayMeals(day, view.sent, NO_SETTLE);
  const rows = dayRows(mealsRead, view, day);
  // Until today's meals are read, which planned meal is next isn't known.
  if (rows === null) {
    return <MealIdeas onMore={onMore} planned={mealsRead.kind === "failed" ? { failed: "Your meals couldn’t load.", retry: again } : "loading"} />;
  }
  const meals = plan.days[planDayOf(day) - 1]?.meals ?? [];
  const foods = rows.map((r) => foodsOfRow(r, view.waiting));
  const planned: PlannedNow = {
    meal: meals[loggedOfDay(meals, foods).indexOf(false)] ?? null,
    allLogged: meals.length > 0,
    canLog: true,
    caution: plan.caution,
    labelCaution: plan.labelCaution,
  };
  return <MealIdeas onMore={onMore} planned={planned} />;
}

function Title() {
  return (
    <View style={styles.row}>
      <Icon name="apple" size={16} colour="orange" />
      <Txt kind="h3">What to eat next</Txt>
    </View>
  );
}

function DayArrow({ name, say, onPress }: { name: "back" | "go"; say: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say} onPress={onPress} style={styles.arrow}>
      <Icon name={name} size={18} />
    </Pressable>
  );
}

function DayNumbers({ day }: { day: DietPlanDayReply }) {
  if (day.meals.length === 0) return null;
  return (
    <Txt kind="small">
      {count(day.planned.kcal)} kcal planned
      {day.target === null ? "" : ` · target ${count(day.target.kcal)} kcal`}
    </Txt>
  );
}

function OutsideDiet({ meal }: { meal: DietPlanMeal }) {
  if (meal.outsideDiet.length === 0) return null;
  return (
    <View style={styles.row}>
      <Icon name="warn" size={14} colour="gold" />
      <Txt kind="small" colour="gold" style={styles.grow}>
        Not in your diet: {meal.outsideDiet.join(", ")}.
      </Txt>
    </View>
  );
}

function MealWords({ meal }: { meal: DietPlanMeal }) {
  return (
    <View style={styles.words}>
      <Txt kind="strong">
        {mealTypeName(meal.mealType)} · {count(meal.totals.kcalPoint)} kcal
      </Txt>
      {meal.items.map((food, at) => (
        <Txt key={String(at)} kind="small" colour="text">
          {foodTitle(food)} {loggedAmount(food)}
        </Txt>
      ))}
      <Txt kind="tiny" style={styles.numbers}>
        {count(Math.round(meal.totals.proteinG))} g protein · {count(Math.round(meal.totals.carbsG))} g carbs · {count(Math.round(meal.totals.fatG))} g fat
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  start: { alignSelf: "flex-start" },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  words: { gap: 3 },
  numbers: { fontFamily: fonts.semibold },
  list: { gap: 12, paddingBottom: 8 },
  dayRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dayName: { flexShrink: 1, textAlign: "center" },
  arrow: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  meal: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colours.line },
});
