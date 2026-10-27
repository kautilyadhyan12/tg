import { useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import {
  GOAL_KIND_RULES,
  catalogPageSchema,
  goalResponseSchema,
  goalTargetMax,
  type ExerciseCatalogItem,
  type Goal,
  type GoalKind,
  type GoalPeriod,
  type GoalsResponse,
  type PutGoalRequest,
} from "@app/shared";
import { Button } from "../look/Button";
import { Badge, Card } from "../look/Card";
import { Chip } from "../look/Chip";
import { boxShade, colours, orangeGradient, sizes } from "../look/colours";
import { CoverPage } from "../look/CoverPage";
import { Field } from "../look/Field";
import { Icon } from "../look/Icon";
import { pictures } from "../look/pictures";
import { Sheet } from "../look/Sheet";
import { fonts, Txt } from "../look/Txt";
import type { Answer, Shape } from "../session/calls";
import { useSession } from "../session/SessionProvider";
import { NOT_KNOWN, count } from "./dashboard/words";
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
  goalProgress,
  newGoalId,
  startingTarget,
  summaryWords,
  type Progress,
} from "./goals/words";

// Your Goals (ROADMAP Stage 5 item 31b): the goals the server keeps for the person (30a, 30b), on the
// Dashboard and on a page of their own, with change, remove and add. The server measures every goal
// and holds what the health rules hold; the phone only sends what the person picked.

export const GOALS_READ = "/v1/goals";
/** The exercises a "reps in one set" goal can name: those the camera counts in reps. */
export const EXERCISES_READ = "/v1/exercises?limit=100";

const goalPath = (id: string) => `/v1/goals/${id}`;
const NO_CONNECTION = "No connection. Try again.";

/** DELETE answers 204 with no body. */
const nothing: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

function failureWords(answer: Answer<unknown>): string {
  return answer.kind === "refused" ? answer.message : NO_CONNECTION;
}

/** The Dashboard's box: how many are reached, and the first three goals. */
export function GoalsBox({ read, onOpen }: { read: Read<GoalsResponse>; onOpen: () => void }) {
  const goals = read.kind === "ok" ? read.data.goals : null;
  const summary = goals === null ? null : summaryWords(goals);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Your Goals, View all" onPress={onOpen} style={styles.box}>
      <Image source={pictures.goalsbox} resizeMode="contain" style={styles.boxArt} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.boxShade]} />
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
          <Txt kind="small">No goals yet.</Txt>
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
      {progress.kind === "going" && progress.share !== null ? <Bar share={progress.share} /> : null}
    </View>
  );
}

function Bar({ share }: { share: number }) {
  const filled = Math.round(Math.max(0, Math.min(share, 1)) * 100);
  return (
    <View style={styles.bar}>
      {/* An empty bar draws no fill: no gradient on a view with no width. */}
      {filled > 0 ? <View style={[styles.barFill, { flex: filled }]} /> : null}
      <View style={{ flex: 100 - filled }} />
    </View>
  );
}

interface GoalsPageProps {
  open: boolean;
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
  const goals = read.kind === "ok" ? read.data.goals : null;
  const max = read.kind === "ok" ? read.data.max : null;
  const full = goals !== null && max !== null && goals.length >= max;

  useEffect(() => {
    if (!open) setNotice(null);
  }, [open]);

  const done = (words: string) => {
    setPicked(null);
    setAdding(false);
    setNotice(words);
    again();
  };

  return (
    <CoverPage
      open={open}
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
            />
          ))}
        </View>
      )}
      <GoalSheet goal={picked} units={units} onClose={() => { setPicked(null); }} onDone={done} />
      {goals === null ? null : <AddSheet open={adding} goals={goals} onClose={() => { setAdding(false); }} onDone={done} />}
    </CoverPage>
  );
}

function progressColour(progress: Progress) {
  if (progress.kind === "done") return "goodText" as const;
  if (progress.kind === "held" || progress.kind === "needs") return "gold" as const;
  return "orange" as const;
}

function GoalRow({ goal, units, onPress }: { goal: Goal; units: string; onPress: () => void }) {
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
        <Txt kind="body" style={styles.semibold} numberOfLines={2}>
          {line}
        </Txt>
        <View style={styles.titleRow}>
          {progress.kind === "done" ? <Icon name="check" size={14} colour="goodText" /> : null}
          <Txt kind="tiny" colour={progressColour(progress)} style={styles.grow}>
            {progress.words}
          </Txt>
        </View>
        {progress.kind === "going" && progress.share !== null ? <Bar share={progress.share} /> : null}
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
        <Txt kind="small">{props.kind === "weight" ? "Your target weight sets this goal." : "Your plan sets this number."}</Txt>
      ) : (
        <Field label={`Target, ${unitLabel(props.kind)}`} value={props.typed} onChange={props.onTyped} keyboard="number-pad" maxLength={6} />
      )}
    </>
  );
}

const unitLabel = (kind: GoalKind): string => GOAL_KIND_RULES[kind].unit;

/** One goal: change its period or number, or remove it, which asks first. */
function GoalSheet({ goal, units, onClose, onDone }: { goal: Goal | null; units: string; onClose: () => void; onDone: (words: string) => void }) {
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
    <Sheet open title={asking ? "Remove this goal?" : KIND_NAMES[goal.kind]} onClose={onClose}>
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
              periods={rule.periods}
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
function AddSheet({ open, goals, onClose, onDone }: { open: boolean; goals: readonly Goal[]; onClose: () => void; onDone: (words: string) => void }) {
  const { session, state } = useSession();
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

  const loadExercises = async () => {
    setExercises("loading");
    const answer = await session.signedIn({ method: "GET", path: EXERCISES_READ }, catalogPageSchema);
    const now = session.state();
    if (now.kind !== "in" || now.user.id !== me) return;
    setExercises(answer.kind === "ok" ? answer.data.items.filter((e) => e.tracking === "pose") : "failed");
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

  const kinds = KIND_ORDER.filter((k) => freePeriods(k, goals).length > 0);
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
          />
          {error === null ? null : <Txt kind="small" colour="badText">{error}</Txt>}
          <View style={styles.actions}>
            <Button label="Add goal" busy={busy} onPress={() => void add()} />
            <Button label="Back" kind="quiet" onPress={() => { setKind(null); }} />
          </View>
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
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
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: sizes.boxRadius,
    overflow: "hidden",
  },
  boxArt: { position: "absolute", top: 0, right: -6, width: "52%", height: "100%" },
  boxShade: { experimental_backgroundImage: boxShade },
  boxRow: { gap: 5, maxWidth: "72%" },
  bar: { flexDirection: "row", height: 6, borderRadius: sizes.round, backgroundColor: colours.track, overflow: "hidden" },
  barFill: { borderRadius: sizes.round, backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
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
