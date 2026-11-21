import type { RefusedWorkout, WorkoutRun, WorkoutSave } from "@app/shared";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { Button } from "../../look/Button";
import { colours, raisedOrangeGradient, shadows, sizes, type ColourName } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { PictureTop } from "../../look/PictureTop";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { exercisePicture } from "../../library/pictures";
import { weightParts, type Units } from "../../library/records";
import { leftOf, setOf, setsInAll, type Press } from "../../library/workoutRun";
import type { Finished } from "../../library/workoutRunStore";
import type { WaitingView } from "../../session/waitingList";
import { Led } from "../library/Records";
import { PlateFace } from "../library/WeightPlate";
import { clock, countdown, eyebrowWords, mainWords, nextWords, ringShare, setLine } from "./words";

// The workout's own screen (ROADMAP Stage 5 64a-ii, Kd's drawing of 2026-11-21): one screen for the whole workout. The
// exercise's picture with where the workout is; the gym's LED wall timer with the reps counted (+ for each, the set
// ending by itself at its target), or the timer of a set measured in time, or the rest's ring; the set's target and
// weight changed right there; Next up; the one main button saying what it keeps; Reset set and Skip exercise. Pause
// stops every clock; End asks first and keeps the sets done. Its last screen says the workout is saved, or where it is.

interface Props {
  run: WorkoutRun | null;
  finished: Finished | null;
  waiting: WaitingView<WorkoutSave, RefusedWorkout>;
  units: Units;
  press: (p: Press) => void;
  onPutAway: () => void;
  onDiscard: () => void;
  onFinished: () => void;
}

export function WorkoutScreen({ run, finished, waiting, units, press, onPutAway, onDiscard, onFinished }: Props) {
  if (run === null) return finished === null ? null : <Done finished={finished} waiting={waiting} onDone={onFinished} />;
  return <Doing run={run} units={units} press={press} onPutAway={onPutAway} onDiscard={onDiscard} />;
}

const LED_RED: ColourName = "ledRed";
const LED_AMBER: ColourName = "ledAmber";
const LED_GREEN: ColourName = "ledGreen";

