import { useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { MY_GYM_MEAL_PLANS_PATH, contactGymLabel, gymContactWays, myGymMealPlansResponseSchema, type DietPlanMeal, type LowestKcal, type MyGymMealPlan } from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { colours } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useRead } from "../dashboard/useRead";
import { NOT_KNOWN, count } from "../dashboard/words";
import { newGoalId } from "../goals/words";
import { mealTypeName } from "./day";
import { gymMeal, mealPlanEmail, noGymPlanLine, underLine, writtenByLine, type GymOfMine } from "./gymPlanRules";
import { ideaName } from "./ideaRules";
import { AllergyFoot, FromRow, initialsOf, nextMealWords, Notice, PlanMealCard } from "./MealCard";
import { useMealOutbox } from "./MealOutbox";
import { loggedAmount } from "./measures";
import { loggedOfDay, planDayName, planDayOf, planMealAsMeal, stepDay } from "./planRules";
import { foodTitle } from "./rows";

// The plan a gym gave the person, on the Food page's What to eat next (ROADMAP Stage 5 31g; spec Part 6
// §16.6): today's next meal from it with Log meal, and its week as the gym wrote it. Nothing on it is
// changed from the phone; the person's own plan is My plan.

const LINK_NOT_OPENED = "No app on this phone can open that.";

/** Each gym the person is a member of, and the plan it gave them. */
export function useGymPlans(fresh = 0) {
  return useRead(MY_GYM_MEAL_PLANS_PATH, myGymMealPlansResponseSchema, fresh);
}

/** The gym's name and its "hasn't given you a meal plan" line, with Contact the gym under it. */
export function NoGymPlan({ gym }: { gym: GymOfMine }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const contact = gymContactWays(gym.contact, gym.name);
  const label = contactGymLabel(gym.orgType);
  return (
    <>
      <Txt kind="small">{noGymPlanLine(gym.name)}</Txt>
      {contact.none === null ? (
        <Button label={label} kind="soft" icon="phone" compact style={styles.start} onPress={() => { setFailed(false); setOpen(true); }} />
      ) : (
        <Txt kind="small">{contact.none}</Txt>
      )}
      {failed ? <Txt kind="small" colour="badText">{LINK_NOT_OPENED}</Txt> : null}
      <Sheet open={open} title={label} onClose={() => { setOpen(false); }}>
        <View style={styles.sheet}>
          {contact.ways.map((way) => (
            <Button
              key={way.kind}
              label={way.label}
              kind="plain"
              icon={way.kind === "phone" ? "phone" : "mail"}
              wide
              onPress={() => {
                setOpen(false);
                Linking.openURL(mealPlanEmail(way.href)).catch(() => { setFailed(true); });
              }}
            />
          ))}
        </View>
      </Sheet>
    </>
  );
}

interface GymPlanBoxProps {
  /** null while the gyms are read; the gym picked, else. */
  gym: GymOfMine | null | "failed";
  retry: () => void;
  choices: ReactNode;
  /** The foods of each meal on today's list; null until the list is read, and nothing is logged till then. */
  foodsToday: readonly (readonly string[])[] | null;
  todayFailed: boolean;
  retryToday: () => void;
  /** Another page asks for a week to open (the Dashboard's See meal plan). */
  openWeekAt: WeekAsk | null;
  onWeekOpened: () => void;
}

/** A request from another page to open a week: the gym's, or the person's own when gymId is null. */
export interface WeekAsk { at: number; gymId: string | null }

