import { useCameraPermissions } from "expo-camera";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { CAMERA_EXERCISES, type CameraExercise } from "../../camera/cameraExercises";
import { LiveSet } from "../../camera/liveSet";
import { PoseCameraView } from "../../camera/poseCameraNative";
import { pressTry, shownReps, startTry, type TryPress, type TrySet } from "../../camera/trySet";
import { cameraToldFile, workoutSoundsFile } from "../../library/files";
import { holdWords } from "../../library/records";
import { Button } from "../../look/Button";
import { colours, sizes } from "../../look/colours";
import { Modal } from "../../look/Modal";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { soundOnIn, soundText } from "../../sound/soundChoice";
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
      <Button label="Try the camera" kind="link" onPress={() => { setPicking(true); }} />
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
  const live = useMemo(() => new LiveSet(exercise.counts, exercise.camera, 1), [exercise]);
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

  const press = useCallback((p: TryPress) => { setSet((s) => pressTry(s, p)); }, []);
  // The set reached its end, by its target or by Set done: the camera's last rep judged, and its summary read once.
  useEffect(() => {
    if (!set.done || result !== null) return;
    const end = live.end();
    setResult({ reps: shownReps(set), heldMs: set.heldMs, form: end.summary?.avgFormScore ?? null });
    setBox(false);
  }, [set, live, result]);

  const reference = useReference(exercise.libraryId, !set.paused && result === null);
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
          onByHand={() => { setStopped("byHand"); }}
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
        <Button label="Done" raised onPress={onDone} />
      </View>
    </View>
  );
}

/** The exercise's own picture, its clip playing over it, from the Library kept on the phone; null until it has come, and
 *  for an exercise the Library does not have (no tile is drawn). */
function useReference(libraryId: string | null, playing: boolean): ReactNode {
  const named = useNamed();
  const own = libraryId === null ? null : named(libraryId);
  useKeepMedia([own?.picture?.file, own?.clip?.file].filter((f): f is string => f !== undefined));
  const uri = useOwnPicture(own?.picture ?? null);
  if (libraryId === null || own?.picture === null || own?.picture === undefined || uri === null) return null;
  const ground = own.picture.ground;
  return (
    <View style={[styles.fill, { backgroundColor: ground }]}>
      <Image source={{ uri }} resizeMode="cover" style={styles.fill} accessible={false} />
      <ClipOver id={`camera-${libraryId}`} clip={own.clip} playing={playing} ground={ground} />
    </View>
  );
}

const styles = StyleSheet.create({
  choice: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.button, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colours.line },
  grow: { flex: 1 },
  above: { flex: 1 },
  done: { backgroundColor: colours.box, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: sizes.edge, paddingBottom: 32, gap: 8 },
  fill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
});