function Doing({ run, units, press, onPutAway, onDiscard }: { run: WorkoutRun; units: Units; press: (p: Press) => void; onPutAway: () => void; onDiscard: () => void }) {
  const insets = useSafeAreaInsets();
  const [asking, setAsking] = useState(false);
  const { exercise, target, weightGrams } = setOf(run);
  const timed = exercise.measuredIn === "time";
  const inSet = run.phase === "set";
  const share = ringShare(run);
  const name = run.name.trim() === "" ? "Workout" : run.name.trim();
  const last = run.done[run.done.length - 1];
  const done = run.done.length;
  const top = (
    <View style={styles.topBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Put workout away" onPress={onPutAway} style={styles.topRound} hitSlop={4}>
        <Icon name="down" size={22} colour="text" />
      </Pressable>
      <View style={styles.topMiddle}>
        <Txt kind="strong" numberOfLines={1} style={styles.centre}>
          {name}
        </Txt>
        <Txt kind="small" colour="text" style={[styles.centre, styles.digits]}>
          {clock(run.totalMs)}
        </Txt>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={run.paused ? "Resume workout" : "Pause workout"}
        onPress={() => {
          press({ kind: run.paused ? "resume" : "pause" });
        }}
        style={styles.topRound}
        hitSlop={4}
      >
        <Icon name={run.paused ? "play" : "pause"} size={20} colour="text" filled />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End workout"
        onPress={() => {
          setAsking(true);
        }}
        style={styles.topEnd}
      >
        <Txt kind="strong" colour="badText">
          End
        </Txt>
      </Pressable>
    </View>
  );
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <PictureTop
          picture={exercisePicture(exercise.exercise, exercise.kind)}
          tall={0.62}
          above={top}
          eyebrow={eyebrowWords(run)}
          title={exercise.name}
          {...(run.phase === "rest" ? { foot: <Txt kind="body" colour="text">{setLine(run, units)}</Txt> } : {})}
        />
        <View style={styles.body}>
          <View style={styles.wall}>
            {inSet && !timed ? (
              <>
                <View style={styles.countRow}>
                  <Round mark="−" say="One rep less" disabled={run.count === 0 || run.paused} onPress={() => { press({ kind: "count", by: -1 }); }} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${String(run.count)} of ${String(target)} reps. Count one more`}
                    disabled={run.paused}
                    onPress={() => {
                      press({ kind: "count", by: 1 });
                    }}
                    style={styles.countPad}
                  >
                    <Label>Reps</Label>
                    <View style={styles.countDigits}>
                      <Led text={String(run.count).padStart(2, "0")} colour={LED_RED} height={64} />
                      <Txt kind="big" colour="timerWords" style={styles.ofTarget}>{`/ ${String(target)}`}</Txt>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="One rep more"
                    disabled={run.paused}
                    onPress={() => {
                      press({ kind: "count", by: 1 });
                    }}
                    style={({ pressed }) => [styles.plusBig, pressed ? styles.pressed : null]}
                  >
                    <Txt kind="hero" colour="onOrange" style={styles.plusMark}>
                      +
                    </Txt>
                  </Pressable>
                </View>
                <Row label="Target" less="Lower the target" more="Raise the target" onPress={(by) => { press({ kind: "target", by }); }} disabled={run.paused}>
                  <Led text={String(target)} colour={LED_AMBER} height={30} />
                  <Txt kind="small" colour="timerWords">reps</Txt>
                </Row>
              </>
            ) : (
              <>
                <View style={styles.ringRow}>
                  {run.phase === "rest" ? <Round mark="−15" say="15 seconds less rest" disabled={run.paused} onPress={() => { press({ kind: "rest", by: -1 }); }} /> : null}
                  <TimerRing share={share ?? 0} colour={run.phase === "rest" ? LED_GREEN : run.phase === "ready" ? LED_AMBER : LED_RED}>
                    <Label>{run.phase === "rest" ? "Rest" : run.phase === "ready" ? "Get ready" : "Time left"}</Label>
                    <Led text={countdown(leftOf(run)?.leftMs ?? 0)} colour={run.phase === "rest" ? LED_GREEN : run.phase === "ready" ? LED_AMBER : LED_RED} height={40} />
                  </TimerRing>
                  {run.phase === "rest" ? <Round mark="+15" say="15 seconds more rest" disabled={run.paused} onPress={() => { press({ kind: "rest", by: 1 }); }} /> : null}
                </View>
                {inSet ? (
                  <Row label="Target" less="Shorten the target" more="Lengthen the target" onPress={(by) => { press({ kind: "target", by }); }} disabled={run.paused}>
                    <Led text={countdown(target * 1000)} colour={LED_AMBER} height={30} />
                  </Row>
                ) : null}
                {run.phase === "rest" && last !== undefined && last.measuredIn === "reps" ? (
                  <Row label={`Set ${String(lastSetNumber(run))}`} less="One rep less on the set just done" more="One rep more on the set just done" onPress={(by) => { press({ kind: "last", by }); }} disabled={run.paused}>
                    <Led text={String(last.done)} colour={LED_RED} height={30} />
                    <Txt kind="small" colour="timerWords">reps</Txt>
                  </Row>
                ) : null}
              </>
            )}
            {inSet ? (
              <Row label="Weight" less="Less weight" more="More weight" onPress={(by) => { press({ kind: "weight", by, units }); }} disabled={run.paused}>
                <Plate grams={weightGrams} units={units} />
              </Row>
            ) : null}
            {run.paused ? (
              <View style={styles.pausedCover} accessible accessibilityLabel="Paused">
                <Led text="PAUSED" colour={LED_AMBER} height={34} />
              </View>
            ) : null}
          </View>
          {run.phase !== "rest" && !run.paused ? (
            <View style={styles.next}>
              <Txt kind="eyebrow">Next up</Txt>
              <Txt kind="body" colour="text" numberOfLines={1} style={styles.grow}>
                {nextWords(run, units)}
              </Txt>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <View style={[styles.foot, { paddingBottom: insets.bottom + 10 }]}>
        <Button
          label={mainWords(run)}
          wide
          raised
          onPress={() => {
            press({ kind: "main" });
          }}
        />
        {inSet && !run.paused ? (
          <View style={styles.links}>
            <Button label="Reset set" kind="link" onPress={() => { press({ kind: "reset" }); }} />
            <Button label="Skip exercise" kind="link" onPress={() => { press({ kind: "skipExercise" }); }} />
          </View>
        ) : null}
      </View>
      <Sheet
        open={asking}
        title="End workout?"
        onClose={() => {
          setAsking(false);
        }}
      >
        <Txt kind="body" colour="text">
          {done === 0 ? "No sets done yet. Nothing will be saved." : `${String(done)} of ${String(setsInAll(run))} sets done. Those sets will be saved.`}
        </Txt>
        <View style={styles.two}>
          <Button
            label="Keep going"
            kind="plain"
            style={styles.half}
            onPress={() => {
              setAsking(false);
            }}
          />
          {done === 0 ? (
            <Button
              label="End workout"
              kind="danger"
              style={styles.half}
              onPress={() => {
                setAsking(false);
                onDiscard();
              }}
            />
          ) : (
            <Button
              label="End and save"
              style={styles.half}
              onPress={() => {
                setAsking(false);
                press({ kind: "end" });
              }}
            />
          )}
        </View>
        {done === 0 ? null : (
          <Button
            label="Discard workout"
            kind="dangerLink"
            style={styles.self}
            onPress={() => {
              setAsking(false);
              onDiscard();
            }}
          />
        )}
      </Sheet>
    </View>
  );
}

/** The number of the set just done, within its exercise. */
function lastSetNumber(r: WorkoutRun): number {
  const last = r.done[r.done.length - 1];
  if (last === undefined) return 1;
  let n = 0;
  for (let i = r.done.length - 1; i >= 0 && r.done[i]?.exercise === last.exercise; i--) n += 1;
  return n;
}

function Label({ children }: { children: string }) {
  return (
    <Txt kind="tiny" style={styles.label}>
      {children.toUpperCase()}
    </Txt>
  );
}

function Round({ mark, say, disabled, onPress }: { mark: string; say: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={say}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [mark.length > 1 ? styles.roundWide : styles.round, pressed ? styles.roundPressed : null, disabled ? styles.faint : null]}
    >
      <Txt kind={mark.length > 1 ? "strong" : "big"} numberOfLines={1} style={styles.roundMark}>
        {mark}
      </Txt>
    </Pressable>
  );
}

/** One row of the wall timer: its name, −, what it shows, +. */
function Row({ label, less, more, onPress, disabled, children }: { label: string; less: string; more: string; onPress: (by: -1 | 1) => void; disabled: boolean; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowName}>
        <Label>{label}</Label>
      </View>
      <Round mark="−" say={less} disabled={disabled} onPress={() => { onPress(-1); }} />
      <View style={styles.rowValue}>{children}</View>
      <Round mark="+" say={more} disabled={disabled} onPress={() => { onPress(1); }} />
    </View>
  );
}

const PLATE = 72;

/** The set's weight as the set-up box's plate, smaller: its number above the hub, the unit below; "NONE" for none. */
function Plate({ grams, units }: { grams: number | null; units: Units }) {
  const [n, unit] = grams === null ? ["NONE", ""] : weightParts(grams, units);
  return (
    <View style={[styles.plate, grams === null ? null : styles.plateGlow]} accessible accessibilityLabel={grams === null ? "Weight, none" : `Weight, ${n} ${unit}`}>
      <PlateFace size={PLATE} none={grams === null} />
      <Txt kind="strong" colour={grams === null ? "textSoft" : "onOrange"} numberOfLines={1} fit style={[styles.plateNumber, grams === null ? styles.plateNone : null]}>
        {n}
      </Txt>
      {grams === null ? null : (
        <Txt kind="tiny" colour="onOrange" style={styles.plateUnit}>
          {unit.toUpperCase()}
        </Txt>
      )}
    </View>
  );
}

const RING = 168;
const STROKE = 12;

/** The ring a rest, a get-ready or a timed set runs down, its digits inside. */
function TimerRing({ share, colour, children }: { share: number; colour: ColourName; children: ReactNode }) {
  const r = (RING - STROKE) / 2;
  const around = 2 * Math.PI * r;
  return (
    <View style={styles.ring}>
      <Svg width={RING} height={RING} style={StyleSheet.absoluteFill} accessible={false}>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colours.track} strokeWidth={STROKE} fill="none" />
        {share > 0 ? (
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={r}
            stroke={colours[colour]}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${String(around * share)} ${String(around)}`}
            fill="none"
            transform={`rotate(-90 ${String(RING / 2)} ${String(RING / 2)})`}
          />
        ) : null}
      </Svg>
      <View style={styles.ringInside}>{children}</View>
    </View>
  );
}

