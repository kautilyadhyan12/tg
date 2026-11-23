import type { RefusedWorkout, RunExercise, WaitingEffort, WorkoutRun, WorkoutSave } from "@app/shared";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { appVersion } from "../../appExtra";
import { BottomRoom, useBottomRoom } from "../../look/BottomRoom";
import { colours, shadows, sizes } from "../../look/colours";
import { Modal } from "../../look/Modal";
import { fonts, Txt } from "../../look/Txt";
import { heartQueue, holdHeart, loadMonitor } from "../../heart/monitor";
import { effortWaitingFile, savedCopyFile, savedWaitingFile, workoutRunFile, workoutSoundsFile, workoutsWaitingFile } from "../../library/files";
import { createSavedStore, type SavedStore, type SavedView } from "../../library/savedWorkouts";
import { effortSender, effortWaiting, type EffortWaiting } from "../../library/effortSaving";
import type { Units } from "../../library/records";
import { newWorkoutId } from "../../library/workoutId";
import { setOf, shownAt, type Press } from "../../library/workoutRun";
import { createRunStore, type Finished, type RunStore, type StartResult } from "../../library/workoutRunStore";
import { workoutSender, workoutWaiting, type WorkoutWaiting } from "../../library/workoutSaving";
import type { WaitingView } from "../../session/waitingList";
import { useSession } from "../../session/SessionProvider";
import { soundOnIn, soundText } from "../../sound/soundChoice";
import { soundNative } from "../../sound/soundNative";
import type { TextStore } from "../food/outbox";
import { accountUnits } from "../setup/Setup";
import { clock } from "./words";
import { WorkoutScreen } from "./WorkoutScreen";

// The workout being done (ROADMAP Stage 5 64a-ii), over every tab, as a run is: Start workout on My Workout opens its
// screen; put away, a bar over every tab opens it again. Its workout is the person's own store (`createRunStore`),
// written to the phone at every step; a finished one waits in the person's own list until the server has it, sent from
// the moment the tabs open, whichever page is on screen.

/** While a finished workout waits, it is tried again this often (the list itself waits longer after no answer). */
export const SEND_AGAIN_MS = 15_000;
/** The screen's clocks move this often. */
const TICK_MS = 250;
/** Room the workout's own bar keeps over a page's foot, above the tab bar, as the run's bar does. */
export const WORKOUT_BAR_ROOM = 92;

export interface WorkoutLayerValue {
  /** The workout being done, as it was when something last happened (a press, a set, a pause): its place, never
   *  its clocks moved on, so the pages that read it are not drawn again four times a second while it runs (the
   *  64a-vi walk: the Dashboard, My Workout and the calendar were, and the app fell seconds behind the presses). A page
   *  showing its time draws `WorkoutClock`. Null for none. */
  run: WorkoutRun | null;
  finished: Finished | null;
  waiting: WaitingView<WorkoutSave, RefusedWorkout>;
  /** Starts a workout and opens its screen: "busy" where one is going on, or the last one is still being kept. */
  start: (name: string, exercises: readonly RunExercise[], startedFrom?: "saved" | "none") => StartResult;
  open: () => void;
  dismissRefused: (id: string) => void;
  /** The person's saved workouts (64a-iv): what the list shows, and the store that saves, loads and deletes. */
  saved: { view: SavedView; store: SavedStore } | null;
}

const NONE_WAITING: WaitingView<WorkoutSave, RefusedWorkout> = { waiting: [], refused: [], sent: [], held: false, unsaved: false };
const Context = createContext<WorkoutLayerValue | null>(null);

/** The workout layer; null outside the tabs (a screen test of one page). */
export const useWorkoutLayer = (): WorkoutLayerValue | null => useContext(Context);

/** Grows by one each time the server takes another finished workout, for a page that reads again then (64a-v): read from
 *  the newest workout sent, as the list keeps only its last 50 ids (round one L1). 0 until one is sent while it is open. */
export function useSentCount(): number {
  const sent = useWorkoutLayer()?.waiting.sent;
  const newest = sent === undefined ? null : (sent[sent.length - 1] ?? null);
  const seen = useRef(newest);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (newest === seen.current) return;
    seen.current = newest;
    setCount((n) => n + 1);
  }, [newest]);
  return count;
}

