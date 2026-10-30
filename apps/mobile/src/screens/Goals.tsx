import { useEffect, useRef, useState } from "react";
import { ScrollView, Image, Pressable, StyleSheet, View } from "react-native";
import {
  GOAL_KIND_RULES,
  catalogPageSchema,
  exerciseCountsReps,
  goalResponseSchema,
  goalTargetMax,
  type ExerciseCatalogItem,
  type Goal,
  type GoalKind,
  type GoalPeriod,
  type GoalsResponse,
  type PutGoalRequest,
  type SetupScreenId,
} from "@app/shared";
import { Button } from "../look/Button";
import { Badge, Card } from "../look/Card";
import { Chip } from "../look/Chip";
import { colours, sizes } from "../look/colours";
import { CoverPage } from "../look/CoverPage";
import { Field } from "../look/Field";
import { Icon } from "../look/Icon";
import { pictures } from "../look/pictures";
import { Trail } from "../look/Progress";
import { Sheet } from "../look/Sheet";
import { fonts, Txt } from "../look/Txt";
import type { Answer, Shape } from "../session/calls";
import { useSession } from "../session/SessionProvider";
import { NOT_KNOWN, count } from "./dashboard/words";
import { usePlaces } from "./places";
import { Setup } from "./setup/Setup";
import type { Read } from "./dashboard/useRead";
import {
  KIND_ICONS,
  KIND_NAMES,
  KIND_ORDER,
  PERIOD_NAMES,
  checkTarget,
  exerciseName,
  freePeriods,
  goalLine,
  goalName,
  goalProgress,
  newGoalId,
  startingTarget,
  summaryWords,
  targetLabel,
  type Progress,
} from "./goals/words";

// Your Goals (ROADMAP Stage 5 item 31b): the goals the server keeps for the person (30a, 30b), on the
// Dashboard and on a page of their own, with change, remove and add. The server measures every goal
// and holds what the health rules hold; the phone only sends what the person picked.

export const GOALS_READ = "/v1/goals";
/** The exercise library, a page at a time; a "reps in one set" goal names one that counts reps. */
export const EXERCISES_READ = "/v1/exercises?limit=100";
/** The most pages read: the library holds 58 today, so this is far past any real size. */
const MOST_EXERCISE_PAGES = 20;

const goalPath = (id: string) => `/v1/goals/${id}`;
const NO_CONNECTION = "No connection. Try again.";

/** DELETE answers 204 with no body. */
const nothing: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

function failureWords(answer: Answer<unknown>): string {
  return answer.kind === "refused" ? answer.message : NO_CONNECTION;
}

/** What the Dashboard opens: the list, or the list with Add a goal open over it. */
export type GoalsOpen = "list" | "add";

/** The Dashboard's box: how many are reached, and the first three goals. */
export function GoalsBox({ read, onOpen }: { read: Read<GoalsResponse>; onOpen: (on: GoalsOpen) => void }) {
  const goals = read.kind === "ok" ? read.data.goals : null;
  const summary = goals === null ? null : summaryWords(goals);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={summary === null ? "Your Goals, View all" : `Your Goals, ${summary}, View all`}
      onPress={() => {
        onOpen("list");
      }}
      style={styles.box}
    >
      <View style={styles.boxArt}>
        <Image source={pictures.goalsbox} resizeMode="contain" style={styles.fill} accessible={false} />
      </View>
      <View style={styles.inner}>
        <View style={styles.between}>
          <View style={styles.titleRow}>
            <Icon name="target" size={16} colour="orange" />
            <Txt kind="h3" style={styles.boxTitle}>
              Your Goals
            </Txt>
          </View>
          <Txt kind="tiny" colour="orange" style={styles.semibold}>
            View all
          </Txt>
        </View>
        {goals === null ? (
          <Txt kind="small">{NOT_KNOWN}</Txt>
        ) : goals.length === 0 ? (
          <>
            <Txt kind="small">No goals yet.</Txt>
            <Button label="Add a goal" icon="plus" compact onPress={() => { onOpen("add"); }} />
          </>
        ) : (
          <>
            {summary === null ? null : <Txt kind="big">{summary}</Txt>}
            {goals.slice(0, 3).map((goal) => (
              <BoxRow key={goal.id} goal={goal} />
            ))}
          </>
        )}
      </View>
    </Pressable>
  );
}

