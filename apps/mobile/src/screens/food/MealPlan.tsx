import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import {
  MOST_PLAN_MEALS, dietPlanResponseSchema, mealMeasuresResponseSchema, mealTypeSchema, planItemChoice,
  type DietPlanDayReply, type DietPlanMeal, type DietPlanResponse, type MealType,
} from "@app/shared";
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
import { FoodChoiceRow, useFoodChoice } from "./FoodChoice";
import { MealIdeas, NO_PLAN_YET, type PlannedNow } from "./MealIdeas";
import { useMealOutbox } from "./MealOutbox";
import { loggedAmount } from "./measures";
import type { BasketFood, PlanMealTarget } from "./basket";
import { dayWithMeal, foodsOfRow, hasMeals, loggedOfDay, planBasketFood, planDayName, planDayOf, planMealAsMeal, stepDay } from "./planRules";
import { foodTitle, measuresWithoutServer } from "./rows";

export const PLAN_READ = "/v1/nutrition/diet-plan";
const NO_CONNECTION = "No connection. Try again.";
const NO_SETTLE = () => undefined;
const NOTHING_TODAY = "No meals in your plan today.";

/** What Undo puts back: the day as it stood before the last swap, and the day's version the swap made. */
interface Undo { id: string; day: number; meals: DietPlanMeal[]; version: string }

/** A meal of the plan open in the food box: one of a day's (`at`), or a new one (`at` null), with the day
 *  as it was when the box opened. Saved, the change is made to that day or refused, never to another. */
interface Editing { id: string; day: number; at: number | null; mealType: MealType; start: BasketFood[]; before: DietPlanMeal[]; version: string }

/** What a change came to: made, refused as made from an older copy of the plan, or not made. */
type Sent = { kind: "ok"; data: DietPlanResponse } | { kind: "changed" } | { kind: "failed" };

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
  /** The Food page's own food box, to change a meal of the plan or put a new one in (34e-ii-b). */
  pickFoods: (plan: PlanMealTarget, onClose: () => void) => ReactNode;
}

/** The Food page's one answer to "what do I eat now?": the plan's next meal for somebody with a plan,
 *  the meal ideas for somebody without. Every number and every refusal is the server's. */