export interface WorkoutFiles {
  run: (userId: string) => TextStore;
  waiting: (userId: string) => TextStore;
  effort: (userId: string) => TextStore;
  savedCopy: (userId: string) => TextStore;
  savedWaiting: (userId: string) => TextStore;
  /** Sound on or off (64a-vi); absent in a test that never asks. */
  sounds?: (userId: string) => TextStore;
}

const PHONE_FILES: WorkoutFiles = {
  run: workoutRunFile,
  waiting: workoutsWaitingFile,
  effort: effortWaitingFile,
  savedCopy: savedCopyFile,
  savedWaiting: savedWaitingFile,
  sounds: workoutSoundsFile,
};

/** The workout's sounds on or off, and the press that changes it (64a-vi). */
export interface SoundSwitch {
  on: boolean;
  flip: () => void;
}
const NONE_SAVED: SavedView = { list: [], most: 0, known: false, refused: [], held: false };
const NONE_EFFORT: WaitingView<WaitingEffort, WaitingEffort> = { waiting: [], refused: [], sent: [], held: false, unsaved: false };

/** The stars of a finished workout, on its last screen: what waits for the server, and a press. */
export interface EffortHand {
  view: WaitingView<WaitingEffort, WaitingEffort>;
  /** "kept": the press is in the waiting list's file. "held": its file could not be written, so it waits in memory and is
   *  written again. "lost": the list was full and it is nowhere. */
  give: (workoutId: string, stars: number) => Promise<"kept" | "held" | "lost">;
}

