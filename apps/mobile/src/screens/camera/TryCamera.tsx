import { useCameraPermissions } from "expo-camera";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { CAMERA_EXERCISES, type CameraExercise } from "../../camera/cameraExercises";
import { LiveSet } from "../../camera/liveSet";
import { PoseCameraView } from "../../camera/poseCameraNative";
import { clipOf } from "../../camera/voice";
import { ended, pressTry, shownReps, startTry, type TryPress, type TrySet } from "../../camera/trySet";
import { cameraToldFile, workoutSoundsFile } from "../../library/files";
import { holdWords } from "../../library/records";
import { Button } from "../../look/Button";
import { colours, sizes } from "../../look/colours";
import { Modal } from "../../look/Modal";
import { pictures } from "../../look/pictures";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { soundOnIn, soundText } from "../../sound/soundChoice";
import { soundNative } from "../../sound/soundNative";
import { ClipOver } from "../library/ExerciseClip";
import { useKeepMedia, useOwnPicture } from "../library/ExerciseImage";
import { useNamed } from "../library/useLibrary";
import { accountUnits } from "../setup/Setup";
import { CopyContext } from "../ThisCopy";
import { CameraBox, repsWords } from "./CameraBox";
import { CameraFirst } from "./CameraFirst";
import { CameraSet } from "./CameraSet";

// "Try the camera" (ROADMAP Stage 5 53a): a folder's copy's door to the camera screen, before the workout carries it
// (job 64b: Camera or Count myself, picked every time). One set of an exercise the camera counts today, from the box
// that lists them, through the screen that says what stays private (the first time only), to the camera and the set's
// end. Never in the store's app, and nothing of it is saved: the set is shown and gone.

const AWAKE_TAG = "camera";

type Step = { kind: "first"; exercise: CameraExercise } | { kind: "set"; exercise: CameraExercise };

