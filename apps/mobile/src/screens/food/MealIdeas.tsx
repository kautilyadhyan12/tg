import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { mealIdeasResponseSchema, missingText, type MealIdea, type SetupScreenId } from "@app/shared";
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
import { ideaAmountWords, ideaAsMeal, ideaFoodWords, ideaMealType, ideaName } from "./ideaRules";
import { useMealOutbox } from "./MealOutbox";

export const IDEAS_READ = "/v1/nutrition/suggestions";

/** The day's ideas, and whether they can be offered. The server can't count a meal still on the phone,
 *  and a read begun before a meal landed doesn't hold it: either way the ideas drawn are old, and the
 *  same one could be logged twice, so none is offered until a read begun after. */
function useIdeas() {
  const ideas = useRead(IDEAS_READ, mealIdeasResponseSchema, useZoneSaved());
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
}

export function MealIdeas({ onMore, onAnswered }: MealIdeasProps) {
  const { read, again, outbox, view, waiting, old } = useIdeas();
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

  const log = async (idea: MealIdea) => {
    if (outbox === null || loggingNow.current) return;
    loggingNow.current = true;
    setLogging(true);
    const now = new Date();
    const type = ideaMealType(now.getHours());
    const id = newGoalId();
    const kept = await outbox.add(ideaAsMeal(idea, id, type, now));
    loggingNow.current = false;
    setLogging(false);
    setLater(false);
    setSaid(kept ? { words: `Logged to ${mealTypeName(type)}.`, meal: id } : { words: "Too many meals are waiting to send. Go online, then log this one.", meal: null });
  };

  const row = (idea: MealIdea) => (
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
  let foot = null;
  if (waiting) {
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
    if (!onDashboard) return null;
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
    const [next, ...rest] = read.data.meals;
    body = (
      <>
        {onDashboard ? (
          next.ideas[0] === undefined ? null : (
            <BestIdea
              idea={next.ideas[0]}
              held={logging || outbox === null}
              onLog={(idea) => {
                void log(idea);
              }}
              onMore={onMore}
            />
          )
        ) : (
          next.ideas.map(row)
        )}
        {onDashboard || rest.length === 0 ? null : (
          <Button
            label={rest.length === 1 ? "1 more meal today" : `${String(rest.length)} more meals today`}
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
        <Txt kind="tiny">{caution}</Txt>
        {labelCaution === null ? null : <Txt kind="tiny">{labelCaution}</Txt>}
        <Sheet
          open={later && !onDashboard}
          title="Later today"
          onClose={() => {
            setLater(false);
          }}
        >
          {rest.map((meal, at) => (
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
  return (
    <>
      {onDashboard ? (
        <Card style={styles.card} testID="recommended-box">
          <View style={styles.art}>
            <Image source={pictures.foodbowl} resizeMode="contain" style={styles.artFill} accessible={false} />
          </View>
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
            {body}
          </View>
          {foot}
        </Card>
      ) : (
        <Card style={styles.card} testID="meal-ideas-box">
          <View style={styles.titleRow}>
            <Icon name="apple" size={16} colour="orange" />
            <Txt kind="h3">What to eat next</Txt>
          </View>
          {saidLine}
          {body}
          {foot}
        </Card>
      )}
      {setupAt === null ? null : (
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
      )}
    </>
  );
}

/** The Dashboard's one idea: its numbers large, its foods as a short table, and the one thing to do. */
function BestIdea({ idea, held, onLog, onMore }: { idea: MealIdea; held: boolean; onLog: (idea: MealIdea) => void; onMore: () => void }) {
  return (
    <>
      <View>
        <Txt colour="orange" style={styles.kcal}>
          {count(idea.totals.kcal)} kcal
        </Txt>
        <Txt kind="tiny">
          {count(Math.round(idea.totals.proteinG))} g protein · {count(Math.round(idea.totals.carbsG))} g carbs
        </Txt>
      </View>
      <View style={styles.foods}>
        {idea.items.map((food) => (
          <Txt key={food.canonical} kind="tiny" colour="text">
            {food.name}{" "}
            <Txt kind="tiny" colour="textFaint">
              {ideaAmountWords(food).replace(/ /g, KEEP_TOGETHER)}
            </Txt>
          </Txt>
        ))}
      </View>
      <View style={styles.actions}>
        <Button
          label="Log meal"
          compact
          disabled={held}
          say={`Log ${ideaName(idea)}`}
          onPress={() => {
            onLog(idea);
          }}
        />
        <Button label="More ideas" kind="link" compact onPress={onMore} />
      </View>
    </>
  );
}

function IdeaRow({ idea, held, onLog }: { idea: MealIdea; held: boolean; onLog: () => void }) {
  return (
    <View style={styles.idea}>
      <View style={styles.grow}>
        {idea.items.map((food) => (
          <Txt key={food.canonical} kind="small" colour="text">
            {ideaFoodWords(food)}
          </Txt>
        ))}
        <Txt kind="tiny" style={styles.numbers}>
          {count(idea.totals.kcal)} kcal · {count(Math.round(idea.totals.proteinG))} g protein
        </Txt>
      </View>
      <Button label="Log" kind="soft" small disabled={held} say={`Log ${ideaName(idea)}`} onPress={onLog} />
    </View>
  );
}

/** A space a line never breaks at: an amount is never split from its unit. */
const KEEP_TOGETHER = "\u00A0";
const OPTION_SLOP = { top: 12, bottom: 12, left: 8, right: 8 };

const styles = StyleSheet.create({
  card: { gap: 10 },
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  boxTitle: { fontSize: 14, lineHeight: 18, color: colours.textSoft },
  // Beside the words and never under them, as on Weekly Challenges.
  art: { position: "absolute", top: 10, right: 10, bottom: 44, width: "36%" },
  artFill: { width: "100%", height: "100%" },
  leftWords: { width: "62%", gap: 10 },
  options: { flexDirection: "row", gap: 14 },
  option: { alignSelf: "flex-start", paddingBottom: 3, borderBottomWidth: 2, borderBottomColor: colours.orange },
  optionWord: { fontFamily: fonts.semibold },
  kcal: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  foods: { gap: 3 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  start: { alignSelf: "flex-start" },
  idea: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colours.line },
  numbers: { fontFamily: fonts.semibold, marginTop: 2 },
  later: { gap: 8, marginBottom: sizes.edge },
});
