import type { RefusedWorkout, WorkoutRun, WorkoutSave } from "@app/shared";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { Button } from "../../look/Button";
import { colours, raisedOrangeGradient, shadows, sizes, workoutPictureFade, type ColourName } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { useReducedMotion } from "../../look/Motion";
import { PictureTop } from "../../look/PictureTop";
import { workoutPictureHeight } from "../../look/sizing";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { exercisePicture } from "../../library/pictures";
import { weightParts, type Units } from "../../library/records";
import { asking as askingWay, following, leftOf, setOf, setsInAll, tracking, type Press } from "../../library/workoutRun";
import type { Finished } from "../../library/workoutRunStore";
import { PoseCameraView } from "../../camera/poseCameraNative";
import { STOPPED_WORDS } from "../camera/CameraSet";
import { lastCameraSet, lastSetNumber } from "./cameraWords";
import { CameraAsk, CameraRest, StartCameraLink, WorkoutCameraSet, type CameraKeep } from "./WorkoutCamera";
import type { WaitingView } from "../../session/waitingList";
import { ClipOver } from "../library/ExerciseClip";
import { useKeepMedia, useOwnPicture, type OwnClip, type OwnPicture } from "../library/ExerciseImage";
import { Led } from "../library/Records";
import { useNamed } from "../library/useLibrary";
import { PlateFace } from "../library/WeightPlate";
import { HeartMonitorSheet } from "../../heart/HeartMonitor";
import { HeartPill } from "../../heart/HeartPill";
import { useHeartMax } from "../../heart/heartMax";
import { useHeartNow, type BluetoothState, type Monitor } from "../../heart/monitor";
import { Summary } from "./Summary";
import type { EffortHand, SoundSwitch } from "./WorkoutLayer";
import { clock, countdown, eyebrowWords, mainWords, nextWords, ringShare, setLine } from "./words";

// The workout's own screen (ROADMAP Stage 5 64a-ii, Kd's drawing of 2026-11-21): one screen for the whole workout. The
// exercise's picture with where the workout is; the gym's LED wall timer with the reps counted (+ for each, the set
// ending by itself at its target), or the timer of a set measured in time, or the rest's ring; the set's target and
// weight changed right there; Next up; the one main button saying what it keeps; Reset set and Skip exercise. Pause
// stops every clock; End asks first and keeps the sets done. Its last screen says the workout is saved, or where it is.

interface Props {
  run: WorkoutRun | null;
  finished: Finished | null;
  /** The finished workout is kept in its own file alone, not yet in the waiting list's (round one, H3). */
  keeping: boolean;
  waiting: WaitingView<WorkoutSave, RefusedWorkout>;
  units: Units;
  /** Sound on or off (64a-vi). */
  sound: SoundSwitch;
  press: (p: Press) => void;
  onPutAway: () => void;
  onDiscard: () => void;
  onFinished: () => void;
  effort: EffortHand;
  onNewWorkout: () => void;
  /** The camera's set kept while the screen is put away (64b-ii). */
  keep: CameraKeep;
}

export function WorkoutScreen({ run, finished, keeping, waiting, units, sound, press, onPutAway, onDiscard, onFinished, effort, onNewWorkout, keep }: Props) {
  if (run === null) {
    return finished === null ? null : <Summary finished={finished} keeping={keeping} waiting={waiting} effort={effort} units={units} onDone={onFinished} onNewWorkout={onNewWorkout} />;
  }
  return <Doing run={run} units={units} sound={sound} press={press} onPutAway={onPutAway} onDiscard={onDiscard} keep={keep} />;
}

const LED_RED: ColourName = "ledRed";
const LED_AMBER: ColourName = "ledAmber";
const LED_GREEN: ColourName = "ledGreen";

/** The heart rate now from the person's own monitor, in the zone of their maximum (64a-vi); read only once a monitor
 *  is saved, so a person with none costs the server nothing. */
