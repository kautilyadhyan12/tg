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
import { effortWaitingFile, workoutRunFile, workoutsWaitingFile } from "../../library/files";
import { effortSender, effortWaiting, type EffortWaiting } from "../../library/effortSaving";
import type { Units } from "../../library/records";
import { newWorkoutId } from "../../library/workoutId";
import { setOf, shownAt, type Press } from "../../library/workoutRun";
import { createRunStore, type Finished, type RunStore, type StartResult } from "../../library/workoutRunStore";
import { workoutSender, workoutWaiting, type WorkoutWaiting } from "../../library/workoutSaving";
import type { WaitingView } from "../../session/waitingList";
import { useSession } from "../../session/SessionProvider";
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
  /** The workout being done, its clocks moved on to now; null for none. */
  run: WorkoutRun | null;
  finished: Finished | null;
  waiting: WaitingView<WorkoutSave, RefusedWorkout>;
  /** Starts a workout and opens its screen: "busy" where one is going on, or the last one is still being kept. */
  start: (name: string, exercises: readonly RunExercise[]) => StartResult;
  open: () => void;
  dismissRefused: (id: string) => void;
}

const NONE_WAITING: WaitingView<WorkoutSave, RefusedWorkout> = { waiting: [], refused: [], sent: [], held: false, unsaved: false };
const Context = createContext<WorkoutLayerValue | null>(null);

/** The workout layer; null outside the tabs (a screen test of one page). */
export const useWorkoutLayer = (): WorkoutLayerValue | null => useContext(Context);

export interface WorkoutFiles {
  run: (userId: string) => TextStore;
  waiting: (userId: string) => TextStore;
  effort: (userId: string) => TextStore;
}

const PHONE_FILES: WorkoutFiles = { run: workoutRunFile, waiting: workoutsWaitingFile, effort: effortWaitingFile };
const NONE_EFFORT: WaitingView<WaitingEffort, WaitingEffort> = { waiting: [], refused: [], sent: [], held: false, unsaved: false };

/** The stars of a finished workout, on its last screen: what waits for the server, and a press. */
export interface EffortHand {
  view: WaitingView<WaitingEffort, WaitingEffort>;
  give: (workoutId: string, stars: number) => void;
}

export function WorkoutLayerProvider({ children, files = PHONE_FILES, onNewWorkout }: { children: ReactNode; files?: WorkoutFiles; onNewWorkout?: () => void }) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const units: Units = (state.kind === "in" ? accountUnits(state.user.units) : null) ?? "metric";
  const [made, setMade] = useState<{ store: RunStore; waiting: WorkoutWaiting; effort: EffortWaiting } | null>(null);
  const [shown, setShown] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // One store and one list for each person, made again when somebody else signs in, stopped when they leave.
  useEffect(() => {
    if (me === null) return undefined;
    const waiting = workoutWaiting(files.waiting(me), workoutSender((request, shape) => session.signedIn(request, shape)));
    const store = createRunStore({ file: files.run(me), waiting, platform: Platform.OS === "ios" ? "ios" : "android", appVersion: appVersion(), clock: Date.now });
    // The stars wait while their workout is still on the phone, and go as soon as it is on the server.
    const effort = effortWaiting(
      files.effort(me),
      effortSender((request, shape) => session.signedIn(request, shape), (id) => store.keeping() === id || waiting.view().waiting.some((w) => w.workoutId === id)),
    );
    setMade({ store, waiting, effort });
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
    }, SEND_AGAIN_MS);
    const heard = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      store.press({ kind: "back" }, Date.now());
      store.retry();
      void waiting.send(true);
      void effort.send(true);
    });
    return () => {
      waiting.stop();
      effort.stop();
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
  const pressed = useRef(0);
  const effortHand = useMemo<EffortHand>(
    () => ({
      view: stars,
      give: (workoutId, n) => {
        const list = made?.effort;
        if (list === undefined) return;
        pressed.current += 1;
        void list.add({ id: `${workoutId}.${String(Date.now())}.${String(pressed.current)}`, workoutId, effort: n }).then(() => list.send(true));
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
  const value = useMemo<WorkoutLayerValue>(
    () => ({
      run,
      finished,
      waiting,
      start: (name, exercises) => {
        if (store === null) return "busy";
        const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = store.start({ workoutId: newWorkoutId(), name, now: Date.now(), timeZone: zone === "" ? "UTC" : zone, exercises });
        if (result === "started") setShown(true);
        return result;
      },
      open: () => {
        setShown(true);
      },
      dismissRefused: (id) => {
        made?.waiting.dismiss(id);
      },
    }),
    [run, finished, waiting, store, made],
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