export function WhatToEatNext({ foodsToday, fresh, onAnswered, todayFailed, retryToday, openWeekAt, onWeekOpened, pickFoods }: WhatToEatNextProps) {
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
  const [editing, setEditing] = useState<Editing | null>(null);
  // The week's two questions: which meal to add to the day shown, and whether to remove one of its meals.
  const [choosing, setChoosing] = useState(false);
  const [removing, setRemoving] = useState<{ at: number; version: string } | null>(null);
  const [opening, setOpening] = useState(false);
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
  const onChoice = useCallback((data: DietPlanResponse) => {
    setAnswered({ data, after: begun() });
  }, [begun]);
  const choice = useFoodChoice(plan?.choice ?? null, { begun, shownFrom, again }, onChoice);
  // The plan changed under "Remove this meal?": the question goes, and the week says why.
  const removingFrom = removing?.version ?? null;
  const shownVersion = plan?.days[shownDay - 1]?.version ?? null;
  useEffect(() => {
    if (removingFrom === null || shownVersion === null || removingFrom === shownVersion) return;
    setRemoving(null);
    setTrouble("Your plan has changed, so nothing was removed.");
  }, [removingFrom, shownVersion]);
  useEffect(() => {
    if (openWeekAt === null) return;
    setShownDay(planDayOf(new Date()));
    setAsking(false);
    setChoosing(false);
    setRemoving(null);
    setWeek(true);
    onWeekOpened();
  }, [openWeekAt, onWeekOpened]);

  const send = async (key: string, method: "POST" | "PUT", path: string, body: Record<string, unknown>): Promise<Sent> => {
    if (sendingNow.current) return { kind: "failed" };
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
      return { kind: "failed" };
    }
    changeIds.current.delete(key);
    if (answer.kind === "ok") {
      setAnswered({ data: answer.data, after: begun() });
      return { kind: "ok", data: answer.data };
    }
    setUndo(null);
    setTrouble(answer.message === "" ? NO_CONNECTION : answer.message);
    // The phone's copy of the plan is older than the server's: read it again.
    const changed = answer.error === "plan_changed" || answer.status === 404;
    if (changed) again();
    return changed ? { kind: "changed" } : { kind: "failed" };
  };

  const make = async () => {
    if ((await send("make", "POST", `${PLAN_READ}/make`, {})).kind === "ok") {
      setUndo(null);
      setAsking(false);
      setShownDay(today);
      setSaid("Your week is ready.");
    }
  };
  const swap = async (day: number, at: number) => {
    const shown = plan?.days[day - 1];
    if (shown === undefined) return;
    const sent = await send(`swap|${String(day)}|${String(at)}|${shown.version}`, "POST", `${PLAN_READ}/days/${String(day)}/swap`, { meal: at, version: shown.version });
    if (sent.kind === "ok") {
      setUndo({ id: newGoalId(), day, meals: shown.meals, version: sent.data.days[day - 1]?.version ?? "" });
      setSaid("Meal swapped.");
    }
  };
  const undoSwap = async (u: Undo) => {
    // Each food as it was, the person's own by their own numbers.
    const meals = u.meals.map((m) => ({ mealType: m.mealType, items: m.items.map(planItemChoice) }));
    if ((await send(`undo|${u.id}`, "PUT", `${PLAN_READ}/days/${String(u.day)}`, { meals, version: u.version })).kind === "ok") {
      setUndo(null);
      setSaid("Meal put back.");
    }
  };
  const log = async (meal: DietPlanMeal, at: number) => {
    if (outbox === null || foodsToday === null || loggingNow.current) return;
    loggingNow.current = true;
    setLogging(true);
    setTrouble(null);
    const kept = await outbox.add(planMealAsMeal(meal, newGoalId(), new Date(), { day: today, meal: at }));
    loggingNow.current = false;
    setLogging(false);
    setUndo(null);
    if (kept) setSaid(`Logged to ${mealTypeName(meal.mealType)}.`);
    else {
      setSaid(null);
      setTrouble("Too many meals are waiting to send. Go online, then log this one.");
    }
  };

  /** A meal of the plan opened in the food box, each food with its own measures where the server gives them. */
  const openMeal = async (day: number, at: number, meal: DietPlanMeal) => {
    const shown = plan?.days[day - 1];
    if (opening || shown === undefined) return;
    quiet();
    setOpening(true);
    const answer = await session.signedIn({ method: "GET", path: `${PLAN_READ}/days/${String(day)}/meals/${String(at)}/measures` }, mealMeasuresResponseSchema);
    setOpening(false);
    const measures = answer.kind === "ok" && answer.data.measures.length === meal.items.length ? answer.data.measures : null;
    const start = meal.items.map((item, i) => planBasketFood(item, measures?.[i] ?? measuresWithoutServer(item), newGoalId()));
    setEditing({ id: newGoalId(), day, at, mealType: meal.mealType, start, before: shown.meals, version: shown.version });
  };
  const newMeal = (mealType: MealType) => {
    const shown = plan?.days[shownDay - 1];
    if (shown === undefined) return;
    quiet();
    setChoosing(false);
    setEditing({ id: newGoalId(), day: shownDay, at: null, mealType, start: [], before: shown.meals, version: shown.version });
  };
  /** The day sent whole with the meal's foods, from the day as it was when the box opened. */
  const saveMeal = async (e: Editing, foods: readonly BasketFood[]) => {
    const meals = dayWithMeal(e.before, { at: e.at, mealType: e.mealType, items: foods.map((f) => f.chosen) });
    const sent = await send(`edit|${e.id}`, "PUT", `${PLAN_READ}/days/${String(e.day)}`, { meals, version: e.version });
    // Changed since the box opened: it closes, and the week, read again, says so.
    if (sent.kind === "changed") setEditing(null);
    if (sent.kind === "ok") {
      setEditing(null);
      setUndo(null);
      setSaid(e.at === null ? `${mealTypeName(e.mealType)} added to ${planDayName(e.day)}.` : `${mealTypeName(e.mealType)} saved.`);
    }
  };
  const removeMeal = async (day: number, r: { at: number; version: string }) => {
    const shown = plan?.days[day - 1];
    const meal = shown?.meals[r.at];
    if (shown === undefined || meal === undefined) return;
    const meals = dayWithMeal(shown.meals, { at: r.at, mealType: meal.mealType, items: null });
    if ((await send(`remove|${String(day)}|${String(r.at)}|${r.version}`, "PUT", `${PLAN_READ}/days/${String(day)}`, { meals, version: r.version })).kind === "ok") {
      setRemoving(null);
      setUndo(null);
      setSaid(`${mealTypeName(meal.mealType)} removed from ${planDayName(day)}.`);
    }
  };
  const openWeek = () => {
    quiet();
    setShownDay(today);
    setChoosing(false);
    setRemoving(null);
    setWeek(true);
  };
  /** The week, on today, already asking which meal to add. */
  const addMeal = () => {
    openWeek();
    setChoosing(true);
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

  if (plan === null) {
    return read.kind === "failed" ? (
      <MealIdeas
        fresh={fresh}
        onAnswered={onAnswered}
        below={
          <View style={styles.row}>
            <Txt kind="small" style={styles.grow}>
              Your meal plan couldn’t load.
            </Txt>
            <Button label="Try again" kind="link" say="Try your meal plan again" onPress={again} />
          </View>
        }
      />
    ) : (
      <Card style={styles.card}>
        <Title />
        <Txt kind="small">{NOT_KNOWN}</Txt>
      </Card>
    );
  }

  const shown = plan.days[shownDay - 1];
  const shownLogged = shown === undefined || shownDay !== today ? [] : loggedOfDay(shown.meals, foodsToday ?? []);
  const toDay = (by: 1 | -1) => {
    quiet();
    setShownDay(stepDay(shownDay, by));
  };
  // The meal asked about, while the day is the one it was asked from.
  const removingMeal = removing === null || shown?.version !== removing.version ? undefined : shown.meals[removing.at];
  const backStep = (): boolean => {
    if (!asking && !choosing && removing === null) return false;
    setTrouble(null);
    setAsking(false);
    setChoosing(false);
    setRemoving(null);
    return true;
  };
  const planned = hasMeals(plan);
  const choices = choice.shown === null ? null : <FoodChoiceRow shown={choice.shown} pick={choice.pick} trouble={choice.trouble} />;
  const sheets = (
    <>
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
        open={week && editing === null}
        title={asking ? "Make a new plan?" : choosing ? "Add a meal" : removingMeal !== undefined ? "Remove this meal?" : "Your meal plan"}
        onClose={() => {
          quiet();
          setWeek(false);
          setAsking(false);
          setChoosing(false);
          setRemoving(null);
        }}
        onBack={backStep}
      >
        {shown === undefined ? null : asking ? (
          <>
            <Txt kind="small">This replaces your whole week, and any changes you made to it.</Txt>
            {troubleLine}
            <Button label="Make new plan" wide disabled={busy} onPress={() => { void make(); }} />
            <Button label="Keep my plan" kind="quiet" wide onPress={() => { setTrouble(null); setAsking(false); }} />
          </>
        ) : choosing ? (
          <>
            <Txt kind="small">Which meal on {planDayName(shownDay)}?</Txt>
            {mealTypeSchema.options.map((type) => (
              <Button key={type} label={mealTypeName(type)} kind="soft" wide onPress={() => { newMeal(type); }} />
            ))}
          </>
        ) : removingMeal !== undefined && removing !== null ? (
          <>
            <Txt kind="small">
              {mealTypeName(removingMeal.mealType)} · {ideaName(removingMeal)} comes off {planDayName(shownDay)} in your plan.
            </Txt>
            {troubleLine}
            <Button label="Remove meal" kind="danger" wide disabled={busy} onPress={() => { void removeMeal(shownDay, removing); }} />
            <Button label="Keep it" kind="quiet" wide onPress={() => { setTrouble(null); setRemoving(null); }} />
          </>
        ) : (
          <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={styles.list}>
            {plan.make.status !== "ok" ? null : planned ? (
              <Button label="Make a new plan" kind="link" compact style={styles.start} onPress={() => { quiet(); setAsking(true); }} />
            ) : (
              <Button label="Make my plan" kind="link" compact disabled={busy} style={styles.start} onPress={() => { void make(); }} />
            )}
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
            {shown.meals.map((meal, at) => {
              const change = (
                <>
                  <Button label="Change" kind="link" compact disabled={busy || opening} say={`Change ${ideaName(meal)}`} onPress={() => { void openMeal(shownDay, at, meal); }} />
                  <Button label="Remove" kind="link" compact disabled={busy} say={`Remove ${ideaName(meal)}`} onPress={() => { quiet(); setRemoving({ at, version: shown.version }); }} />
                </>
              );
              return (
                <View key={String(at)} style={styles.meal}>
                  <MealWords meal={meal} />
                  <OutsideDiet meal={meal} />
                  {shownLogged[at] === true ? (
                    <View style={styles.actions}>
                      <Icon name="check" size={14} colour="goodText" />
                      <Txt kind="small" colour="goodText" style={styles.logged}>
                        Logged
                      </Txt>
                      {change}
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      {shownDay === today ? (
                        <Button label="Log meal" kind="soft" compact disabled={held} say={`Log ${ideaName(meal)}`} onPress={() => { void log(meal, at); }} />
                      ) : null}
                      <Button label="Swap" kind="link" compact disabled={held} say={`Swap ${ideaName(meal)}`} onPress={() => { void swap(shownDay, at); }} />
                      {change}
                    </View>
                  )}
                </View>
              );
            })}
            {shown.meals.length >= MOST_PLAN_MEALS ? (
              <Txt kind="small">A day holds up to {String(MOST_PLAN_MEALS)} meals.</Txt>
            ) : (
              <Button label="Add a meal" icon="plus" kind="soft" wide disabled={busy} onPress={() => { quiet(); setChoosing(true); }} />
            )}
            <Txt kind="tiny">{plan.caution}</Txt>
            {plan.labelCaution === null ? null : <Txt kind="tiny">{plan.labelCaution}</Txt>}
          </ScrollView>
        )}
      </Sheet>
      {editing === null ? null : (
        <Fragment key={editing.id}>
          {pickFoods(
            {
              mealType: editing.mealType,
              title: `${mealTypeName(editing.mealType)} · ${planDayName(editing.day)}`,
              start: editing.start,
              save: (foods) => saveMeal(editing, foods),
              busy,
              trouble,
            },
            () => {
              setTrouble(null);
              setEditing(null);
            },
          )}
        </Fragment>
      )}
    </>
  );

  if (choice.shown === "mine" && !planned) {
    // My plan picked, and none yet: the app's plan, or one's own.
    return (
      <>
        <Card style={styles.card} testID="meal-plan-box">
          <Title />
          {choices}
          {week ? null : saidLine}
          <Txt kind="small">{NO_PLAN_YET}</Txt>
          {week ? null : troubleLine}
          <View style={styles.actions}>
            <Button label="Build my own" compact onPress={openWeek} />
            {plan.make.status === "ok" ? <Button label="Make my plan" kind="link" compact disabled={busy} onPress={() => { void make(); }} /> : null}
          </View>
        </Card>
        {sheets}
      </>
    );
  }

  if (choice.shown === "suggested") {
    // Suggested: the meal ideas, which also ask for any answer still missing; with no plan, the app's plan or one's own.
    return (
      <>
        <MealIdeas
          fresh={fresh}
          onAnswered={onAnswered}
          choices={choices}
          below={planned ? null : 
            <>
              {week ? null : troubleLine}
              <View style={styles.actions}>
                {plan.make.status === "ok" ? <Button label="Make my plan" compact disabled={busy} onPress={() => { void make(); }} /> : null}
                <Button label="Build my own" kind="link" compact onPress={openWeek} />
              </View>
            </>
          }
        />
        {sheets}
      </>
    );
  }

  const meals = plan.days[today - 1]?.meals ?? [];
  const nextAt = loggedOfDay(meals, foodsToday ?? []).indexOf(false);
  const next = meals[nextAt];
  const seeWeek = <Button label="See the week" kind="link" compact onPress={openWeek} />;
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
  return (
    <>
      <Card style={styles.card} testID="meal-plan-box">
        <Title />
        {choices}
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
        ) : meals.length === 0 ? (
          // A day of the plan with no meals: the app's ideas in its place (Kd, 31d-i's click-through).
          <MealIdeas
            bare
            fresh={fresh}
            onAnswered={onAnswered}
            lead={{ words: NOTHING_TODAY, action: { label: "Add a meal", onPress: addMeal } }}
          />
        ) : next === undefined ? (
          <>
            <Txt kind="small">All of today’s meals are logged.</Txt>
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
              <Button label="Log meal" compact disabled={held} say={`Log ${ideaName(next)}`} onPress={() => { void log(next, nextAt); }} />
              <Button label="Swap" kind="link" compact disabled={held} say={`Swap ${ideaName(next)}`} onPress={() => { void swap(today, nextAt); }} />
              {seeWeek}
              {otherIdeas}
            </View>
            <Txt kind="tiny">{plan.caution}</Txt>
            {plan.labelCaution === null ? null : <Txt kind="tiny">{plan.labelCaution}</Txt>}
          </>
        )}
      </Card>
      {sheets}
    </>
  );
}