export function WorkoutLayerProvider({ children, files = PHONE_FILES, onNewWorkout }: { children: ReactNode; files?: WorkoutFiles; onNewWorkout?: () => void }) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const units: Units = (state.kind === "in" ? accountUnits(state.user.units) : null) ?? "metric";
  const [made, setMade] = useState<{ store: RunStore; waiting: WorkoutWaiting; effort: EffortWaiting; saved: SavedStore } | null>(null);
  const [shown, setShown] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Sound on until the person's own file says off; read once they sign in.
  const [soundOn, setSoundOn] = useState(true);
  const soundRef = useRef(true);
  soundRef.current = soundOn;
  const soundFiles = useRef<TextStore | null>(null);

  // One store and one list for each person, made again when somebody else signs in, stopped when they leave.
  useEffect(() => {
    if (me === null) return undefined;
    // The person's own monitor, and a queue of its readings for the workout alone (64a-vi).
    void loadMonitor(me);
    const heart = heartQueue();
    const soundFile = files.sounds?.(me) ?? null;
    let left = false;
    setSoundOn(true);
    void soundFile?.read().then(
      (text) => {
        if (!left) setSoundOn(soundOnIn(text));
      },
      () => undefined,
    );
    const waiting = workoutWaiting(files.waiting(me), workoutSender((request, shape) => session.signedIn(request, shape)));
    const store = createRunStore({
      file: files.run(me),
      waiting,
      platform: Platform.OS === "ios" ? "ios" : "android",
      appVersion: appVersion(),
      clock: Date.now,
      heart: heart.take,
      sound: (sounds) => {
        if (!soundRef.current) return;
        for (const one of sounds) soundNative?.play(one);
      },
    });
    soundFiles.current = soundFile;
    // The stars wait while their workout is still on the phone, and go as soon as it is on the server.
    const effort = effortWaiting(
      files.effort(me),
      effortSender((request, shape) => session.signedIn(request, shape)),
      (id) => store.keeping() === id || waiting.view().waiting.some((w) => w.workoutId === id),
    );
    // Saved workouts' saves and deletes go from here too, whichever page is on screen; the list is read only when My
    // Workout is open (SavedPart), so a member who never opens it costs the server nothing.
    const saved = createSavedStore({ copy: files.savedCopy(me), waiting: files.savedWaiting(me), signedIn: (request, shape) => session.signedIn(request, shape), newId: newWorkoutId });
    setMade({ store, waiting, effort, saved });
    void saved.ready.then(() => saved.send(true));
    void waiting.start().then(() => waiting.send(true));
    void effort.start().then(() => effort.send(true));
    const sendStars = () => {
      if (effort.view().waiting.length > 0 || effort.view().unsaved) void effort.send(true);
    };
    const unheard = waiting.subscribe(sendStars);
    const timer = setInterval(() => {
      store.retry();
      if (waiting.view().waiting.length > 0 || waiting.view().unsaved) void waiting.send();
      if (effort.view().waiting.length > 0 || effort.view().unsaved) void effort.send();
      void saved.send();
    }, SEND_AGAIN_MS);
    const heard = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      store.press({ kind: "back" }, Date.now());
      store.retry();
      void waiting.send(true);
      void effort.send(true);
      void saved.send(true);
    });
    return () => {
      left = true;
      heart.close();
      soundFiles.current = null;
      waiting.stop();
      effort.stop();
      saved.stop();
      unheard();
      clearInterval(timer);
      heard.remove();
      setMade(null);
      setShown(false);
    };
  }, [me, session, files]);

  const store = made?.store ?? null;
  const subscribe = useCallback((told: () => void) => (store === null ? () => undefined : store.watch(told)), [store]);
  const kept = useSyncExternalStore(subscribe, () => store?.run() ?? null);
  const finished = useSyncExternalStore(subscribe, () => store?.finished() ?? null);
  const keeping = useSyncExternalStore(subscribe, () => store?.keeping() ?? null);
  const listen = useCallback((told: () => void) => made?.waiting.subscribe(told) ?? (() => undefined), [made]);
  const waiting = useSyncExternalStore(listen, () => made?.waiting.view() ?? NONE_WAITING);
  const listenStars = useCallback((told: () => void) => made?.effort.subscribe(told) ?? (() => undefined), [made]);
  const stars = useSyncExternalStore(listenStars, () => made?.effort.view() ?? NONE_EFFORT);
  const listenSaved = useCallback((told: () => void) => made?.saved.watch(told) ?? (() => undefined), [made]);
  const savedView = useSyncExternalStore(listenSaved, () => made?.saved.view() ?? NONE_SAVED);
  const pressed = useRef(0);
  const effortHand = useMemo<EffortHand>(
    () => ({
      view: stars,
      give: async (workoutId, n) => {
        const list = made?.effort;
        if (list === undefined) return "lost";
        pressed.current += 1;
        const id = `${workoutId}.${String(Date.now())}.${String(pressed.current)}`;
        const kept = await list.add({ id, workoutId, effort: n });
        void list.send(true);
        if (kept) return "kept";
        return list.view().waiting.some((e) => e.id === id) ? "held" : "lost";
      },
    }),
    [stars, made],
  );

  // A workout that ended by itself while its screen was put away (its last timer ran out) shows its last screen.
  const finishedId = finished?.workoutId ?? null;
  useEffect(() => {
    if (finishedId !== null) setShown(true);
  }, [finishedId]);

  // The clocks move while a workout runs: the screen's numbers, and the phases that end by themselves.
  const running = kept !== null && !kept.paused;
  useEffect(() => {
    if (store === null || !running) return undefined;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      const t = Date.now();
      setNow(t);
      store.press({ kind: "tick" }, t);
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [store, running]);

  // The person's monitor stays connected while a workout is on, its screen up or put away (64a-vi).
  const going = kept !== null;
  useEffect(() => {
    if (!going) return undefined;
    return holdHeart();
  }, [going]);

  const sound = useMemo<SoundSwitch>(
    () => ({
      on: soundOn,
      flip: () => {
        const next = !soundRef.current;
        soundRef.current = next;
        setSoundOn(next);
        void soundFiles.current?.write(soundText(next)).catch(() => undefined);
      },
    }),
    [soundOn],
  );

  // The screen stays awake while the workout's own screen is up.
  const up = shown && (kept !== null || finished !== null);
  useEffect(() => {
    if (!up) return undefined;
    void activateKeepAwakeAsync("workout").catch(() => undefined);
    return () => {
      void deactivateKeepAwake("workout").catch(() => undefined);
    };
  }, [up]);

  const run = useMemo(() => (kept === null ? null : shownAt(kept, Math.max(now, kept.seenAt))), [kept, now]);
  // The pages' copy: the same workout, kept until its place changes.
  const place = placeKey(kept);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const placed = useMemo(() => kept, [place]);
  const value = useMemo<WorkoutLayerValue>(
    () => ({
      run: placed,
      finished,
      waiting,
      start: (name, exercises, startedFrom = "none") => {
        if (store === null) return "busy";
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = store.start({ workoutId: newWorkoutId(), name, now: Date.now(), timeZone: zone === "" ? "UTC" : zone, exercises, startedFrom });
        if (result === "started") setShown(true);
        return result;
      },
      open: () => {
        setShown(true);
      },
      dismissRefused: (id) => {
        made?.waiting.dismiss(id);
      },
      saved: made === null ? null : { view: savedView, store: made.saved },
    }),
    [placed, finished, waiting, store, made, savedView],
  );

  const press = useCallback(
    (p: Press) => {
      const t = Date.now();
      setNow(t);
      store?.press(p, t);
    },
    [store],
  );
  const below = useBottomRoom();
  const barUp = run !== null && !shown;

  return (
    <Context.Provider value={value}>
      <BottomRoom.Provider value={below + (barUp ? WORKOUT_BAR_ROOM : 0)}>{children}</BottomRoom.Provider>
      {barUp ? (
        <WorkoutBar
          run={run}
          below={below}
          onOpen={() => {
            setShown(true);
          }}
        />
      ) : null}
      <Modal
        visible={up}
        animationType="slide"
        onRequestClose={() => {
          // Back puts a workout away; on its last screen it is Done.
          if (run === null) store?.closeFinished();
          setShown(false);
        }}
      >
        {run !== null || finished !== null ? (
          <WorkoutScreen
            run={run}
            finished={finished}
            keeping={finished !== null && keeping === finished.workoutId}
            waiting={waiting}
            effort={effortHand}
            units={units}
            sound={sound}
            press={press}
            onPutAway={() => {
              setShown(false);
            }}
            onDiscard={() => {
              store?.discard();
              setShown(false);
            }}
            onFinished={() => {
              store?.closeFinished();
              setShown(false);
            }}
            onNewWorkout={() => {
              store?.closeFinished();
              setShown(false);
              onNewWorkout?.();
            }}
          />
        ) : null}
      </Modal>
    </Context.Provider>
  );
}

