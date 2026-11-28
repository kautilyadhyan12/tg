import type { SavedSet, WorkoutRun } from "@app/shared";
import { useCameraPermissions } from "expo-camera";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cameraFor, type CameraExercise } from "../../camera/cameraExercises";
import { FOLLOW_TICK_MS, followPress, followSounds, startFollow, type Follow, type FollowPress } from "../../camera/followAlong";
import { LiveSet } from "../../camera/liveSet";
import { PoseCameraView } from "../../camera/poseCameraNative";
import type { TryPress, TrySet } from "../../camera/trySet";
import { clipFor, clipOf } from "../../camera/voice";
import { cameraEndOf } from "../../camera/workoutCamera";
import { holdWords, type Units } from "../../library/records";
import { cameraReached, following, leftOf, nextOf, setOf, type Press } from "../../library/workoutRun";
import { Button } from "../../look/Button";
import { CAMERA_OFF } from "../../look/cameraWords";
import { colours, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { followDigits } from "../../look/sizing";
import { fonts, Txt } from "../../look/Txt";
import { soundNative } from "../../sound/soundNative";
import { Led } from "../library/Records";
import { BoxButton, BoxPills, BoxRows, BoxSheet, CameraBox, Pill, Row } from "../camera/CameraBox";
import { CameraSet, REPS_BOX_WORDS, TIME_BOX_WORDS } from "../camera/CameraSet";
import { CAMERA_OFF_WORDS, FollowAlong, FollowBox, FollowDone } from "../camera/FollowAlong";
import { useReference } from "../camera/Reference";
import { ASK_PRIVACY, COUNT_MANUALLY, OPEN_SETTINGS, REST_BOX_HOLD_WORDS, REST_BOX_WORDS, RESUMES_WORDS, START_WITH_CAMERA, askWords, lastSetNumber, restWords } from "./cameraWords";
import { countdown, mainWords } from "./words";
import type { SoundSwitch } from "./WorkoutLayer";

// The camera in the workout (ROADMAP Stage 5 64b-ii; spec Part 2 §11.8 steps 3 to 6; Kd's drawing of 2026-11-28 and his
// words for its question): as an exercise the camera counts starts, the question, every time; then the camera screen of 53a
// unchanged, its box, Follow along and Count this set myself; the set ends by itself at its target with what the camera
// judged, and the rest after it is read from where the person stands, with the camera off. Every step is the workout's own
// (`workoutRun.ts`); these screens only draw it and hand the camera's answers in.

/** The camera's set kept while the workout's screen is put away and opened again (the screen goes; the set's engine stays),
 *  and Follow along's timer with it: one of each, for the set being done. */
export interface CameraKeep {
  live: (key: string, make: () => LiveSet) => LiveSet;
  follow: (key: string) => Follow | null;
  setFollow: (key: string, follow: Follow) => void;
}

export function createCameraKeep(): CameraKeep {
  let live: { key: string; set: LiveSet } | null = null;
  let follow: { key: string; follow: Follow } | null = null;
  return {
    live: (key, make) => {
      if (live === null || live.key !== key) live = { key, set: make() };
      return live.set;
    },
    follow: (key) => (follow !== null && follow.key === key ? follow.follow : null),
    setFollow: (key, next) => {
      follow = { key, follow: next };
    },
  };
}

/** Start with camera: on at once where the camera is allowed, else the phone's own question first. Turned off for the app
 *  in the phone's settings, `off` says so, and is looked at again as the person comes back from them. */
function useStartCamera(onGranted: () => void): { off: boolean; go: () => void } {
  const [permission, ask, get] = useCameraPermissions();
  const [refused, setRefused] = useState(false);
  const off = refused || (permission !== null && !permission.granted && !permission.canAskAgain);
  useEffect(() => {
    if (!off) return undefined;
    const heard = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void get().then((p) => {
        if (p.granted) setRefused(false);
      });
    });
    return () => {
      heard.remove();
    };
  }, [off, get]);
  const go = () => {
    if (permission?.granted === true) {
      onGranted();
      return;
    }
    void ask().then((answer) => {
      if (answer.granted) onGranted();
      else setRefused(true);
    });
  };
  return { off: off && permission?.granted !== true, go };
}

/** The question as an exercise the camera counts starts (Kd's words, board 1): from a box at the foot, over the workout's own
 *  screen; asked every time, nothing remembered. */
