import { useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { IDEA_WHY_WORDS, mealIdeasResponseSchema, missingText, type DietPlanMeal, type SetupScreenId, type SuggestedIdea, type WaitingMeal } from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead } from "../dashboard/useRead";
import { NOT_KNOWN, count } from "../dashboard/words";
import { newGoalId } from "../goals/words";
import { Setup } from "../setup/Setup";
import { mealTypeName } from "./day";
import { ideaAmountWords, ideaAsMeal, ideaMealType, ideaName } from "./ideaRules";
import { useMealOutbox } from "./MealOutbox";
import { AllergyFoot, ART_SIZE, EmptyBox, Eyebrow, FoodLines, FromRow, NumberTiles, nextMealWords, planFoods } from "./MealCard";
import { planDayName, planDayOf } from "./planRules";

export const IDEAS_READ = "/v1/nutrition/suggestions";

/** The day's ideas, and whether they can be offered. The server can't count a meal still on the phone,
 *  and a read begun before a meal landed doesn't hold it: either way the ideas drawn are old, and the
 *  same one could be logged twice, so none is offered until a read begun after. */
function useIdeas(fresh: number) {
  const ideas = useRead(IDEAS_READ, mealIdeasResponseSchema, useZoneSaved() + fresh);
  const { outbox, view } = useMealOutbox();
  const { begun, again } = ideas;
  const [seen, setSeen] = useState({ sent: view.sent, read: 0 });
  useEffect(() => {
    if (view.sent === seen.sent) return;
    setSeen({ sent: view.sent, read: begun() });
    again();
  }, [view.sent, seen.sent, begun, again]);
  const waiting = view.waiting.length > 0 || view.changing.size > 0;
  const old = view.sent !== seen.sent || ideas.shownFrom <= seen.read;
  return { read: ideas.read, again, outbox, view, waiting, old };
}

interface MealIdeasProps {
  /** The Dashboard's Recommended box: the first idea, with More ideas. Without it, the Food screen's box. */
  onMore?: () => void;
  /** Answers were given in setup from this box: the page reads what hangs on them again. */
  onAnswered?: () => void;
  /** Moves when setup answers change elsewhere on the page. */
  fresh?: number;
  /** On the Food page's box: what goes under the ideas. */
  below?: ReactNode;
  /** Inside a box of its own: no card and no title. */
  bare?: boolean;
  /** The Dashboard's Recommended box, for somebody with a meal plan: the plan's next meal, in place of an idea. */
  planned?: PlannedNow;
  /** The Dashboard's Log meal: it opens the Food page's What to eat next, never logs by itself (Kd, 2026-11-02). */
  onLog?: () => void;
  /** A line above the ideas, with its one button: on a day the person's own plan has no meals, it says so. */
  lead?: { words: string; action: { label: string; onPress: () => void } };
  /** Under the box's title: Suggested or My plan (31f). */
  choices?: ReactNode;
}

/** "loading": whether there is a plan isn't known yet. `meal` null: every meal of today's plan is logged.
 *  `build`: My plan is picked and there is none yet. */
export type PlannedNow =
  | "loading"
  | { failed: string; retry: () => void }
  | { build: () => void }
  | { meal: DietPlanMeal | null; canLog: boolean; caution: string; labelCaution: string | null; from?: ReactNode; note?: ReactNode }
  /** Another choice's own words in the box: the gym's plan that hasn't been given (31g). */
  | { words: ReactNode }

