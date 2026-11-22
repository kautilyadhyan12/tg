import { RUN_SETS_MOST, WORKOUT_SAVE_LIMITS, type PhoneLibraryEntry, type RunExercise } from "@app/shared";
import { useRef, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Button } from "../../look/Button";
import { Badge, Card } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Page } from "../../look/Page";
import { pictures } from "../../look/pictures";
import { PictureTop } from "../../look/PictureTop";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { EMPTY, NAME_MOST, type Item } from "../../library/myWorkout";
import { exercisePicture } from "../../library/pictures";
import type { Units } from "../../library/records";
import type { LibraryFile } from "../../library/store";
import { estimate, planLine, planOf, summaryLine } from "../../library/workoutSetup";
import { clock } from "../workout/words";
import { useWorkoutLayer } from "../workout/WorkoutLayer";
import { ProgressPage } from "../progress/ProgressPage";
import { savedState, toPlanned } from "../../library/savedWorkouts";
import { ExercisePage } from "./ExercisePage";
import { SavedPart } from "./SavedPart";
import { SetUpSheet } from "./SetUpSheet";
import { useLibrary, useMyWorkout, useSetupFacts } from "./useLibrary";

/** Workout → My Workout (ROADMAP Stage 5 63c, 64a-i, as drawn): the workout's name, about how long and how many
 *  calories, and the exercises the person added from the Library, in their order, each with its sets in one line.
 *  A row opens its sets to set up; Reorder moves them; Clear asks first. Start workout does it (64a-ii), and while it
 *  goes on, Open workout opens it again. */