export function CameraAsk({ run, press }: { run: WorkoutRun; press: (p: Press) => void }) {
  const insets = useSafeAreaInsets();
  const { exercise } = setOf(run);
  const camera = cameraFor(exercise.exercise, exercise.measuredIn);
  const words = askWords(exercise.name, exercise.measuredIn, camera !== null && camera.camera !== null);
  const start = useStartCamera(() => {
    press({ kind: "way", way: "camera" });
  });
  // An exercise with no form rules of its own has no title: its name heads the box.
  const heading = start.off ? CAMERA_OFF.title : words.title;
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={styles.scrim} />
      <View testID="camera-ask" accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.grab} />
        <View style={styles.askHead}>
          <View style={styles.askIcon}>
            <Icon name={start.off ? "cameraOff" : "camera"} size={24} colour="orangeLight" />
          </View>
          <View style={styles.grow}>
            {heading === null ? null : <Txt kind="eyebrow">{words.eyebrow}</Txt>}
            <Txt kind="h2">{heading ?? exercise.name}</Txt>
          </View>
        </View>
        <Txt kind="body" colour="text">
          {start.off ? CAMERA_OFF.line : words.line}
        </Txt>
        {start.off ? null : <Txt kind="small">{ASK_PRIVACY}</Txt>}
        <View style={styles.askRow}>
          <Button
            label={start.off ? OPEN_SETTINGS : START_WITH_CAMERA}
            raised
            onPress={start.off ? () => void Linking.openSettings() : start.go}
            style={styles.askMain}
          />
          <Button
            label={COUNT_MANUALLY}
            kind="link"
            onPress={() => {
              press({ kind: "way", way: "hand" });
            }}
          />
        </View>
      </View>
    </View>
  );
}

/** Start with camera, for a set being counted by hand (board 5), between Reset set and Skip exercise; where the camera is
 *  turned off for the app, the line that says so, with the phone's settings. */
export function StartCameraLink({ press }: { press: (p: Press) => void }) {
  const start = useStartCamera(() => {
    press({ kind: "way", way: "camera" });
  });
  if (start.off) return <Button label={OPEN_SETTINGS} kind="link" say={`${CAMERA_OFF.title}. ${OPEN_SETTINGS}`} onPress={() => void Linking.openSettings()} />;
  return <Button label={START_WITH_CAMERA} kind="link" onPress={start.go} />;
}

interface HostProps {
  run: WorkoutRun;
  units: Units;
  sound: SoundSwitch;
  press: (p: Press) => void;
  keep: CameraKeep;
  onEnd: () => void;
}

/** What the camera's screens change with: the set, never the workout's clocks, which move four times a second and would draw
 *  the camera screen again each time for nothing (53a: drawing it for every picture took the phone's chip from the model). */
export function cameraKey(r: WorkoutRun): string {
  return JSON.stringify([r.workoutId, r.ex, r.set, r.phase, r.phaseAt, r.count, r.paused, r.way, r.follow, r.cam, r.exercises[r.ex]?.sets[r.set]]);
}

/** The set being counted by the camera, or followed with its clip (boards 2 and 3, and Follow along's). */
export const WorkoutCameraSet = memo(
  function WorkoutCameraSet(props: HostProps) {
    const { exercise } = setOf(props.run);
    const camera = cameraFor(exercise.exercise, exercise.measuredIn);
    if (camera === null || PoseCameraView === null) return <CameraGone press={props.press} />;
    return following(props.run) ? <FollowHost {...props} camera={camera} /> : <TrackHost {...props} camera={camera} />;
  },
  (a, b) => cameraKey(a.run) === cameraKey(b.run) && a.sound === b.sound && a.units === b.units && a.press === b.press && a.keep === b.keep && a.onEnd === b.onEnd,
);

/** No camera for this exercise on this phone (a copy without its module, or an exercise the app no longer counts): the set
 *  goes on by hand, as when the camera stops. */
function CameraGone({ press }: { press: (p: Press) => void }) {
  useEffect(() => {
    press({ kind: "leave", why: "camera_stopped", end: { reps: 0, heldMs: 0, summary: null } });
    press({ kind: "handSet" });
  }, [press]);
  return null;
}

/** The camera's set as its box shows it (53a's `TrySet`): the camera's count and the person's own changes to it. */
function trySetOf(r: WorkoutRun): TrySet {
  const { exercise, target, weightGrams } = setOf(r);
  const done = r.cam?.done ?? 0;
  return {
    measuredIn: exercise.measuredIn,
    target,
    weightGrams,
    cameraReps: done,
    heldMs: r.cam?.heldMs ?? 0,
    cameraLast: { reps: r.cam?.seenReps ?? 0, heldMs: r.cam?.seenHeldMs ?? 0 },
    byHand: r.count - done,
    paused: r.paused,
    stopped: false,
    done: false,
  };
}