/** The Dashboard's Recommended box: the same answer as the Food page's. Today's meals are read only
 *  for somebody with a plan. */
/** The Dashboard's Recommended box. Its Log meal opens the Food page's What to eat next, where the meal
 *  is logged: the Dashboard never logs one by itself (Kd, 2026-11-02). */
export function Recommended({ onMore, onPlan, onLog }: { onMore: () => void; onPlan: () => void; onLog: () => void }) {
  const { read, again, begun, shownFrom } = useRead(PLAN_READ, dietPlanResponseSchema);
  const choice = useFoodChoice(read.kind === "ok" ? read.data.choice : null, { begun, shownFrom, again });
  if (read.kind === "loading") return <MealIdeas onMore={onMore} onLog={onLog} planned="loading" />;
  // Never the ideas as if there were no plan: Food says the same.
  if (read.kind === "failed") return <MealIdeas onMore={onMore} onLog={onLog} planned={{ failed: "Your meal plan couldn’t load.", retry: again }} />;
  const shown = choice.shown ?? read.data.choice;
  const choices = <FoodChoiceRow shown={shown} pick={choice.pick} trouble={choice.trouble} />;
  if (shown === "suggested") return <MealIdeas onMore={onMore} onLog={onLog} choices={choices} />;
  if (hasMeals(read.data)) return <RecommendedFromPlan plan={read.data} onMore={onPlan} onIdeas={onMore} onLog={onLog} choices={choices} />;
  return <MealIdeas onMore={onMore} onLog={onLog} choices={choices} planned={{ build: onPlan }} />;
}