function BoxRow({ goal }: { goal: Goal }) {
  const { state } = useSession();
  const units = state.kind === "in" ? state.user.units : "metric";
  const progress = goalProgress(goal, units);
  return (
    <View style={styles.boxRow}>
      <View style={styles.between}>
        <Txt kind="tiny" colour="textSoft" numberOfLines={1} style={styles.grow}>
          {goalLine(goal, units)}
        </Txt>
        {progress.kind === "done" ? <Icon name="check" size={14} colour="goodText" /> : null}
      </View>
      {progress.kind === "going" && progress.share !== null ? <Trail share={progress.share} /> : null}
    </View>
  );
}

interface GoalsPageProps {
  open: GoalsOpen | null;
  onClose: () => void;
  read: Read<GoalsResponse>;
  again: () => void;
}

/** Every goal the person keeps, each opened to change or remove it; Add a goal held at the bottom. */
export function GoalsPage({ open, onClose, read, again }: GoalsPageProps) {
  const { state } = useSession();
  const units = state.kind === "in" ? state.user.units : "metric";
  const [picked, setPicked] = useState<Goal | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Setup over the page, on the answer a goal waits for; "where" is wherever the person left off.
  const [setupAt, setSetupAt] = useState<SetupScreenId | "where" | null>(null);
  const goals = read.kind === "ok" ? read.data.goals : null;
  const max = read.kind === "ok" ? read.data.max : null;
  const full = goals !== null && max !== null && goals.length >= max;

  useEffect(() => {
    setNotice(null);
    setAdding(open === "add");
  }, [open]);

  const toSetup = (at: SetupScreenId | "where") => {
    setPicked(null);
    setAdding(false);
    setNotice(null);
    setSetupAt(at);
  };

  const done = (words: string) => {
    setPicked(null);
    setAdding(false);
    setNotice(words);
    again();
  };

  return (
    <CoverPage
      open={open !== null}
      title="Your Goals"
      picture="goals"
      onClose={onClose}
      foot={
        <>
          {full ? (
            <Txt kind="tiny" style={styles.centre}>
              You can keep up to {count(max)} goals.
            </Txt>
          ) : null}
          <Button
            label="Add a goal"
            icon="plus"
            wide
            disabled={goals === null || full}
            onPress={() => {
              setNotice(null);
              setAdding(true);
            }}
          />
        </>
      }
    >
      {notice === null ? null : (
        <View style={styles.notice}>
          <Icon name="check" size={16} colour="goodText" />
          <Txt kind="small" colour="goodText">
            {notice}
          </Txt>
        </View>
      )}
      {goals === null ? (
        read.kind === "failed" ? (
          <Card style={styles.row}>
            <Icon name="wifioff" size={18} colour="textSoft" />
            <Txt kind="small" style={styles.grow}>
              Your goals couldn’t load.
            </Txt>
            <Button label="Try again" kind="link" onPress={again} />
          </Card>
        ) : (
          <Txt kind="small">{NOT_KNOWN}</Txt>
        )
      ) : goals.length === 0 ? (
        <Txt kind="small">No goals yet.</Txt>
      ) : (
        <View style={styles.list}>
          {summaryWords(goals) === null ? null : <Txt kind="small">{summaryWords(goals)}</Txt>}
          {goals.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              units={units}
              onPress={() => {
                setNotice(null);
                setPicked(goal);
              }}
              onSetup={toSetup}
            />
          ))}
        </View>
      )}
      <GoalSheet
        goal={picked}
        goals={goals ?? []}
        units={units}
        onClose={() => {
          setPicked(null);
        }}
        onDone={done}
        onSetup={toSetup}
      />
      {goals === null ? null : (
        <AddSheet
          open={adding}
          goals={goals}
          onClose={() => {
            setAdding(false);
          }}
          onDone={done}
          onSetup={toSetup}
        />
      )}
      <Setup
        open={setupAt !== null}
        at={setupAt === "where" ? null : setupAt}
        onClose={() => {
          setSetupAt(null);
          again();
        }}
      />
    </CoverPage>
  );
}

function progressColour(progress: Progress) {
  if (progress.kind === "done") return "goodText" as const;
  if (progress.kind === "held" || progress.kind === "needs") return "gold" as const;
  return "orange" as const;
}

type ToSetup = (at: SetupScreenId | "where") => void;

/** The button that opens the answer a goal waits for: the target weight, or setup where it was left. */
function SetupLink({ needs, onSetup }: { needs: NonNullable<Goal["needs"]>; onSetup: ToSetup }) {
  return needs === "target_weight" ? (
    <Button label="Set target" kind="link" onPress={() => { onSetup("target"); }} />
  ) : (
    <Button label="Finish setup" kind="link" onPress={() => { onSetup("where"); }} />
  );
}