function TrackHost({ run, units, sound, press, keep, onEnd, camera }: HostProps & { camera: CameraExercise }) {
  const { exercise, target } = setOf(run);
  const timed = exercise.measuredIn === "time";
  const key = `${run.workoutId}/${String(run.ex)}/${String(run.set)}/${String(run.cam?.at ?? 0)}`;
  const live = keep.live(key, () => new LiveSet(camera.counts, camera.camera, run.set + 1));
  const [box, setBox] = useState(false);
  const soundNow = useRef(sound.on);
  soundNow.current = sound.on;
  const ended = useRef(false);
  // The camera screen closed (put away, Follow along, the set left): nothing of the coach is said on another screen. A set
  // that ended says "Set complete." over its rest.
  useEffect(
    () => () => {
      if (!ended.current) soundNative?.hush();
    },
    [],
  );
  const last = nextOf(run) === null;
  const endSet = useCallback(() => {
    ended.current = true;
    const end = live.end();
    press({ kind: "cameraDone", end: cameraEndOf(end) });
    if (!soundNow.current) return;
    const clip = last ? clipFor("workout complete") : end.say === null ? null : clipOf(end.say);
    if (clip !== null) soundNative?.speak(clip);
  }, [live, press, last]);
  // At its target the set ends by itself, with what the camera judged of it.
  const reached = cameraReached(run);
  useEffect(() => {
    if (reached) endSet();
  }, [reached, endSet]);
  const leave = useCallback(
    (why: "chosen" | "camera_stopped") => {
      soundNative?.hush();
      press({ kind: "leave", why, end: cameraEndOf(live.end()) });
    },
    [live, press],
  );
  const onCamera = useCallback(
    (reps: number, heldMs: number) => {
      press({ kind: "camera", reps, heldMs });
    },
    [press],
  );
  const onProblem = useCallback(() => {
    leave("camera_stopped");
  }, [leave]);
  const boxPress = (p: TryPress) => {
    switch (p.kind) {
      case "count":
      case "target":
      case "weight":
      case "resume":
      case "reset":
        press(p);
        return;
      case "pause":
        soundNative?.hush();
        press(p);
        return;
      case "done":
        setBox(false);
        endSet();
        return;
      case "camera":
      case "stopped":
        return;
    }
  };
  const reference = useReference(camera);
  const heldMs = run.cam?.heldMs ?? 0;
  const digits = timed ? holdWords(heldMs / 1000).replace(" s", "") : String(run.count).padStart(2, "0");
  return (
    <CameraSet
      live={live}
      title={`${exercise.name} · Set ${String(run.set + 1)} of ${String(exercise.sets.length)}`}
      digits={digits}
      of={timed ? `/ ${holdWords(target)}` : `/ ${String(target)}`}
      paused={run.paused}
      sound={sound.on}
      now={{ byHand: run.count - (run.cam?.seenReps ?? 0), target }}
      stopped={null}
      reference={reference("tile", !run.paused)}
      onCamera={onCamera}
      onProblem={onProblem}
      onTap={() => {
        setBox(true);
      }}
      boxWords={timed ? TIME_BOX_WORDS : REPS_BOX_WORDS}
      onFollow={() => {
        soundNative?.hush();
        setBox(false);
        press({ kind: "follow" });
      }}
    >
      {box ? (
        <CameraBox
          set={trySetOf(run)}
          units={units}
          sound={sound}
          press={boxPress}
          byHand={false}
          onClose={() => {
            setBox(false);
          }}
          onByHand={() => {
            setBox(false);
            leave("chosen");
          }}
          onEnd={onEnd}
          onSkip={() => {
            press({ kind: "skipExercise" });
          }}
        />
      ) : undefined}
    </CameraSet>
  );
}

/** Follow along in the workout (53b-ii's screen): the camera off, the clip's timer runs the set, and the set is the person's
 *  own count, or a hold's time followed. Its Pause is the workout's. */