export function MealIdeas({ onMore, onAnswered, fresh = 0, below = null, bare = false, planned, onLog, lead, choices = null }: MealIdeasProps) {
  const { read, again, outbox, view, waiting, old } = useIdeas(fresh);
  const onDashboard = onMore !== undefined;
  const [said, setSaid] = useState<{ words: string; meal: string | null } | null>(null);
  const [later, setLater] = useState(false);
  const [setupAt, setSetupAt] = useState<SetupScreenId | "where" | null>(null);
  const [logging, setLogging] = useState(false);
  const loggingNow = useRef(false);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) setSaid(null);
  }, [focused]);

  // A meal the server refused was not logged: what was said when it was kept goes for good.
  const refusedNow = said !== null && view.refused.some((r) => r.id === said.meal);
  useEffect(() => {
    if (refusedNow) setSaid(null);
  }, [refusedNow]);

  const keep = async (meal: WaitingMeal, type: DietPlanMeal["mealType"]) => {
    if (outbox === null || loggingNow.current) return;
    loggingNow.current = true;
    setLogging(true);
    const kept = await outbox.add(meal);
    loggingNow.current = false;
    setLogging(false);
    setLater(false);
    setSaid(kept ? { words: `Logged to ${mealTypeName(type)}.`, meal: meal.id } : { words: "Too many meals are waiting to send. Go online, then log this one.", meal: null });
  };
  const log = async (idea: SuggestedIdea) => {
    const now = new Date();
    const type = ideaMealType(now.getHours());
    await keep(ideaAsMeal(idea, newGoalId(), type, now), type);
  };

  const row = (idea: SuggestedIdea) => (
    <IdeaRow
      key={ideaName(idea)}
      idea={idea}
      held={logging || outbox === null}
      onLog={() => {
        void log(idea);
      }}
    />
  );
  const answerNow = (at: SetupScreenId | "where") => (
    <Button
      label="Answer now"
      kind="soft"
      small
      style={styles.start}
      onPress={() => {
        setSetupAt(at);
      }}
    />
  );
  const tryAgain = <Button label="Try again" kind="link" say="Try meal ideas again" onPress={again} />;

  let body;
  let rest: ReactNode = null;
  let foot = null;
  const plannedNow = onDashboard && planned !== undefined ? planned : null;
  if (plannedNow === "loading") {
    body = <Txt kind="small">{NOT_KNOWN}</Txt>;
  } else if (plannedNow !== null && "failed" in plannedNow) {
    body = (
      <View style={styles.row}>
        <Txt kind="small" style={styles.grow}>
          {plannedNow.failed}
        </Txt>
        <Button label="Try again" kind="link" say="Try again" onPress={plannedNow.retry} />
      </View>
    );
  } else if (plannedNow !== null && "build" in plannedNow) {
    body = (
      <>
        <MyPlanFrom />
        <EmptyBox title={NO_PLAN_YET} line={null} />
      </>
    );
    rest = <Button label="Build my own" compact style={styles.start} onPress={plannedNow.build} />;
  } else if (plannedNow !== null && "words" in plannedNow) {
    body = plannedNow.words;
  } else if (plannedNow !== null && onMore !== undefined) {
    const { meal, caution, labelCaution, from = <MyPlanFrom />, note = null } = plannedNow;
    if (meal === null) {
      body = (
        <>
          {from}
          <EmptyBox title="All of today’s meals are logged." line={null} />
        </>
      );
      rest = <Button label="See meal plan" kind="link" compact style={styles.start} onPress={onMore} />;
    } else {
      body = (
        <>
          {from}
          <View style={styles.mealWords}>
            <Eyebrow words={nextMealWords(meal)} />
            <FoodLines foods={planFoods(meal)} />
          </View>
        </>
      );
      rest = (
        <>
          <NumberTiles kcal={meal.totals.kcalPoint} proteinG={meal.totals.proteinG} carbsG={meal.totals.carbsG} fatG={meal.totals.fatG} />
          {meal.outsideDiet.length === 0 ? null : (
            <Txt kind="tiny" colour="gold">
              Not in your diet: {meal.outsideDiet.join(", ")}.
            </Txt>
          )}
          {note}
          <View style={styles.actions}>
            <Button label="Log meal" compact say={`Log ${ideaName(meal)}`} onPress={onLog ?? onMore} />
            <Button label="See meal plan" kind="link" compact onPress={onMore} />
          </View>
        </>
      );
      foot = <AllergyFoot lines={[caution, labelCaution]} />;
    }
  } else if (waiting) {
    body = (
      <View style={styles.row}>
        <Icon name="wifioff" size={16} colour="textSoft" />
        <Txt kind="small" style={styles.grow}>
          {view.unsaved ? "Waiting to send. It couldn’t be saved on this phone yet, so keep the app open." : "Waiting to send your meal."}
        </Txt>
      </View>
    );
  } else if (read.kind === "failed") {
    body = (
      <View style={styles.row}>
        <Txt kind="small" style={styles.grow}>
          Meal ideas couldn’t load.
        </Txt>
        {tryAgain}
      </View>
    );
  } else if (read.kind === "loading") {
    body = <Txt kind="small">{NOT_KNOWN}</Txt>;
  } else if (old) {
    body = (
      <View style={styles.row}>
        <Txt kind="small" style={styles.grow}>
          Getting new ideas…
        </Txt>
        {tryAgain}
      </View>
    );
  } else if (read.data.status === "needs_answers") {
    body = (
      <>
        <Txt kind="small">To see meal ideas, answer {missingText(read.data.missing)}.</Txt>
        {answerNow("food")}
      </>
    );
  } else if (read.data.status === "needs_plan") {
    // The Food screen's rings, just above, already ask for it.
    if (!onDashboard && !bare) return null;
    body = (
      <>
        <Txt kind="small">Finish setting up to see meal ideas.</Txt>
        {answerNow("where")}
      </>
    );
  } else if (read.data.meals[0] === undefined) {
    body = <Txt kind="small">No more meals to suggest today.</Txt>;
  } else {
    const { caution, labelCaution } = read.data;
    const [next, ...laterMeals] = read.data.meals;
    const best = onDashboard ? next.ideas[0] : undefined;
    if (best !== undefined && onMore !== undefined) {
      rest = (
        <>
          <NumberTiles kcal={best.totals.kcal} proteinG={best.totals.proteinG} carbsG={best.totals.carbsG} fatG={best.totals.fatG} />
          <View style={styles.actions}>
            <Button label="Log meal" compact say={`Log ${ideaName(best)}`} onPress={onLog ?? onMore} />
            <Button label="More ideas" kind="link" compact onPress={onMore} />
          </View>
        </>
      );
    }
    body = (
      <>
        {/* Whose ideas these are; under My plan's empty day, the ideas are said to be the app's. */}
        {best === undefined ? (
          <>
            {lead !== undefined ? <FromRow badge={{ icon: "sparkles" }} title="Picked for you" sub={null} /> : null}
            {onDashboard ? null : next.ideas.map(row)}
          </>
        ) : (
          <>
            <FromRow badge={{ icon: "sparkles" }} title="Picked for you" sub={IDEA_WHY_WORDS[best.why]} />
            <View style={styles.mealWords}>
              <Eyebrow words="Today’s idea" />
              <FoodLines foods={best.items.map((f) => ({ name: f.name, amount: ideaAmountWords(f) }))} />
            </View>
          </>
        )}
        {onDashboard || laterMeals.length === 0 ? null : (
          <Button
            label={laterMeals.length === 1 ? "1 more meal today" : `${String(laterMeals.length)} more meals today`}
            kind="link"
            style={styles.start}
            onPress={() => {
              setLater(true);
            }}
          />
        )}
      </>
    );
    foot = (
      <>
        <AllergyFoot lines={[caution, labelCaution]} />
        <Sheet
          open={later && !onDashboard}
          title="Later today"
          onClose={() => {
            setLater(false);
          }}
        >
          {laterMeals.map((meal, at) => (
            <View key={String(at)} style={styles.later}>
              <Txt kind="strong">{at === 0 ? "1 meal later" : `${String(at + 1)} meals later`} · about {count(meal.kcalTarget)} kcal</Txt>
              {meal.ideas.map(row)}
            </View>
          ))}
          <Txt kind="tiny">{caution}</Txt>
          {labelCaution === null ? null : <Txt kind="tiny">{labelCaution}</Txt>}
        </Sheet>
      </>
    );
  }

  const saidLine =
    said === null || refusedNow ? null : (
      <Txt kind="small" colour="orange">
        {said.words}
      </Txt>
    );
  const setup =
    setupAt === null ? null : (
      <Setup
        open
        at={setupAt === "where" ? null : setupAt}
        onClose={() => {
          setSetupAt(null);
          again();
          onAnswered?.();
        }}
        onSettled={() => {
          again();
          onAnswered?.();
        }}
      />
    );
  const leadLine =
    lead === undefined ? null : (
      <View style={styles.lead}>
        <MyPlanFrom />
        <EmptyBox title={lead.words} line={null} />
        <Button label={lead.action.label} kind="link" compact style={styles.start} onPress={lead.action.onPress} />
      </View>
    );
  if (bare) {
    return (
      <>
        {choices}
        {saidLine}
        {leadLine}
        {body}
        {rest}
        {foot}
        {setup}
      </>
    );
  }
  return (
    <>
      {onDashboard ? (
        <Card style={styles.card} testID="recommended-box">
          <View style={styles.titleRow}>
            <Icon name="target" size={16} colour="orange" />
            <Txt kind="h3" style={styles.boxTitle}>
              Recommended For You
            </Txt>
          </View>
          {/* The Exercise and Running options join with their own plans (ROADMAP 36, 37). */}
          <View style={styles.options}>
            <Pressable accessibilityRole="radio" accessibilityLabel="Food" accessibilityState={{ selected: true }} hitSlop={OPTION_SLOP} style={styles.option}>
              <Txt kind="tiny" colour="orange" style={styles.optionWord}>
                Food
              </Txt>
            </Pressable>
          </View>
          {choices}
          {/* Whose meal and the meal beside the picture, never under it; its numbers and the button across the box. */}
          <View style={styles.beside}>
            <View style={styles.leftWords}>
              {view.refused.map((r) => (
                <View key={r.id} style={styles.row}>
                  <Icon name="warn" size={16} colour="badText" />
                  <Txt kind="small" style={styles.grow}>
                    {r.name} wasn’t saved. {r.message}
                  </Txt>
                  <Button
                    label="OK"
                    kind="link"
                    onPress={() => {
                      outbox?.forget(r.id);
                    }}
                  />
                </View>
              ))}
              {saidLine}
              {/* My plan with nothing today: the empty day beside the picture, the app's idea across the box under it. */}
              {lead === undefined ? body : leadLine}
            </View>
            <View style={styles.art}>
              <Image source={pictures.foodbowl} resizeMode="contain" style={styles.artFill} accessible={false} />
            </View>
          </View>
          {lead === undefined ? null : body}
          {rest}
          {foot}
        </Card>
      ) : (
        <Card style={styles.card} testID="meal-ideas-box">
          <View style={styles.titleRow}>
            <Icon name="apple" size={16} colour="orange" />
            <Txt kind="h3">What to eat next</Txt>
          </View>
          {choices}
          {saidLine}
          {body}
          {rest}
          {foot}
          {below}
        </Card>
      )}
      {setup}
    </>
  );
}