function WorkoutHeart({ bpm, bluetooth, monitor }: { bpm: number | null; bluetooth: BluetoothState; monitor: Monitor }) {
  const read = useHeartMax().read;
  // With no heart rate the pill opens the monitor box, where what stands in the way has its button (37n's re-check, N2).
  const [open, setOpen] = useState(false);
  return (
    <>
      <HeartPill
        bpm={bpm}
        max={read.kind === "ok" ? read.data.max : null}
        big
        bluetooth={bluetooth}
        {...(bpm === null
          ? {
              onPress: () => {
                setOpen(true);
              },
            }
          : {})}
      />
      <HeartMonitorSheet
        open={open}
        monitor={monitor}
        onClose={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

/** Sound on or off, said as it is now; a press turns it the other way, and the phone keeps it for the next workouts. */
function SoundPill({ sound }: { sound: SoundSwitch }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Sound"
      accessibilityState={{ checked: sound.on }}
      onPress={sound.flip}
      hitSlop={4}
      style={({ pressed }) => [styles.soundPill, pressed ? styles.pressed : null]}
    >
      <Icon name={sound.on ? "volume" : "volumeOff"} size={18} colour={sound.on ? "text" : "textSoft"} />
      <Txt kind="strong" colour={sound.on ? "text" : "textSoft"} numberOfLines={1}>
        {sound.on ? "Sound on" : "Sound off"}
      </Txt>
    </Pressable>
  );
}

function Doing({ run, units, sound, press, onPutAway, onDiscard, keep }: { run: WorkoutRun; units: Units; sound: SoundSwitch; press: (p: Press) => void; onPutAway: () => void; onDiscard: () => void; keep: CameraKeep }) {
  const insets = useSafeAreaInsets();
  const heart: { monitor: Monitor | null; bpm: number | null; bluetooth: BluetoothState } = useHeartNow(true);
  const [asking, setAsking] = useState(false);
  const askEnd = useCallback(() => {
    setAsking(true);
  }, []);
  const { exercise, target, weightGrams } = setOf(run);
  const timed = exercise.measuredIn === "time";
  const inSet = run.phase === "set";
  const share = ringShare(run);
  const name = run.name.trim() === "" ? "Workout" : run.name.trim();
  const last = run.done[run.done.length - 1];
  const done = run.done.length;
  // The exercise's own picture and clip (62b), from the Library kept on the phone: in a rest, the exercise coming up next.
  // Every exercise's are asked for as the workout opens, so none is missing later with no internet.
  const named = useNamed();
  const own = named(exercise.exercise);
  const files = useMemo(
    () => run.exercises.flatMap((e) => { const n = named(e.exercise); return [n.picture?.file, n.clip?.file].filter((f): f is string => f !== undefined); }),
    [run.exercises, named],
  );
  useKeepMedia(files);
  const ownUri = useOwnPicture(own.picture);
  const reduced = useReducedMotion();
  const top = (
    <View style={styles.tops}>
    <View style={styles.topBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="Put workout away" onPress={onPutAway} style={styles.topRound} hitSlop={4}>
        <Icon name="down" size={26} colour="text" />
      </Pressable>
      <View style={styles.topMiddle}>
        <Txt kind="strong" numberOfLines={1} fit style={styles.centre}>
          {name}
        </Txt>
        <Txt kind="small" colour="text" numberOfLines={1} fit style={[styles.centre, styles.digits]}>
          {clock(run.activeMs)}
        </Txt>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={run.paused ? "Resume workout" : "Pause workout"}
        onPress={() => {
          press({ kind: run.paused ? "resume" : "pause" });
        }}
        style={styles.topPill}
      >
        <Icon name={run.paused ? "play" : "pause"} size={20} colour="text" filled />
        <Txt kind="ticket" numberOfLines={1}>
          {run.paused ? "Resume" : "Pause"}
        </Txt>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="End workout"
        onPress={() => {
          setAsking(true);
        }}
        style={styles.topEnd}
      >
        <Txt kind="ticket" colour="badText" numberOfLines={1}>
          End
        </Txt>
      </Pressable>
    </View>
    </View>
  );
  // The heart rate and the sound switch, in the page under the title: over the picture they could not grow with the words
  // and ran over the title on a small phone at the largest text.
  const pills = (
    <View style={styles.pills}>
      {heart.monitor === null ? <View style={styles.grow} /> : (
        <View style={styles.heartRoom}>
          <WorkoutHeart bpm={heart.bpm} bluetooth={heart.bluetooth} monitor={heart.monitor} />
        </View>
      )}
      <SoundPill sound={sound} />
    </View>
  );
  const endSheet = (
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
  );
  // The camera counting the set, or the clip followed (64b-ii): its own screen, over the whole phone.
  if (tracking(run) || following(run)) {
    return (
      <View style={styles.page}>
        <WorkoutCameraSet run={run} units={units} sound={sound} press={press} keep={keep} onEnd={askEnd} />
        {endSheet}
      </View>
    );
  }
  // The rest after a set the camera counted: read from where the person stands, the camera off.
  const lastCamera = lastCameraSet(run);
  if (lastCamera !== null) {
    return (
      <View style={styles.page}>
        <CameraRest run={run} last={lastCamera} units={units} sound={sound} press={press} onEnd={askEnd} />
        {endSheet}
      </View>
    );
  }
  // An exercise the camera counts, being counted by hand: the camera can count the set from now (Kd's drawing, board 5).
  const offerCamera = inSet && !run.paused && !askingWay(run) && exercise.camera === true && PoseCameraView !== null && (run.cam === undefined || run.cam.left === null);
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} bounces={false}>
        {/* The page's rule too: its own picture whole once it has come (small, it comes first), the clip over it. */}
        {own.picture !== null && ownUri !== null ? (
          <>
            <OwnTop id={exercise.exercise} uri={ownUri} picture={own.picture} clip={reduced === false ? own.clip : null} playing={!run.paused} above={top} />
            <View style={styles.ownWords}>
              <Txt kind="eyebrow">{eyebrowWords(run)}</Txt>
              <Txt kind="h2">{exercise.name}</Txt>
              {run.phase === "rest" ? <Txt kind="body" colour="text">{setLine(run, units)}</Txt> : null}
            </View>
          </>
        ) : (
          <PictureTop
            picture={exercisePicture(exercise.exercise, exercise.kind)}
            tall={0.62}
            above={top}
            eyebrow={eyebrowWords(run)}
            title={exercise.name}
            {...(run.phase === "rest" ? { foot: <Txt kind="body" colour="text">{setLine(run, units)}</Txt> } : {})}
          />
        )}
        <View style={styles.body}>
          {pills}
          {/* The camera stopped in this set (§11.8): it goes on by hand, and says so where it is counted. */}
          {inSet && run.cam?.left === "camera_stopped" ? (
            <View testID="camera-stopped" style={styles.stopped} accessibilityLiveRegion="polite">
              <Icon name="cameraOff" size={18} colour="text" />
              <Txt kind="strong" style={styles.grow}>
                {STOPPED_WORDS}
              </Txt>
            </View>
          ) : null}
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
            {offerCamera ? <StartCameraLink press={press} /> : null}
            <Button label="Skip exercise" kind="link" onPress={() => { press({ kind: "skipExercise" }); }} />
          </View>
        ) : null}
      </View>
      {askingWay(run) ? <CameraAsk run={run} press={press} /> : null}
      {endSheet}
    </View>
  );
}