export function TryCameraLink() {
  const { extra } = useContext(CopyContext);
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const { state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [permission, ask] = useCameraPermissions();
  // A folder's copy only, with the camera built in.
  if (extra?.copyName === undefined || PoseCameraView === null || me === null) return null;

  const open = async (exercise: CameraExercise) => {
    setPicking(false);
    const told = await cameraToldFile(me).read().catch(() => null);
    setStep(told !== null && permission?.granted === true ? { kind: "set", exercise } : { kind: "first", exercise });
  };

  return (
    <>
      <Button label="Try the camera" kind="link" onPress={() => { setPicking(true); }} style={styles.link} />
      <Sheet open={picking} title="Try the camera" onClose={() => { setPicking(false); }}>
        {CAMERA_EXERCISES.map((e) => (
          <Pressable key={e.key} accessibilityRole="button" accessibilityLabel={`${e.name}, ${e.measuredIn === "time" ? holdWords(e.target) : repsWords(e.target)}`} onPress={() => void open(e)} style={styles.choice}>
            <Txt kind="strong" style={styles.grow}>
              {e.name}
            </Txt>
            <Txt kind="small">{e.measuredIn === "time" ? holdWords(e.target) : repsWords(e.target)}</Txt>
          </Pressable>
        ))}
      </Sheet>
      <Modal visible={step !== null} animationType="fade" statusBarTranslucent onRequestClose={() => { setStep(null); }}>
        {step?.kind === "first" ? (
          <CameraFirst
            off={permission?.granted === false && !permission.canAskAgain}
            onBack={() => { setStep(null); }}
            onByHand={() => { setStep(null); }}
            onTurnOn={() => {
              void cameraToldFile(me).write(JSON.stringify({ told: true })).catch(() => undefined);
              void ask().then((answer) => {
                if (answer.granted) setStep({ kind: "set", exercise: step.exercise });
              });
            }}
          />
        ) : step?.kind === "set" ? (
          <TrySetScreen key={step.exercise.key} me={me} exercise={step.exercise} onClose={() => { setStep(null); }} />
        ) : null}
      </Modal>
    </>
  );
}

function TrySetScreen({ me, exercise, onClose }: { me: string; exercise: CameraExercise; onClose: () => void }) {
  const { state } = useSession();
  const units = (state.kind === "in" ? accountUnits(state.user.units) : null) ?? "metric";
  // A new one when the set starts again (Reset set): its count and its form score are the new set's alone.
  const [live, setLive] = useState(() => new LiveSet(exercise.counts, exercise.camera, 1));
  const [set, setSet] = useState<TrySet>(() => startTry(exercise.measuredIn, exercise.target));
  const [box, setBox] = useState(false);
  const [stopped, setStopped] = useState<"failed" | "byHand" | null>(null);
  const [result, setResult] = useState<{ reps: number; heldMs: number; form: number | null } | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const soundFile = useRef(workoutSoundsFile(me));
  useEffect(() => {
    void soundFile.current.read().then((text) => { setSoundOn(soundOnIn(text)); }).catch(() => undefined);
  }, []);
  // The screen stays awake while the camera is up: the person is metres from it.
  useEffect(() => {
    void activateKeepAwakeAsync(AWAKE_TAG).catch(() => undefined);
    return () => { void deactivateKeepAwake(AWAKE_TAG).catch(() => undefined); };
  }, []);

  const press = useCallback(
    (p: TryPress) => {
      if (p.kind === "reset") setLive(new LiveSet(exercise.counts, exercise.camera, 1));
      setSet((s) => pressTry(s, p));
    },
    [exercise],
  );
  // The set reached its end, by its target or by Set done: the camera's last rep judged, and its summary read once.
  useEffect(() => {
    if (!set.done || result !== null) return;
    const end = live.end();
    const last = ended(set, end.reps);
    setResult({ reps: shownReps(last), heldMs: last.heldMs, form: end.summary?.avgFormScore ?? null });
    setBox(false);
    // "Set complete.", by the coach (53b-i).
    const clip = end.say === null ? null : clipOf(end.say);
    if (clip !== null && soundOn) soundNative?.speak(clip);
  }, [set, live, result, soundOn]);

  const reference = useReference(exercise, !set.paused && result === null);
  const timed = exercise.measuredIn === "time";
  const digits = timed ? holdWords(set.heldMs / 1000).replace(" s", "") : String(shownReps(set)).padStart(2, "0");
  const sound = { on: soundOn, flip: () => { const next = !soundOn; setSoundOn(next); void soundFile.current.write(soundText(next)).catch(() => undefined); } };
  return (
    <CameraSet
      live={live}
      title={`${exercise.name} · Set 1 of 1`}
      digits={digits}
      of={timed ? `/ ${holdWords(set.target)}` : `/ ${String(set.target)}`}
      paused={set.paused || result !== null}
      sound={soundOn}
      now={{ byHand: set.byHand, target: set.target }}
      stopped={stopped}
      reference={reference}
      onCamera={(reps, heldMs) => { press({ kind: "camera", reps, heldMs }); }}
      onProblem={() => { setStopped("failed"); press({ kind: "stopped" }); }}
      onTap={() => { setBox(true); }}
    >
      {result !== null ? (
        <Done result={result} timed={timed} onDone={onClose} />
      ) : box || stopped !== null ? (
        <CameraBox
          set={set}
          units={units}
          sound={sound}
          press={press}
          byHand={stopped !== null}
          onClose={() => { setBox(false); }}
          onByHand={() => { setStopped("byHand"); press({ kind: "stopped" }); }}
          onEnd={onClose}
          onSkip={onClose}
        />
      ) : undefined}
    </CameraSet>
  );
}

/** What the set came to, said where the box was. */
function Done({ result, timed, onDone }: { result: { reps: number; heldMs: number; form: number | null }; timed: boolean; onDone: () => void }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={styles.above} />
      <View testID="camera-done" style={styles.done}>
        <Txt kind="h2">Set done</Txt>
        <Txt kind="strong">{timed ? `Held ${holdWords(result.heldMs / 1000)}` : repsWords(result.reps)}</Txt>
        {result.form === null ? null : <Txt kind="body">{`Form score ${String(Math.round(result.form))}`}</Txt>}
        <Button label="Done" raised wide onPress={onDone} />
      </View>
    </View>
  );
}

/** The exercise's own picture, its clip playing over it, from the Library kept on the phone, once it has come; until the
 *  Library has a picture of its own, the app's own picture of it; null for an exercise with neither (no tile is drawn). */
function useReference(exercise: CameraExercise, playing: boolean): ReactNode {
  const named = useNamed();
  const own = exercise.libraryId === null ? null : named(exercise.libraryId);
  useKeepMedia([own?.picture?.file, own?.clip?.file].filter((f): f is string => f !== undefined));
  const uri = useOwnPicture(own?.picture ?? null);
  if (own?.picture !== null && own?.picture !== undefined && uri !== null) {
    const ground = own.picture.ground;
    return (
      <View style={[styles.fill, { backgroundColor: ground }]}>
        <Image source={{ uri }} resizeMode="cover" style={styles.whole} accessible={false} />
        <ClipOver id={`camera-${exercise.key}`} clip={own.clip} playing={playing} ground={ground} />
      </View>
    );
  }
  if (exercise.picture === null) return null;
  return <Image testID={`camera-picture-${exercise.key}`} source={pictures[exercise.picture]} resizeMode="cover" style={styles.whole} accessible={false} />;
}

const styles = StyleSheet.create({
  link: { alignSelf: "center" },
  choice: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.button, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colours.line },
  grow: { flex: 1 },
  above: { flex: 1 },
  done: { backgroundColor: colours.box, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: sizes.edge, paddingBottom: 32, gap: 8 },
  fill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  /** A picture filling its tile: an Image laid out by its edges alone is drawn at its own size. */
  whole: { width: "100%", height: "100%" },
});