/** The Food page's What to eat next with the gym's plan picked. */
export function GymPlanBox({ gym, retry, choices, foodsToday, todayFailed, retryToday, openWeekAt, onWeekOpened }: GymPlanBoxProps) {
  const { outbox } = useMealOutbox();
  const today = planDayOf(new Date());
  const [week, setWeek] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const loggingNow = useRef(false);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) {
      setSaid(null);
      setTrouble(null);
    }
  }, [focused]);
  const plan = gym !== null && gym !== "failed" ? gym.plan : null;
  // Only a request for this gym's week: Food's choice may still be the one before the Dashboard's pick.
  const gymId = gym !== null && gym !== "failed" ? gym.gymId : null;
  useEffect(() => {
    if (openWeekAt === null || gymId === null || openWeekAt.gymId !== gymId) return;
    if (plan !== null) setWeek(true);
    onWeekOpened();
  }, [openWeekAt, onWeekOpened, plan, gymId]);

  const log = async (meal: DietPlanMeal) => {
    if (outbox === null || foodsToday === null || loggingNow.current) return;
    loggingNow.current = true;
    setLogging(true);
    setTrouble(null);
    const kept = await outbox.add(planMealAsMeal(meal, newGoalId(), new Date(), null));
    loggingNow.current = false;
    setLogging(false);
    if (kept) setSaid(`Logged to ${mealTypeName(meal.mealType)}.`);
    else {
      setSaid(null);
      setTrouble("Too many meals are waiting to send. Go online, then log this one.");
    }
  };
  const held = logging || outbox === null || foodsToday === null;
  const saidLine = said === null ? null : <Txt kind="small" colour="orange">{said}</Txt>;
  const troubleLine = trouble === null ? null : <Txt kind="small" colour="badText">{trouble}</Txt>;

  let body: ReactNode;
  if (gym === null) body = <Txt kind="small">{NOT_KNOWN}</Txt>;
  else if (gym === "failed") {
    body = (
      <View style={styles.row}>
        <Txt kind="small" style={styles.grow}>
          Your gym’s meal plan couldn’t load.
        </Txt>
        <Button label="Try again" kind="link" say="Try your gym’s meal plan again" onPress={retry} />
      </View>
    );
  } else if (plan === null) body = <NoGymPlan gym={gym} />;
  else {
    const day = plan.days[today - 1];
    const meals = (day?.meals ?? []).map(gymMeal);
    const nextAt = loggedOfDay(meals, foodsToday ?? []).indexOf(false);
    const next = meals[nextAt];
    const seeWeek = <Button label="See the week" kind="link" compact onPress={() => { setSaid(null); setWeek(true); }} />;
    body = (
      <>
        <GymFrom gym={gym} plan={plan} />
        {saidLine}
        {troubleLine}
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
          <>
            <Txt kind="small">No meals in this plan today.</Txt>
            {seeWeek}
          </>
        ) : next === undefined ? (
          <>
            <Txt kind="small">All of today’s meals are logged.</Txt>
            {seeWeek}
          </>
        ) : (
          <>
            <PlanMealCard meal={next} eyebrow={nextMealWords(next)} />
            <UnderLine under={day?.under} />
            <View style={styles.actions}>
              <Button label="Log meal" compact disabled={held} say={`Log ${ideaName(next)}`} onPress={() => { void log(next); }} />
              {seeWeek}
            </View>
          </>
        )}
        <AllergyFoot lines={[plan.caution]} />
      </>
    );
  }

  return (
    <>
      <Card style={styles.card} testID="gym-plan-box">
        <View style={styles.row}>
          <Icon name="apple" size={16} colour="orange" />
          <Txt kind="h3">What to eat next</Txt>
        </View>
        {choices}
        {body}
      </Card>
      {plan === null || gym === null || gym === "failed" ? null : (
        <GymWeek
          open={week}
          gymName={gym.name}
          plan={plan}
          today={today}
          foodsToday={foodsToday}
          held={held}
          said={saidLine}
          trouble={troubleLine}
          onLog={(meal) => { void log(meal); }}
          onClose={() => { setWeek(false); setSaid(null); setTrouble(null); }}
        />
      )}
    </>
  );
}