/** The exercise's own picture whole at the top of the workout, its clip playing over it (62b, as drawn): its own grey from
 *  the top of the phone and to both sides, the top's buttons above it, nothing over the person; the name comes under it.
 *  The clip stops on its frame while the workout is paused. */
function OwnTop({ id, uri, picture, clip, playing, above }: { id: string; uri: string | null; picture: OwnPicture; clip: OwnClip | null; playing: boolean; above: ReactNode }) {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const height = workoutPictureHeight(screen.width, screen.height, picture);
  return (
    // The picture's own colour, read from the picture: the one colour a screen takes from data.
    <View style={[styles.ownBand, { backgroundColor: picture.ground, paddingTop: insets.top + 12 + TOP + 10 }]}>
      <View style={{ height }}>
        {uri === null ? null : <Image testID={`workout-picture-${id}`} source={{ uri }} resizeMode="contain" style={styles.ownFill} accessible={false} />}
        <ClipOver id={id} clip={clip} playing={playing} ground={picture.ground} />
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ownFade]} />
      <View style={[styles.ownAbove, { top: insets.top + 12 }]}>{above}</View>
    </View>
  );
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
/** The top's buttons: taller than a press needs. */
const TOP = 54;
/** The heart rate and the sound switch under them. */
const PILL = 48;

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

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  scroll: { flexGrow: 1 },
  grow: { flex: 1 },
  centre: { textAlign: "center" },
  digits: { fontVariant: ["tabular-nums"] },
  self: { alignSelf: "center" },
  pressed: { opacity: 0.85 },
  faint: { opacity: 0.35 },
  // The top's buttons on one line and one height over the picture, each on its own see-through backing (Kd's click-through:
  // "scattered around"; then, of a dark panel behind them, "why is there black background?").
  tops: { marginHorizontal: -10 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 6 },
  // The heart rate and the sound switch under the top's buttons, over the picture (64a-vi).
  pills: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", gap: 8 },
  heartRoom: { flexGrow: 1, flexBasis: 180 },
  soundPill: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: PILL, paddingHorizontal: 14, borderRadius: sizes.round, backgroundColor: colours.raised, borderWidth: 1, borderColor: colours.lineStrong },
  // Pause and End are pressed mid-set, from a step back: big enough to hit at a glance (Kd: "pause, end is too small").
  topRound: { width: TOP, height: TOP, borderRadius: TOP / 2, alignItems: "center", justifyContent: "center", backgroundColor: colours.overWords, borderWidth: 1, borderColor: colours.lineStrong },
  topPill: { flexDirection: "row", gap: 8, minHeight: TOP, paddingHorizontal: 16, borderRadius: TOP / 2, alignItems: "center", justifyContent: "center", backgroundColor: colours.overWords, borderWidth: 1, borderColor: colours.lineStrong },
  topMiddle: { flex: 1 },
  topEnd: { minHeight: TOP, paddingHorizontal: 18, borderRadius: TOP / 2, alignItems: "center", justifyContent: "center", backgroundColor: colours.overWords, borderWidth: 1, borderColor: colours.lineStrong },
  body: { paddingHorizontal: 16, paddingTop: 6, gap: 12 },
  ownBand: { paddingBottom: 8 },
  ownFill: { width: "100%", height: "100%" },
  ownFade: { experimental_backgroundImage: workoutPictureFade },
  ownAbove: { position: "absolute", left: sizes.edge, right: sizes.edge },
  ownWords: { paddingHorizontal: sizes.edge, paddingTop: 6, gap: 8 },
  wall: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 22, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace },
  label: { fontFamily: fonts.bold, letterSpacing: 1.1, color: colours.timerWords },
  countRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12, paddingBottom: 10 },
  countPad: { flex: 1, alignItems: "center", gap: 6 },
  countDigits: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  ofTarget: { paddingBottom: 4 },
  plusBig: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", experimental_backgroundImage: raisedOrangeGradient, boxShadow: shadows.button },
  plusMark: { lineHeight: 38 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colours.timerSplit },
  // As wide as its word needs at the largest text ("WEIGHT" broke in two at a fixed 66, seen on the 62b walk).
  rowName: { minWidth: 66 },
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
  links: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", paddingHorizontal: 6 },
  stopped: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, backgroundColor: colours.raised, borderWidth: 1, borderColor: colours.lineStrong },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