function FollowHost({ run, units, sound, press, keep, onEnd, camera }: HostProps & { camera: CameraExercise }) {
  const { exercise, target, weightGrams } = setOf(run);
  const key = `${run.workoutId}/${String(run.ex)}/${String(run.set)}/${String(run.phaseAt)}`;
  const [made] = useState(() => {
    const kept = keep.follow(key);
    return kept === null ? { follow: startFollow(exercise.measuredIn, target, Date.now()), fresh: true } : { follow: kept, fresh: false };
  });
  const [follow, setFollow] = useState(made.follow);
  const current = useRef(made.follow);
  const [box, setBox] = useState(false);
  const soundNow = useRef(sound.on);
  soundNow.current = sound.on;
  useEffect(() => {
    keep.setFollow(key, made.follow);
    if (!made.fresh || !soundNow.current) return;
    const clip = clipFor("get ready");
    if (clip !== null) soundNative?.speak(clip);
  }, [keep, key, made]);
  useEffect(
    () => () => {
      soundNative?.hush();
    },
    [],
  );
  const pressFollow = useCallback(
    (p: FollowPress) => {
      const before = current.current;
      const now = Date.now();
      const after = followPress(before, p, now);
      current.current = after;
      keep.setFollow(key, after);
      setFollow(after);
      if (p.kind === "pause") {
        soundNative?.hush();
        press({ kind: "pause" });
      }
      if (p.kind === "resume") press({ kind: "resume" });
      if (!soundNow.current) return;
      const heard = followSounds(before, after, p, now);
      for (const beep of heard.beeps) soundNative?.play(beep);
      const clip = heard.say === null ? null : clipFor(heard.say);
      if (clip !== null) soundNative?.speak(clip);
    },
    [keep, key, press],
  );
  // The workout paused by itself (away from the app too long): the clip's timer with it.
  useEffect(() => {
    if (run.paused && !current.current.paused && current.current.phase !== "done") pressFollow({ kind: "pause" });
  }, [run.paused, pressFollow]);
  const ticking = !follow.paused && follow.phase !== "done";
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      pressFollow({ kind: "tick" });
    }, FOLLOW_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [ticking, pressFollow]);
  const reference = useReference(camera);
  return (
    <FollowAlong
      follow={follow}
      name={exercise.name}
      setWords={`Set ${String(run.set + 1)} of ${String(exercise.sets.length)}`}
      reference={reference("follow", follow.phase !== "done" && !follow.paused)}
      press={pressFollow}
      onTap={() => {
        setBox(true);
      }}
      onCamera={() => {
        press({ kind: "way", way: "camera" });
      }}
    >
      {follow.phase === "done" ? (
        <FollowDone
          follow={follow}
          press={pressFollow}
          onDone={() => {
            press({ kind: "followed", done: exercise.measuredIn === "time" ? Math.floor(follow.doneMs / 1000) : follow.reps });
          }}
        />
      ) : box ? (
        <FollowBox
          follow={follow}
          weightGrams={weightGrams}
          units={units}
          sound={sound}
          press={pressFollow}
          onWeight={(by) => {
            press({ kind: "weight", by, units });
          }}
          onClose={() => {
            setBox(false);
          }}
          onByHand={() => {
            press({ kind: "handSet" });
          }}
          onEnd={onEnd}
          onSkip={() => {
            press({ kind: "skipExercise" });
          }}
        />
      ) : undefined}
    </FollowAlong>
  );
}

/** The rest after a set the camera counted (board 4): read from where the person stands, 2 to 3 metres away. The countdown
 *  in big lit digits, the camera off and saying so, the set's reps and its form score, what comes next. Its box: the rest
 *  longer or shorter, the set just done put right, Pause, Sound and End. */