/** The workout's last screen: it is complete, its time, sets and exercises, and whether it is saved. */
function Done({ finished, waiting, onDone }: { finished: Finished; waiting: WaitingView<WorkoutSave, RefusedWorkout>; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const id = finished.workoutId;
  const refused = waiting.refused.some((r) => r.workoutId === id);
  const waits = waiting.waiting.some((w) => w.workoutId === id);
  const saved = !refused && !waits && waiting.sent.includes(id);
  const title = refused ? "This workout couldn't be saved." : saved ? "Saved to your account" : waits && waiting.held ? "Saved on this phone" : "Saving…";
  const line = waits && waiting.held ? "It goes to your account when you're back online." : null;
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        <PictureTop
          picture="exhero"
          tall={0.8}
          eyebrow="Workout complete"
          title={finished.name.trim() === "" ? "Workout" : finished.name.trim()}
          above={
            <View style={styles.tick}>
              <Icon name="check" size={28} colour="onOrange" />
            </View>
          }
        />
        <View style={styles.body}>
          <View style={[styles.wall, styles.tiles]}>
            <Tile label="Time" text={clock(finished.totalMs)} colour={LED_AMBER} />
            <Tile label="Sets" text={String(finished.sets).padStart(2, "0")} colour={LED_RED} say={String(finished.sets)} />
            <Tile label="Exercises" text={String(finished.exercises).padStart(2, "0")} colour={LED_GREEN} say={String(finished.exercises)} />
          </View>
          <View style={[styles.saveLine, saved ? styles.saveGood : refused ? styles.saveBad : styles.saveWait]}>
            <Icon name={saved ? "check" : refused ? "warn" : "phone"} size={22} colour={saved ? "goodText" : refused ? "badText" : "orangeLight"} />
            <View style={styles.grow}>
              <Txt kind="strong">{title}</Txt>
              {line === null ? null : <Txt kind="body">{line}</Txt>}
            </View>
          </View>
        </View>
      </ScrollView>
      <View style={[styles.foot, { paddingBottom: insets.bottom + 10 }]}>
        <Button label="Done" wide raised onPress={onDone} />
      </View>
    </View>
  );
}