export function MyWorkoutPart({ parts, units, onBrowse, file }: { parts: ReactNode; units: Units; onBrowse: () => void; file?: LibraryFile }) {
  const { state } = useLibrary(file);
  const facts = useSetupFacts();
  const mine = useMyWorkout();
  const [page, setPage] = useState<string | null>(null);
  const [setUp, setSetUp] = useState<string | null>(null);
  const [reorder, setReorder] = useState(false);
  const [asking, setAsking] = useState(false);
  // Progress over My Workout: on Body for Add your weight, on Calendar for History (64a-v).
  const [progress, setProgress] = useState<"body" | "calendar" | null>(null);
  // Start workout pressed while the last workout is still being kept on the phone (round one, H3).
  const [busy, setBusy] = useState(false);
  const nameBox = useRef<TextInput>(null);
  const library = state.kind === "ready" ? state.library : null;
  const entryOf = (id: string): PhoneLibraryEntry | null => library?.exercises.find((e) => e.id === id) ?? null;
  const liveOf = (id: string): PhoneLibraryEntry | null => {
    const e = entryOf(id);
    return e !== null && e.status === "live" ? e : null;
  };
  const items = mine?.workout.items ?? [];
  const count = items.length;
  const opened = page === null ? null : entryOf(page);
  const settingUp = setUp === null ? null : liveOf(setUp);
  const settingItem = items.find((i) => i.id === setUp) ?? null;
  const settingPlan = settingItem === null ? null : planOf(settingItem, settingUp);
  const sum = estimate(items, liveOf, facts.weightKg);
  const layer = useWorkoutLayer();
  const going = layer?.run ?? null;
  const refused = layer?.waiting.refused ?? [];
  // What Start workout does: each exercise the Library still offers, with its sets as set up.
  const toDo: RunExercise[] = items.flatMap((item) => {
    const entry = liveOf(item.id);
    const plan = planOf(item, entry);
    if (entry === null || plan === null) return [];
    return [{ exercise: entry.id, name: entry.text.en.name, kind: entry.kind, measuredIn: plan.measuredIn, barbell: entry.equipment.includes("barbell"), sets: plan.sets.slice(0, RUN_SETS_MOST) }];
  });
  const setCount = toDo.reduce((n, e) => n + e.sets.length, 0);
  // As a saved workout holds it (64a-iv), and whether My Workout is one of the person's saved workouts.
  const planned = toPlanned(mine?.workout ?? EMPTY, liveOf);
  const fromSaved = savedState(mine?.workout ?? EMPTY, layer?.saved?.view.list ?? [], (id) => planOf({ id, plan: null }, entryOf(id))).linked !== null;

  const top = (
    <PictureTop
      picture="exhero"
      tall={0.62}
      eyebrow="My Workout"
      foot={
        <View style={styles.foot}>
          <View style={styles.nameRow}>
            <TextInput
              ref={nameBox}
              value={mine?.workout.name ?? ""}
              onChangeText={(t) => {
                mine?.rename(t);
              }}
              placeholder="Name this workout"
              placeholderTextColor={colours.textFaint}
              maxLength={NAME_MOST}
              accessibilityLabel="Workout name"
              returnKeyType="done"
              style={styles.name}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Rename workout"
              hitSlop={12}
              onPress={() => {
                nameBox.current?.focus();
              }}
            >
              <Icon name="pen" size={16} colour="textSoft" />
            </Pressable>
          </View>
          {count === 0 ? null : <Txt kind="body">{summaryLine(count, sum, units)}</Txt>}
          {count === 0 || sum.assumedKg === null || sum.kcal === null ? null : (
            <Button
              label="Add your weight"
              kind="link"
              small
              style={styles.start2}
              onPress={() => {
                setProgress("body");
              }}
            />
          )}
        </View>
      }
    />
  );
  return (
    <Page top={top}>
      {parts}
      {count === 0 ? (
        <Card style={styles.middle}>
          <Badge icon="dumbbell" />
          <Txt kind="h3">No exercises yet</Txt>
          <Txt kind="small">Add exercises from the Library.</Txt>
          <Button label="Browse exercises" kind="plain" small style={styles.self} onPress={onBrowse} />
        </Card>
      ) : (
        <>
          <View style={styles.tools}>
            <Button
              label={reorder ? "Done" : "Reorder"}
              kind="link"
              say={reorder ? "Done reordering" : "Reorder exercises"}
              onPress={() => {
                setReorder((r) => !r);
              }}
            />
            <Button
              label="Clear"
              kind="dangerLink"
              say="Clear this workout"
              onPress={() => {
                setAsking(true);
              }}
            />
          </View>
          <View style={styles.rows}>
            {items.map((item, i) => (
              <Row
                key={item.id}
                item={item}
                entry={entryOf(item.id)}
                units={units}
                reorder={reorder}
                first={i === 0}
                last={i === count - 1}
                onOpen={() => {
                  setSetUp(item.id);
                }}
                onRemove={() => {
                  mine?.remove(item.id);
                }}
                onMove={(by) => {
                  mine?.move(item.id, by);
                }}
              />
            ))}
          </View>
          <Button label="Add exercises" kind="link" icon="plus" style={styles.self} onPress={onBrowse} />
          {refused.length === 0 ? null : (
            <View style={styles.refused}>
              <Icon name="warn" size={18} colour="badText" />
              <Txt kind="strong" colour="badText" style={styles.grow}>
                {refused.length === 1 ? "A workout couldn't be saved." : `${String(refused.length)} workouts couldn't be saved.`}
              </Txt>
              <Button
                label="OK"
                kind="link"
                onPress={() => {
                  for (const r of refused) layer?.dismissRefused(r.workoutId);
                }}
              />
            </View>
          )}
          <View style={styles.start}>
            {going === null && busy ? (
              <Txt kind="small" colour="text" style={styles.centre}>
                Your last workout is still being kept on this phone. Try again in a moment.
              </Txt>
            ) : null}
            {going === null && setCount > RUN_SETS_LIMIT ? (
              <Txt kind="small" style={styles.centre}>
                {`One workout holds ${String(RUN_SETS_LIMIT)} sets. The first ${String(RUN_SETS_LIMIT)} are done.`}
              </Txt>
            ) : null}
            {going === null ? (
              <Button
                label="Start workout"
                wide
                raised
                disabled={layer === null || toDo.length === 0}
                onPress={() => {
                  setBusy(layer?.start(mine?.workout.name ?? "", toDo, fromSaved ? "saved" : "none") === "busy");
                }}
              />
            ) : (
              <>
                <Button label="Open workout" wide raised onPress={() => layer?.open()} />
                <Txt kind="small" style={styles.centre}>
                  {`${going.paused ? "Paused" : "In progress"} · ${clock(going.activeMs)}`}
                </Txt>
              </>
            )}
          </View>
        </>
      )}
      {/* One place on the page whatever My Workout holds, so what it last said stays when a workout is loaded. */}
      {mine === null ? null : <SavedPart mine={mine} planned={planned} entryOf={entryOf} />}
      {/* The workouts done, day by day: Progress's calendar, so nobody has to know it lives under Me (64a-v). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="History, your past workouts, day by day"
        onPress={() => {
          setProgress("calendar");
        }}
        style={({ pressed }) => (pressed ? styles.pressed : null)}
      >
        <Card style={styles.history}>
          <Badge icon="calendar" />
          <View style={styles.grow}>
            <Txt kind="strong">History</Txt>
            <Txt kind="small">Your past workouts, day by day</Txt>
          </View>
          <Icon name="go" size={18} colour="textFaint" />
        </Card>
      </Pressable>
      {settingUp === null || settingPlan === null || setUp === null ? null : (
        <SetUpSheet
          entry={settingUp}
          plan={settingPlan}
          units={units}
          onChange={(plan) => {
            mine?.plan(setUp, plan);
          }}
          onAbout={() => {
            setSetUp(null);
            setPage(setUp);
          }}
          onClose={() => {
            setSetUp(null);
          }}
        />
      )}
      <Sheet
        open={asking}
        title="Clear this workout?"
        onClose={() => {
          setAsking(false);
        }}
      >
        <Txt kind="body">{`All ${String(count)} ${count === 1 ? "exercise" : "exercises"} will be removed.`}</Txt>
        <View style={styles.two}>
          <Button
            label="Keep it"
            kind="plain"
            style={styles.half}
            onPress={() => {
              setAsking(false);
            }}
          />
          <Button
            label="Clear workout"
            kind="danger"
            icon="trash"
            style={styles.half}
            onPress={() => {
              mine?.clear();
              setReorder(false);
              setAsking(false);
            }}
          />
        </View>
      </Sheet>
      <ProgressPage
        open={progress !== null}
        first={progress ?? "body"}
        onClose={() => {
          if (progress === "body") facts.again();
          setProgress(null);
        }}
      />
      {opened === null ? null : (
        <ExercisePage
          entry={opened}
          sex={facts.sex}
          units={units}
          weightKg={facts.weightKg}
          onWeighed={facts.again}
          onOpenMine={() => {
            setPage(null);
          }}
          onClose={() => {
            setPage(null);
          }}
        />
      )}
    </Page>
  );
}

interface RowProps {
  item: Item;
  entry: PhoneLibraryEntry | null;
  units: Units;
  reorder: boolean;
  first: boolean;
  last: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
}

/** One exercise: its picture, name and sets. A press sets up its sets; one no longer in the Library says so, and can
 *  still go. Reordering, its ✕ gives way to up and down. */
function Row({ item, entry, units, reorder, first, last, onOpen, onRemove, onMove }: RowProps) {
  const name = entry?.text.en.name ?? item.id;
  const live = entry !== null && entry.status === "live";
  const plan = live ? planOf(item, entry) : null;
  const line = plan === null || entry === null ? "No longer in the Library" : planLine(plan, units, entry.set.eachSide);
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={live ? `${name}, ${line}. Set up its sets` : `${name}, ${line}`}
        disabled={!live || reorder}
        onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, pressed ? styles.pressed : null]}
      >
        <View style={styles.thumb}>
          {entry === null ? (
            <Icon name="dumbbell" size={20} colour="textFaint" />
          ) : (
            <Image source={pictures[exercisePicture(entry.id, entry.kind)]} resizeMode="contain" style={styles.thumbPicture} accessible={false} />
          )}
        </View>
        <View style={styles.grow}>
          <Txt kind="strong" numberOfLines={1}>
            {name}
          </Txt>
          <Txt kind="small" numberOfLines={2}>
            {line}
          </Txt>
        </View>
      </Pressable>
      {reorder ? (
        <>
          <Arrow name="up" say={`Move ${name} up`} disabled={first} onPress={() => { onMove(-1); }} />
          <Arrow name="down" say={`Move ${name} down`} disabled={last} onPress={() => { onMove(1); }} />
        </>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} onPress={onRemove} style={styles.icon} hitSlop={6}>
          <Icon name="x" size={18} colour="textSoft" />
        </Pressable>
      )}
    </View>
  );
}

function Arrow({ name, say, disabled, onPress }: { name: "up" | "down"; say: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.icon, disabled ? styles.faint : null]}>
      <Icon name={name} size={18} colour="textSoft" />
    </Pressable>
  );
}

/** As many sets as one workout holds; past it, Start workout does the first ones (round one, L3). */
const RUN_SETS_LIMIT = WORKOUT_SAVE_LIMITS.setsMost;

const styles = StyleSheet.create({
  grow: { flex: 1 },
  history: { flexDirection: "row", alignItems: "center", gap: 12 },
  pressed: { opacity: 0.85 },
  faint: { opacity: 0.25 },
  centre: { textAlign: "center" },
  self: { alignSelf: "center" },
  middle: { alignItems: "center", gap: 10 },
  foot: { gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, minHeight: sizes.press, padding: 0, fontFamily: fonts.bold, fontSize: 28, color: colours.text },
  tools: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rows: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingLeft: 10, paddingRight: 4, borderRadius: 16, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 52, height: 52, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colours.box },
  thumbPicture: { width: "100%", height: "100%" },
  icon: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center" },
  start: { gap: 6, marginTop: 6 },
  refused: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colours.badLine, backgroundColor: colours.badFill },
  start2: { alignSelf: "flex-start" },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