export function CameraRest({ run, last, units, sound, press, onEnd }: { run: WorkoutRun; last: SavedSet; units: Units; sound: SoundSwitch; press: (p: Press) => void; onEnd: () => void }) {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const [box, setBox] = useState(false);
  const words = restWords(run, last, units);
  const reference = useReference(cameraFor(last.exercise, last.measuredIn));
  const left = countdown(leftOf(run)?.leftMs ?? 0);
  const label = run.paused ? "PAUSED" : "REST";
  const reps = last.measuredIn === "reps";
  return (
    <View testID="camera-rest" style={styles.page}>
      <View style={[styles.restTop, { paddingTop: insets.top + 12 }]}>
        <View style={styles.restTimer} accessible accessibilityLabel={`${label.toLowerCase()} ${left}`}>
          <Txt kind="tiny" colour={run.paused ? "ledAmber" : "text"} style={styles.label}>
            {label}
          </Txt>
          <Led text={left} colour={run.paused ? "ledAmber" : "ledGreen"} height={followDigits(screen.height)} bare />
        </View>
        <View style={styles.cameraOff}>
          <Icon name="cameraOff" size={18} colour="text" />
          <Txt kind="strong">{CAMERA_OFF_WORDS}</Txt>
        </View>
      </View>
      <View style={styles.clip} pointerEvents="none">
        {reference("follow", !run.paused)}
        <View style={[styles.melt, styles.meltTop]} />
        <View style={[styles.melt, styles.meltFoot]} />
      </View>
      <View style={[styles.restFoot, { paddingBottom: insets.bottom + 18 }]}>
        <Txt kind="eyebrow">{words.eyebrow}</Txt>
        <View style={styles.stats}>
          <View style={styles.stat} accessible accessibilityLabel={`${words.doneLabel} ${words.done}`}>
            <Txt kind="tiny" colour="timerWords" style={styles.label}>
              {words.doneLabel.toUpperCase()}
            </Txt>
            <Led text={words.done} colour="ledRed" height={36} />
          </View>
          {words.form === null ? null : (
            <>
              <View style={styles.statSplit} />
              <View style={styles.stat} accessible accessibilityLabel={`Form score ${String(words.form)}`}>
                <Txt kind="tiny" colour="timerWords" style={styles.label}>
                  FORM SCORE
                </Txt>
                <Led text={String(words.form)} colour="ledGreen" height={36} />
              </View>
            </>
          )}
        </View>
        <View style={styles.next}>
          <Txt kind="eyebrow">Next up</Txt>
          <Txt kind="body" colour="text" style={styles.grow}>
            {words.next}
          </Txt>
        </View>
        {words.resumes ? <Txt kind="small">{RESUMES_WORDS}</Txt> : null}
        <Button
          label={mainWords(run)}
          wide
          raised
          onPress={() => {
            press({ kind: "main" });
          }}
        />
        {box ? null : (
          <BoxButton
            words={reps ? REST_BOX_WORDS : REST_BOX_HOLD_WORDS}
            onPress={() => {
              setBox(true);
            }}
          />
        )}
      </View>
      {box ? (
        <BoxSheet
          testID="rest-box"
          closeID="rest-box-close"
          onClose={() => {
            setBox(false);
          }}
        >
          {/* While paused nothing in the rest moves but Resume: its rows wait for it. */}
          {run.paused ? null : (
            <BoxRows>
              <Row label="REST" less="15 seconds less rest" more="15 seconds more rest" onPress={(by) => { press({ kind: "rest", by }); }}>
                <Led text={left} colour="ledGreen" height={30} />
              </Row>
              {reps ? (
                <Row label={`SET ${String(lastSetNumber(run))}`} less="One rep less on the set just done" more="One rep more on the set just done" onPress={(by) => { press({ kind: "last", by }); }} line>
                  <Led text={String(last.done)} colour="ledRed" height={30} />
                  <Txt kind="small" colour="timerWords">
                    {last.done === 1 ? "rep" : "reps"}
                  </Txt>
                </Row>
              ) : null}
            </BoxRows>
          )}
          <BoxPills>
            <Pill icon={run.paused ? "play" : "pause"} words={run.paused ? "Resume" : "Pause"} onPress={() => { press({ kind: run.paused ? "resume" : "pause" }); }} />
            <Pill icon={sound.on ? "volume" : "volumeOff"} words={sound.on ? "Sound on" : "Sound off"} onPress={sound.flip} />
            <Pill words="End" danger onPress={onEnd} />
          </BoxPills>
        </BoxSheet>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  grow: { flex: 1 },
  scrim: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colours.scrim },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colours.box,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: sizes.edge,
    paddingTop: 10,
    gap: 10,
    boxShadow: shadows.sheet,
  },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: sizes.round, backgroundColor: colours.grab },
  askHead: { flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 8 },
  askIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: colours.orangeFill, borderWidth: 1, borderColor: colours.orangeLine },
  // The main button as wide as its words on one line, growing into the room left; on a small phone or at the largest text,
  // Count manually goes under it, centred (the 64b-ii walk: "Start with camera" broke in two at 720 by 1520).
  askRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 8, rowGap: 4, marginTop: 12 },
  askMain: { flexGrow: 1 },
  label: { fontFamily: fonts.bold, letterSpacing: 1.54 },
  restTop: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-start", gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  restTimer: { gap: 8 },
  cameraOff: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48 },
  clip: { flex: 1, overflow: "hidden" },
  melt: { position: "absolute", left: 0, right: 0, height: 32 },
  meltTop: { top: 0, experimental_backgroundImage: `linear-gradient(to bottom, ${colours.page}, ${colours.cameraShadeClear})` },
  meltFoot: { bottom: 0, experimental_backgroundImage: `linear-gradient(to top, ${colours.page}, ${colours.cameraShadeClear})` },
  restFoot: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  stats: { flexDirection: "row", borderRadius: 22, borderWidth: 1, borderColor: colours.timerEdge, backgroundColor: colours.timerFace },
  stat: { flex: 1, alignItems: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 14 },
  statSplit: { width: 1, backgroundColor: colours.timerSplit },
  next: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 4 },
});