function Tile({ label, text, colour, say }: { label: string; text: string; colour: ColourName; say?: string }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}, ${say ?? text}`}>
      <Label>{label}</Label>
      <Led text={text} colour={colour} height={30} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  scroll: { flexGrow: 1 },
  grow: { flex: 1 },
  centre: { textAlign: "center" },
  digits: { fontVariant: ["tabular-nums"] },
  self: { alignSelf: "center" },
  pressed: { opacity: 0.85 },
  faint: { opacity: 0.35 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 4, marginHorizontal: -10 },
  topRound: { width: sizes.press, height: sizes.press, borderRadius: sizes.press / 2, alignItems: "center", justifyContent: "center", backgroundColor: colours.veil },
  topMiddle: { flex: 1 },
  topEnd: { minHeight: sizes.press, paddingHorizontal: 14, borderRadius: sizes.press / 2, alignItems: "center", justifyContent: "center", backgroundColor: colours.veil },
  body: { paddingHorizontal: 16, paddingTop: 6, gap: 12 },
  wall: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 22, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace },
  label: { fontFamily: fonts.bold, letterSpacing: 1.1, color: colours.timerWords },
  countRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, paddingBottom: 10 },
  countPad: { flex: 1, alignItems: "center", gap: 6 },
  countDigits: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  ofTarget: { paddingBottom: 4 },
  plusBig: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", experimental_backgroundImage: raisedOrangeGradient, boxShadow: shadows.button },
  plusMark: { lineHeight: 38 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colours.timerSplit },
  rowName: { width: 66 },
  rowValue: { flex: 1, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 6 },
  round: { width: sizes.press, height: sizes.press, borderRadius: sizes.press / 2, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised },
  // −15 and +15: as wide and as tall as their words need, never cut at the largest text.
  roundWide: { minWidth: 54, minHeight: 54, paddingHorizontal: 8, borderRadius: 27, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.raised },
  roundPressed: { backgroundColor: colours.box },
  roundMark: { lineHeight: 26 },
  ringRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 14, paddingTop: 12, paddingBottom: 10 },
  ring: { width: RING, height: RING },
  ringInside: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 8 },
  plate: { width: PLATE, height: PLATE, borderRadius: PLATE / 2 },
  // Black rubber for no weight has no glow, as drawn.
  plateGlow: { boxShadow: shadows.button },
  plateNumber: { position: "absolute", top: 8, left: 12, right: 12, textAlign: "center", fontFamily: fonts.bold, fontSize: 17, lineHeight: 20 },
  plateNone: { fontSize: 12, letterSpacing: 1.2, top: 11 },
  plateUnit: { position: "absolute", bottom: 12, left: 0, right: 0, textAlign: "center", fontFamily: fonts.bold, letterSpacing: 1.2 },
  pausedCover: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 22, backgroundColor: colours.timerFace, alignItems: "center", justifyContent: "center" },
  next: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
  foot: { paddingHorizontal: 16, paddingTop: 10, gap: 2, backgroundColor: colours.page },
  links: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 6 },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  tick: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", experimental_backgroundImage: raisedOrangeGradient, boxShadow: shadows.button },
  tiles: { flexDirection: "row", paddingVertical: 16 },
  tile: { flex: 1, alignItems: "center", gap: 10 },
  saveLine: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 18, borderWidth: 1 },
  saveGood: { borderColor: colours.goodLine, backgroundColor: colours.goodFill },
  saveBad: { borderColor: colours.badLine, backgroundColor: colours.badFill },
  saveWait: { borderColor: colours.orangeLine, backgroundColor: colours.orangeFill },
});