/** Whose meal, when it is the person's own plan: today's. */
function MyPlanFrom() {
  return <FromRow badge={{ icon: "calendar" }} title="Your plan" sub={planDayName(planDayOf(new Date()))} />;
}

/** Why the idea holds what it does, in the server's one reason (spec Part 6 §16.6, 8). */
function Why({ idea }: { idea: SuggestedIdea }) {
  return (
    <Txt kind="tiny">{IDEA_WHY_WORDS[idea.why]}</Txt>
  );
}

function IdeaRow({ idea, held, onLog }: { idea: SuggestedIdea; held: boolean; onLog: () => void }) {
  return (
    <View style={styles.idea}>
      <View style={[styles.grow, styles.ideaWords]}>
        <FoodLines list foods={idea.items.map((f) => ({ name: f.name, amount: ideaAmountWords(f) }))} />
        <View style={styles.tags}>
          <Txt kind="tiny" colour="orangeLight" style={styles.tag}>
            {count(idea.totals.kcal)} kcal
          </Txt>
          <Txt kind="tiny" colour="text" style={styles.tag}>
            {count(Math.round(idea.totals.proteinG))} g protein
          </Txt>
        </View>
        <Why idea={idea} />
      </View>
      <Button label="Log" kind="soft" small disabled={held} say={`Log ${ideaName(idea)}`} onPress={onLog} />
    </View>
  );
}