/** What the pages' copy of a workout changes with: everything but its clocks. */
export function placeKey(r: WorkoutRun | null): string | null {
  if (r === null) return null;
  return [r.workoutId, r.name, r.phase, r.ex, r.set, r.paused, r.count, r.done.length, r.startedFrom ?? ""].join("/");
}

/** A workout's time trained, moving on by itself each second while it runs: for a page that shows it (My Workout's
 *  "In progress"), drawn alone so the page around it is not. It moves as the workout's screen does. */
export function WorkoutClock({ run, children }: { run: WorkoutRun; children: (ms: number) => ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (run.paused) return undefined;
    // As often as the workout's own screen and bar, so two places never show two times.
    const timer = setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [run]);
  return <>{children(shownAt(run, Math.max(now, run.seenAt)).activeMs)}</>;
}

/** The workout that is on, seen from every tab once its own screen is put away: what it is doing, its time, and a tap
 *  opens it again. Above a run's own bar where one is up too. */
function WorkoutBar({ run, below, onOpen }: { run: WorkoutRun; below: number; onOpen: () => void }) {
  const insets = useSafeAreaInsets();
  const { exercise } = setOf(run);
  const line = `${run.name.trim() === "" ? "Workout" : run.name.trim()} · ${clock(run.activeMs)} · ${exercise.name}, set ${String(run.set + 1)} of ${String(exercise.sets.length)}`;
  return (
    <View pointerEvents="box-none" style={[styles.barWrap, { bottom: sizes.tabBar + insets.bottom + 10 + below }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Open workout" onPress={onOpen} style={({ pressed }) => [styles.bar, pressed ? styles.pressed : null]}>
        <View style={[styles.dot, run.paused ? styles.dotPaused : styles.dotOn]} />
        <View style={styles.grow}>
          <Txt kind="strong" numberOfLines={1}>
            {run.paused ? "Workout paused" : "Workout in progress"}
          </Txt>
          <Txt kind="small" colour="textSoft" numberOfLines={1}>
            {line}
          </Txt>
        </View>
        <Txt kind="small" colour="orange" style={styles.open}>
          Open
        </Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.85 },
  barWrap: { position: "absolute", left: 12, right: 12 },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: sizes.boxRadius,
    backgroundColor: colours.raised,
    borderWidth: 1,
    borderColor: colours.orangeLine,
    boxShadow: shadows.sheet,
  },
  dot: { width: 10, height: 10, borderRadius: sizes.round },
  dotOn: { backgroundColor: colours.orange, boxShadow: shadows.dotGlow },
  dotPaused: { backgroundColor: colours.ledAmber },
  open: { fontFamily: fonts.bold },
});
