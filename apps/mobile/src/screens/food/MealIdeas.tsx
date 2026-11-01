import { useEffect, useRef, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { mealIdeasResponseSchema, missingText, type MealIdea, type SetupScreenId } from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import { boxShade, colours, sizes } from "../../look/colours";
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
import { ideaAsMeal, ideaFoodWords, ideaMealType, ideaName } from "./ideaRules";
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
  const [said, setSaid] = useState<string | null>(null);
  const [later, setLater] = useState(false);
  const [setupAt, setSetupAt] = useState<SetupScreenId | "where" | null>(null);
  const [logging, setLogging] = useState(false);
  const loggingNow = useRef(false);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) setSaid(null);
  }, [focused]);

  const log = async (idea: MealIdea) => {
    if (outbox === null || loggingNow.current) return;
    loggingNow.current = true;
    setLogging(true);
    const now = new Date();
    const type = ideaMealType(now.getHours());
    const kept = await outbox.add(ideaAsMeal(idea, newGoalId(), type, now));
    loggingNow.current = false;
    setLogging(false);
    setLater(false);
    setSaid(kept ? `Logged to ${mealTypeName(type)}.` : "Too many meals are waiting to send. Go online, then log this one.");
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
          Waiting to send your meal.
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
        {(onDashboard ? read.data.meals[0].ideas.slice(0, 1) : (next?.ideas ?? [])).map(row)}
        {onDashboard ? (
          <Button label="More ideas" kind="link" style={styles.start} onPress={onMore} />
        ) : rest.length === 0 ? null : (
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
              <Txt kind="strong">About {count(meal.kcalTarget)} kcal</Txt>
              {meal.ideas.map(row)}
            </View>
          ))}
          <Txt kind="tiny">{caution}</Txt>
          {labelCaution === null ? null : <Txt kind="tiny">{labelCaution}</Txt>}
        </Sheet>
      </>
    );
  }

  return (
    <>
      <Card style={styles.card} testID={onDashboard ? "recommended-box" : "meal-ideas-box"}>
        {onDashboard ? (
          <>
            <Image source={pictures.recommended} resizeMode="cover" style={styles.picture} accessible={false} />
            <View style={[StyleSheet.absoluteFill, styles.shade]} />
          </>
        ) : null}
        <View style={styles.titleRow}>
          <Icon name={onDashboard ? "target" : "apple"} size={16} colour="orange" />
          <Txt kind="h3">{onDashboard ? "Recommended For You" : "What to eat next"}</Txt>
        </View>
        {/* The Exercise and Running options join with their own plans (ROADMAP 36, 37). */}
        {onDashboard ? (
          <View style={styles.options}>
            <Chip label="Food" on onPress={() => undefined} />
          </View>
        ) : null}
        {onDashboard
          ? view.refused.map((r) => (
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
            ))
          : null}
        {said === null ? null : (
          <Txt kind="small" colour="orange">
            {said}
          </Txt>
        )}
        {body}
        {foot}
      </Card>
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

const styles = StyleSheet.create({
  card: { gap: 10 },
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  options: { flexDirection: "row", gap: 8 },
  start: { alignSelf: "flex-start" },
  idea: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: colours.line },
  numbers: { fontFamily: fonts.semibold, marginTop: 2 },
  later: { gap: 8, marginBottom: sizes.edge },
  picture: { position: "absolute", top: 0, left: 0, width: "120%", height: "100%", opacity: 0.6 },
  shade: { experimental_backgroundImage: boxShade },
});