function GoalRow({ goal, units, onPress, onSetup }: { goal: Goal; units: string; onPress: () => void; onSetup: ToSetup }) {
  const progress = goalProgress(goal, units);
  const line = goalLine(goal, units);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${line}, ${progress.words}`}
      onPress={onPress}
      style={({ pressed }) => [styles.goal, pressed ? styles.pressed : null]}
    >
      <Badge icon={KIND_ICONS[goal.kind]} tone={progress.kind === "held" || progress.kind === "needs" ? "gold" : "orange"} />
      <View style={[styles.grow, styles.tight]}>
        <Txt kind="body" colour="text" style={styles.semibold} numberOfLines={2}>
          {line}
        </Txt>
        <View style={styles.titleRow}>
          {progress.kind === "done" ? <Icon name="check" size={14} colour="goodText" /> : null}
          <Txt kind="tiny" colour={progressColour(progress)} style={styles.grow}>
            {progress.words}
          </Txt>
        </View>
        {progress.kind === "going" && progress.share !== null ? <Trail share={progress.share} /> : null}
        {goal.needs === null || goal.held !== null ? null : <SetupLink needs={goal.needs} onSetup={onSetup} />}
      </View>
      <Icon name="go" size={16} colour="textFaint" />
    </Pressable>
  );
}

/** The period chips and the number box, shared by change and add. */
function Editor(props: {
  kind: GoalKind;
  periods: readonly (GoalPeriod | null)[];
  period: GoalPeriod | null;
  onPeriod: (period: GoalPeriod) => void;
  typed: string;
  onTyped: (typed: string) => void;
  onSetup: ToSetup;
}) {
  const choices = props.periods.filter((p): p is GoalPeriod => p !== null);
  const max = goalTargetMax(props.kind, props.period);
  return (
    <>
      {choices.length > 1 ? (
        <View style={styles.chips} accessibilityRole="radiogroup">
          {choices.map((p) => (
            <Chip key={p} label={PERIOD_NAMES[p]} on={props.period === p} onPress={() => { props.onPeriod(p); }} />
          ))}
        </View>
      ) : null}
      {max === null ? (
        // Its number is setup's own, so the way to change it is setup, opened on that answer.
        <View style={styles.between}>
          <Txt kind="small" style={styles.grow}>
            {props.kind === "weight" ? "Your target weight in Your plan sets this goal." : "Your plan sets this number."}
          </Txt>
          {props.kind === "weight" ? (
            <Button label="Change target" kind="link" onPress={() => { props.onSetup("target"); }} />
          ) : (
            <Button label="See your plan" kind="link" onPress={() => { props.onSetup("where"); }} />
          )}
        </View>
      ) : (
        <Field label={targetLabel(props.kind, props.period)} value={props.typed} onChange={props.onTyped} keyboard="number-pad" maxLength={6} />
      )}
    </>
  );
}


/** One goal: change its period or number, or remove it, which asks first. */
function GoalSheet(props: {
  goal: Goal | null;
  goals: readonly Goal[];
  units: string;
  onClose: () => void;
  onDone: (words: string) => void;
  onSetup: ToSetup;
}) {
  const { goal, goals, units, onClose, onDone, onSetup } = props;
  const { session } = useSession();
  const [period, setPeriod] = useState<GoalPeriod | null>(null);
  const [typed, setTyped] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (goal === null) return;
    setPeriod(goal.period);
    setTyped(goal.target === null || goalTargetMax(goal.kind, goal.period) === null ? "" : String(goal.target));
    setAsking(false);
    setBusy(false);
    setError(null);
  }, [goal]);

  if (goal === null) return <Sheet open={false} title="" onClose={onClose}>{null}</Sheet>;
  const rule = GOAL_KIND_RULES[goal.kind];
  // A held goal has nothing to change; one whose number the plan sets says so and has no Save.
  const shown = goal.held === null;
  const changeable = shown && (rule.periods.length > 1 || rule.targetMax !== null);

  const save = async () => {
    const target = goalTargetMax(goal.kind, period) === null ? null : checkTarget(typed, goal.kind, period);
    if (target !== null && !target.ok) {
      setError(target.words);
      return;
    }
    const body: PutGoalRequest = { kind: goal.kind, period, target: target === null ? null : target.target, exerciseId: goal.exerciseId };
    setBusy(true);
    setError(null);
    const answer = await session.signedIn({ method: "PUT", path: goalPath(goal.id), body }, goalResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") onDone("Goal saved.");
    else setError(failureWords(answer));
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    const answer = await session.signedIn({ method: "DELETE", path: goalPath(goal.id) }, nothing);
    setBusy(false);
    // 404: already gone, from a removal whose reply was lost.
    if (answer.kind === "ok" || (answer.kind === "refused" && answer.status === 404)) onDone("Goal removed.");
    else setError(failureWords(answer));
  };

  return (
    <Sheet open title={asking ? "Remove this goal?" : goalName(goal)} onClose={onClose}>
      {asking ? (
        <>
          <Txt kind="small">{goalLine(goal, units)}</Txt>
          {error === null ? null : <Txt kind="small" colour="badText">{error}</Txt>}
          <View style={styles.actions}>
            <Button label="Remove" kind="danger" busy={busy} onPress={() => void remove()} />
            <Button label="Cancel" kind="quiet" onPress={() => { setAsking(false); }} />
          </View>
        </>
      ) : (
        <>
          <Txt kind="small">{goalProgress(goal, units).words}</Txt>
          {shown ? (
            <Editor
              kind={goal.kind}
              // Its own period and those the person has no goal of yet: another kept one would be refused.
              periods={rule.periods.filter((p) => p === goal.period || freePeriods(goal.kind, goals).includes(p))}
              period={period}
              onPeriod={(p) => {
                setPeriod(p);
                setTyped(String(startingTarget(goal.kind, p) ?? ""));
                setError(null);
              }}
              typed={typed}
              onTyped={(t) => {
                setTyped(t);
                setError(null);
              }}
              onSetup={onSetup}
            />
          ) : null}
          {error === null ? null : <Txt kind="small" colour="badText">{error}</Txt>}
          <View style={styles.actions}>
            {changeable ? <Button label="Save" busy={busy} onPress={() => void save()} /> : null}
            <Button label="Remove goal" kind="link" icon="trash" onPress={() => { setAsking(true); }} />
          </View>
        </>
      )}
    </Sheet>
  );
}

/** Add a goal: what to track, then how often and the number, and the exercise for reps in one set. */
function AddSheet(props: { open: boolean; goals: readonly Goal[]; onClose: () => void; onDone: (words: string) => void; onSetup: ToSetup }) {
  const { open, goals, onClose, onDone, onSetup } = props;
  const { session, state } = useSession();
  // Check-ins are a gym's front-desk scans: offered only to a member of a place, never as a goal stuck at 0.
  const { kinds: places } = usePlaces();
  const member = places !== null && places.length > 0;
  const me = state.kind === "in" ? state.user.id : null;
  const [kind, setKind] = useState<GoalKind | null>(null);
  const [period, setPeriod] = useState<GoalPeriod | null>(null);
  const [typed, setTyped] = useState("");
  const [exercise, setExercise] = useState<ExerciseCatalogItem | null>(null);
  const [search, setSearch] = useState("");
  const [exercises, setExercises] = useState<ExerciseCatalogItem[] | "loading" | "failed">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Made once for each goal being added, so Add pressed twice, or sent again, is one goal.
  const id = useRef(newGoalId());

  useEffect(() => {
    if (!open) return;
    setKind(null);
    setError(null);
    setBusy(false);
  }, [open]);

  /** Every page of the library, then only what counts reps: never a hold, whose goal would sit at 0. */
  const loadExercises = async () => {
    setExercises("loading");
    const all: ExerciseCatalogItem[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MOST_EXERCISE_PAGES; page += 1) {
      const path: string = cursor === null ? EXERCISES_READ : `${EXERCISES_READ}&cursor=${encodeURIComponent(cursor)}`;
      const answer = await session.signedIn({ method: "GET", path }, catalogPageSchema);
      const now = session.state();
      if (now.kind !== "in" || now.user.id !== me) return;
      if (answer.kind !== "ok") {
        setExercises("failed");
        return;
      }
      all.push(...answer.data.items);
      cursor = answer.data.nextCursor;
      if (cursor === null) break;
    }
    setExercises(all.filter((e) => e.tracking === "pose" && exerciseCountsReps(e)));
  };

  const pick = (k: GoalKind) => {
    const free = freePeriods(k, goals);
    const first = free.includes("week") ? "week" : (free[0] ?? null);
    id.current = newGoalId();
    setKind(k);
    setPeriod(first);
    setTyped(String(startingTarget(k, first) ?? ""));
    setExercise(null);
    setSearch("");
    setError(null);
    if (k === "reps_in_set") void loadExercises();
  };

  const add = async () => {
    if (kind === null) return;
    if (kind === "reps_in_set" && exercise === null) {
      setError("Pick an exercise.");
      return;
    }
    const target = goalTargetMax(kind, period) === null ? null : checkTarget(typed, kind, period);
    if (target !== null && !target.ok) {
      setError(target.words);
      return;
    }
    const body: PutGoalRequest = {
      kind,
      period,
      target: target === null ? null : target.target,
      exerciseId: kind === "reps_in_set" && exercise !== null ? exercise.id : null,
    };
    setBusy(true);
    setError(null);
    const answer = await session.signedIn({ method: "PUT", path: goalPath(id.current), body }, goalResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") onDone("Goal added.");
    else setError(failureWords(answer));
  };

  const kinds = KIND_ORDER.filter((k) => freePeriods(k, goals).length > 0 && (k !== "gym_visits" || member));
  // One reps goal an exercise: those already kept are not offered again.
  const taken = kind === "reps_in_set" ? goals.filter((g) => g.kind === "reps_in_set").map((g) => g.exerciseId) : [];
  const matches =
    typeof exercises === "string"
      ? []
      : exercises
          .filter((e) => !taken.includes(e.id))
          .filter((e) => exerciseName(e.slug).toLowerCase().includes(search.trim().toLowerCase()))
          .slice(0, 5);

  return (
    <Sheet open={open} title={kind === null ? "Add a goal" : KIND_NAMES[kind]} onClose={onClose}>
      <ScrollView style={styles.boxList} contentContainerStyle={styles.boxListInner} keyboardShouldPersistTaps="handled">
      {kind === null ? (
        <View style={styles.kinds}>
          {kinds.map((k) => (
            <Chip key={k} label={KIND_NAMES[k]} icon={KIND_ICONS[k]} on={false} onPress={() => { pick(k); }} />
          ))}
        </View>
      ) : (
        <>
          {kind === "reps_in_set" ? (
            exercise !== null ? (
              <View style={styles.between}>
                <Txt kind="body" style={styles.semibold}>
                  {exerciseName(exercise.slug)}
                </Txt>
                <Button label="Change" kind="link" onPress={() => { setExercise(null); }} />
              </View>
            ) : (
              <>
                <Field label="Exercise" bare placeholder="Search exercises" value={search} onChange={setSearch} />
                {exercises === "loading" ? <Txt kind="small">{NOT_KNOWN}</Txt> : null}
                {exercises === "failed" ? (
                  <View style={styles.between}>
                    <Txt kind="small" style={styles.grow}>
                      Exercises couldn’t load.
                    </Txt>
                    <Button label="Try again" kind="link" onPress={() => void loadExercises()} />
                  </View>
                ) : null}
                {matches.map((e) => (
                  <Pressable
                    key={e.id}
                    accessibilityRole="button"
                    accessibilityLabel={exerciseName(e.slug)}
                    onPress={() => {
                      setExercise(e);
                      setError(null);
                    }}
                    style={styles.pickRow}
                  >
                    <Txt kind="body">{exerciseName(e.slug)}</Txt>
                  </Pressable>
                ))}
              </>
            )
          ) : null}
          <Editor
            kind={kind}
            periods={freePeriods(kind, goals)}
            period={period}
            onPeriod={(p) => {
              setPeriod(p);
              setTyped(String(startingTarget(kind, p) ?? ""));
              setError(null);
            }}
            typed={typed}
            onTyped={(t) => {
              setTyped(t);
              setError(null);
            }}
            onSetup={onSetup}
          />
          {error === null ? null : <Txt kind="small" colour="badText">{error}</Txt>}
          <View style={styles.actions}>
            <Button label="Add goal" busy={busy} onPress={() => void add()} />
            <Button label="Back" kind="quiet" onPress={() => { setKind(null); }} />
          </View>
        </>
      )}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  boxList: { flexGrow: 0, flexShrink: 1 },
  boxListInner: { gap: 14 },
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  tight: { gap: 6 },
  inner: { padding: 14, gap: 10 },
  semibold: { fontFamily: fonts.semibold },
  centre: { textAlign: "center" },
  boxTitle: { fontSize: 14, lineHeight: 18, color: colours.textSoft },
  box: {
    minHeight: 150,
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: sizes.boxRadius,
    overflow: "hidden",
  },
  // Under the title row, so View all is never over the drawing.
  // Its left edge clear of the rows (56 %), so a long goal never runs onto it on a small phone.
  boxArt: { position: "absolute", top: 34, bottom: -4, right: -8, width: "50%" },
  fill: { position: "absolute", width: "100%", height: "100%" },
  boxRow: { gap: 5, maxWidth: "56%" },
  notice: { flexDirection: "row", alignItems: "center", gap: 8 },
  list: { gap: 10 },
  goal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: sizes.boxRadius,
  },
  pressed: { opacity: 0.85 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actions: { flexDirection: "row", alignItems: "center", gap: 16 },
  pickRow: { minHeight: sizes.press, justifyContent: "center", borderTopWidth: 1, borderTopColor: colours.line },
});