/** The week as the gym wrote it, a day at a time, today first: Log meal on today's meals, nothing to change. */
function GymWeek({ open, gymName, plan, today, foodsToday, held, said, trouble, onLog, onClose }: {
  open: boolean;
  gymName: string;
  plan: MyGymMealPlan;
  today: number;
  foodsToday: readonly (readonly string[])[] | null;
  held: boolean;
  said: ReactNode;
  trouble: ReactNode;
  onLog: (meal: DietPlanMeal) => void;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const [shownDay, setShownDay] = useState(today);
  useEffect(() => {
    if (open) setShownDay(today);
  }, [open, today]);
  const day = plan.days[shownDay - 1];
  const meals = (day?.meals ?? []).map(gymMeal);
  const logged = shownDay === today ? loggedOfDay(meals, foodsToday ?? []) : [];
  return (
    <Sheet open={open} title={`${gymName}’s meal plan`} onClose={onClose}>
      <ScrollView style={{ maxHeight: height * 0.72 }} contentContainerStyle={styles.list}>
        <Txt kind="tiny" colour="textSoft">{writtenByLine(plan)}</Txt>
        <View style={styles.dayRow}>
          <DayArrow name="back" say="Previous day" onPress={() => { setShownDay(stepDay(shownDay, -1)); }} />
          <Txt kind="h3" style={styles.dayName}>
            {shownDay === today ? `Today · ${planDayName(shownDay)}` : planDayName(shownDay)}
          </Txt>
          <DayArrow name="go" say="Next day" onPress={() => { setShownDay(stepDay(shownDay, 1)); }} />
        </View>
        {meals.length === 0 || day === undefined ? null : <Txt kind="small">{count(day.planned.kcal)} kcal planned</Txt>}
        <UnderLine under={day?.under} />
        {said}
        {trouble}
        {meals.length === 0 ? <Txt kind="small">Nothing planned for this day.</Txt> : null}
        {meals.map((meal, at) => (
          <View key={String(at)} style={styles.meal}>
            <GymMealWords meal={meal} />
            {shownDay !== today ? null : logged[at] === true ? (
              <View style={styles.actions}>
                <Icon name="check" size={14} colour="goodText" />
                <Txt kind="small" colour="goodText">
                  Logged
                </Txt>
              </View>
            ) : (
              <View style={styles.actions}>
                <Button label="Log meal" kind="soft" compact disabled={held} say={`Log ${ideaName(meal)}`} onPress={() => { onLog(meal); }} />
              </View>
            )}
          </View>
        ))}
        <Txt kind="tiny">{plan.caution}</Txt>
      </ScrollView>
    </Sheet>
  );
}

/** The day's one line where it holds less than the person may eat. */
export function UnderLine({ under }: { under: LowestKcal | null | undefined }) {
  const words = underLine(under ?? null);
  if (words === null) return null;
  return <Notice>{words}</Notice>;
}

/** Whose plan: the writer's initials, the plan's name, and who wrote it at which gym. */
export function GymFrom({ gym, plan }: { gym: GymOfMine; plan: Pick<MyGymMealPlan, "name" | "writtenBy"> }) {
  return (
    <FromRow
      badge={{ initials: initialsOf(plan.writtenBy ?? gym.name) }}
      title={plan.name}
      sub={plan.writtenBy === null ? gym.name : `By ${plan.writtenBy} · ${gym.name}`}
    />
  );
}

function DayArrow({ name, say, onPress }: { name: "back" | "go"; say: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say} onPress={onPress} style={styles.arrow}>
      <Icon name={name} size={18} />
    </Pressable>
  );
}

function GymMealWords({ meal }: { meal: DietPlanMeal }) {
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
  sheet: { gap: 10 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  words: { gap: 3 },
  numbers: { fontFamily: fonts.semibold },
  list: { gap: 12, paddingBottom: 8 },
  dayRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dayName: { flexShrink: 1, textAlign: "center" },
  arrow: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  meal: { gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colours.line },
});