/** My plan is picked and the person has none yet. */
export const NO_PLAN_YET = "You don’t have a meal plan yet.";

const OPTION_SLOP = { top: 12, bottom: 12, left: 8, right: 8 };

const styles = StyleSheet.create({
  card: { gap: 10 },
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  boxTitle: { fontSize: 14, lineHeight: 18, color: colours.textSoft },
  beside: { flexDirection: "row", gap: 8 },
  art: { width: ART_SIZE, height: ART_SIZE },
  artFill: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, width: "100%", height: "100%" },
  leftWords: { flex: 1, gap: 10 },
  options: { flexDirection: "row", gap: 14 },
  option: { alignSelf: "flex-start", paddingBottom: 3, borderBottomWidth: 2, borderBottomColor: colours.orange },
  optionWord: { fontFamily: fonts.semibold },
  mealWords: { gap: 4 },
  lead: { gap: 10 },
  ideaWords: { gap: 6 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: { fontFamily: fonts.semibold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colours.raised, overflow: "hidden" },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  start: { alignSelf: "flex-start" },
  idea: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colours.line },
  numbers: { fontFamily: fonts.semibold, marginTop: 2 },
  source: { fontFamily: fonts.semibold, letterSpacing: 1 },
  later: { gap: 8, marginBottom: sizes.edge },
});
