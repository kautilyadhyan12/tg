import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { dietPlanResponseSchema, missingText, type DietPlanDayReply, type DietPlanMeal, type DietPlanResponse } from "@app/shared";
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
import { Setup } from "../setup/Setup";
import { mealTypeName } from "./day";
import { ideaName } from "./ideaRules";
import { useMealOutbox } from "./MealOutbox";
import { loggedAmount } from "./measures";
import { loggedOfDay, planDayName, planDayOf, planMealAsMeal, stepDay } from "./planRules";
import { foodTitle } from "./rows";

export const PLAN_READ = "/v1/nutrition/diet-plan";
const NO_CONNECTION = "No connection. Try again.";

interface MealPlanProps {
  /** The foods of each meal on today's list; null until the list is read, and nothing is logged till then. */
  foodsToday: readonly (readonly string[])[] | null;
  /** Moves when setup answers change elsewhere on the page. */
  fresh: number;
  onAnswered: () => void;
}

/** The person's week of meals: today's next meal on the Food page, and the week in a box. Every number
 *  and every refusal is the server's. */
export function MealPlan({ foodsToday, fresh, onAnswered }: MealPlanProps) {
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
  const [shownDay, setShownDay] = useState(today);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const loggingNow = useRef(false);
  const sendingNow = useRef(false);
  const [logging, setLogging] = useState(false);
  // A change whose answer never came keeps its id, so trying again can't make it twice.
  const changeIds = useRef(new Map<string, string>());
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) {
      setSaid(null);
      setTrouble(null);
    }
  }, [focused]);

  const send = async (key: string, path: string, body: Record<string, unknown>): Promise<boolean> => {
    if (sendingNow.current) return false;
    sendingNow.current = true;
    setBusy(true);
    setTrouble(null);
    setSaid(null);
    const changeId = changeIds.current.get(key) ?? newGoalId();
    changeIds.current.set(key, changeId);
    const answer = await session.signedIn({ method: "POST", path, body: { changeId, ...body } }, dietPlanResponseSchema);
    sendingNow.current = false;
    setBusy(false);
    if (answer.kind === "no_answer") {
      setTrouble(NO_CONNECTION);
      return false;
    }
    changeIds.current.delete(key);
    if (answer.kind === "ok") {
      setAnswered({ data: answer.data, after: begun() });
      return true;
    }
    setTrouble(answer.status === 409 ? answer.message : NO_CONNECTION);
    if (answer.error === "plan_changed") again();
    return false;
  };

  const make = async () => {
    if (await send("make", `${PLAN_READ}/make`, {})) {
      setAsking(false);
      setShownDay(today);
      setSaid("Your week is ready.");
    }
  };
  const swap = async (day: number, at: number) => {
    if (await send(`swap|${String(day)}|${String(at)}`, `${PLAN_READ}/days/${String(day)}/swap`, { meal: at })) {
      setSaid("Meal swapped.");
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
    if (kept) setSaid(`Logged to ${mealTypeName(meal.mealType)}.`);
    else {
      setSaid(null);
      setTrouble("Too many meals are waiting to send. Go online, then log this one.");
    }
  };

  const plan = answered?.data ?? (read.kind === "ok" ? read.data : null);
  const held = busy || logging || outbox === null;
  const saidLine = said === null ? null : <Txt kind="small" colour="orange">{said}</Txt>;
  const troubleLine = trouble === null ? null : <Txt kind="small" colour="badText">{trouble}</Txt>;
  const quiet = () => {
    setSaid(null);
    setTrouble(null);
  };

  let body;
  if (plan === null) {
    body =
      read.kind === "failed" ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            Your meal plan couldn’t load.
          </Txt>
          <Button label="Try again" kind="link" say="Try your meal plan again" onPress={again} />
        </View>
      ) : (
        <Txt kind="small">{NOT_KNOWN}</Txt>
      );
  } else if (plan.days.every((d) => d.meals.length === 0)) {
    if (plan.make.status === "needs_plan") return null; // The rings, above, already ask for it.
    body =
      plan.make.status === "needs_answers" ? (
        <>
          <Txt kind="small">To make your meal plan, answer {missingText(plan.make.missing)}.</Txt>
          <Button label="Answer now" kind="soft" small style={styles.start} say="Answer now for your meal plan" onPress={() => { setSetupOpen(true); }} />
        </>
      ) : (
        <>
          <Txt kind="small">A week of meals sized to your daily calories.</Txt>
          <Button label="Make my plan" compact disabled={busy} style={styles.start} onPress={() => { void make(); }} />
        </>
      );
  } else {
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
    body =
      next === undefined ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            {meals.length === 0 ? "Nothing planned for today." : "All of today’s meals are logged."}
          </Txt>
          {seeWeek}
        </View>
      ) : (
        <>
          <MealWords meal={next} />
          <OutsideDiet meal={next} />
          <View style={styles.actions}>
            <Button label="Log meal" compact disabled={held || foodsToday === null} say={`Log ${ideaName(next)}`} onPress={() => { void log(next); }} />
            <Button label="Swap" kind="link" compact disabled={held} say={`Swap ${ideaName(next)}`} onPress={() => { void swap(today, nextAt); }} />
            {seeWeek}
          </View>
          <Txt kind="tiny">{plan.caution}</Txt>
          {plan.labelCaution === null ? null : <Txt kind="tiny">{plan.labelCaution}</Txt>}
        </>
      );
  }

  const shown = plan?.days[shownDay - 1];
  const shownLogged = shown === undefined || shownDay !== today ? [] : loggedOfDay(shown.meals, foodsToday ?? []);
  const toDay = (by: 1 | -1) => {
    quiet();
    setShownDay(stepDay(shownDay, by));
  };
  return (
    <>
      <Card style={styles.card} testID="meal-plan-box">
        <View style={styles.row}>
          <Icon name="calendar" size={16} colour="orange" />
          <Txt kind="h3">Your meal plan</Txt>
        </View>
        {week ? null : saidLine}
        {week ? null : troubleLine}
        {body}
      </Card>
      <Sheet
        open={week && plan !== null}
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
        {plan === null || shown === undefined ? null : asking ? (
          <>
            <Txt kind="small">This replaces your whole week, and any meals you swapped.</Txt>
            {troubleLine}
            <Button label="Make new plan" wide disabled={busy} onPress={() => { void make(); }} />
            <Button label="Keep my plan" kind="quiet" wide onPress={() => { setTrouble(null); setAsking(false); }} />
          </>
        ) : (
          <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={styles.list}>
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
                      <Button label="Log meal" kind="soft" compact disabled={held || foodsToday === null} say={`Log ${ideaName(meal)}`} onPress={() => { void log(meal); }} />
                    ) : null}
                    <Button label="Swap" kind="link" compact disabled={held} say={`Swap ${ideaName(meal)}`} onPress={() => { void swap(shownDay, at); }} />
                  </View>
                )}
              </View>
            ))}
            <Txt kind="tiny">{plan.caution}</Txt>
            {plan.labelCaution === null ? null : <Txt kind="tiny">{plan.labelCaution}</Txt>}
            {plan.make.status === "ok" ? (
              <Button label="Make a new plan" kind="link" style={styles.start} onPress={() => { quiet(); setAsking(true); }} />
            ) : null}
          </ScrollView>
        )}
      </Sheet>
      {setupOpen ? (
        <Setup
          open
          at="food"
          onClose={() => {
            setSetupOpen(false);
            onAnswered();
          }}
          onSettled={onAnswered}
        />
      ) : null}
    </>
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