function RecommendedFromPlan({ plan, onMore, onIdeas, onLog, choices }: { plan: DietPlanResponse; onMore: () => void; onIdeas: () => void; onLog: () => void; choices: ReactNode }) {
  const { view } = useMealOutbox();
  const dayStart = startOfDay(new Date()).getTime();
  const day = useMemo(() => new Date(dayStart), [dayStart]);
  // The Food page is the one that tells the outbox a read has caught up.
  const { read: mealsRead, again } = useDayMeals(day, view.sent, NO_SETTLE);
  const rows = dayRows(mealsRead, view, day);
  // Until today's meals are read, which planned meal is next isn't known.
  if (rows === null) {
    return <MealIdeas onMore={onMore} choices={choices} planned={mealsRead.kind === "failed" ? { failed: "Your meals couldn’t load.", retry: again } : "loading"} />;
  }
  const meals = plan.days[planDayOf(day) - 1]?.meals ?? [];
  // Today has no meals in the plan: the app's ideas, as on the Food page.
  if (meals.length === 0) return <MealIdeas onMore={onIdeas} onLog={onLog} choices={choices} lead={{ words: NOTHING_TODAY, action: { label: "See meal plan", onPress: onMore } }} />;
  const foods = rows.map((r) => foodsOfRow(r, view.waiting));
  const planned: PlannedNow = {
    meal: meals[loggedOfDay(meals, foods).indexOf(false)] ?? null,
    canLog: true,
    caution: plan.caution,
    labelCaution: plan.labelCaution,
  };
  return <MealIdeas onMore={onMore} onLog={onLog} planned={planned} choices={choices} />;
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
  logged: { marginRight: 8 },
  arrow: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  meal: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colours.line },
});
