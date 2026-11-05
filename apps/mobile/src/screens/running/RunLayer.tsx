// A run on the phone (ROADMAP Stage 5 item 37a): Start, 3 2 1, the run with its big numbers, Pause
// and Auto-pause, Finish, and the summary to Save or Discard. It lies over every tab while a run goes
// on, so the person can look at the app and come back; the run itself is the recorder's.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, TextInput, Vibration, View } from "react-native";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RUN_MAX_POINTS, geodesicMetres, runSums, userProfileResponseSchema, type RunSums, type SaveRunRequest, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { PictureTop } from "../../look/PictureTop";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { newGoalId } from "../goals/words";
import { accountUnits } from "../setup/Setup";
import {
  RUN_TASK,
  closedPauses,
  elapsedMs,
  finishRun,
  forgetRun,
  loadRun,
  pauseRun,
  resumeRun,
  runIsFull,
  chooseAutoPause,
  runNow,
  startRun,
  subscribeRun,
  type LiveRun,
} from "./recorder";
import { PaceWave, RouteLine } from "./RunDrawings";
import { useRunOutbox } from "./RunOutbox";
import { EFFORT_ENDS, clock, distance, leftOutLine, pace, paceWord, runName, runWhen, unitWord, METRES_PER_MILE } from "./runWords";

/** What stood in the way of Start, said under it with its button. */
export type StartProblem = "denied" | "settings" | "approximate" | "off" | "failed";

export const START_PROBLEM_WORDS: Record<StartProblem, string> = {
  denied: "Allow location to record your run.",
  settings: "Location is off for this app. Turn it on in Settings.",
  approximate: "Turn on Precise location to measure your run.",
  off: "Turn on your phone's location to record your run.",
  failed: "Your run couldn't start. Try again.",
};

/** What a run tells the Running tab once it is saved, or waiting to be sent. */
export type RunDone = { name: string; waiting: boolean } | null;

interface RunLayerValue {
  /** Start: asks for the location if it must, then counts down. null when the count has begun. */
  start: (autoPause: boolean) => Promise<StartProblem | null>;
  /** Back to the run that is going on. */
  open: () => void;
  run: LiveRun | null;
  units: Units;
  done: RunDone;
  clearDone: () => void;
}

const RunLayerContext = createContext<RunLayerValue | null>(null);

export function useRunLayer(): RunLayerValue {
  const value = useContext(RunLayerContext);
  if (value === null) throw new Error("useRunLayer outside RunLayerProvider");
  return value;
}

const COUNT_FROM = 3;

/** The person's own run: shown only to them. */
function useMyRun(me: string | null): LiveRun | null {
  const run = useSyncExternalStore(subscribeRun, runNow);
  return run !== null && run.userId === me ? run : null;
}

/** Asks Android for the location, and says what stands in the way. */
export async function askLocation(): Promise<StartProblem | null> {
  if (!(await Location.hasServicesEnabledAsync())) return "off";
  let answer = await Location.getForegroundPermissionsAsync();
  if (!answer.granted) {
    if (!answer.canAskAgain) return "settings";
    answer = await Location.requestForegroundPermissionsAsync();
    if (!answer.granted) return answer.canAskAgain ? "denied" : "settings";
  } else if (answer.android?.accuracy === "coarse") {
    // Approximate given before this press: Android asks once more, with its own Precise button.
    answer = await Location.requestForegroundPermissionsAsync();
  }
  if (answer.android?.accuracy === "coarse") return "approximate";
  return null;
}

export function RunLayerProvider({ children }: { children: ReactNode }) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const units: Units = (state.kind === "in" ? accountUnits(state.user.units) : null) ?? "metric";
  const run = useMyRun(me);
  const [shown, setShown] = useState(true);
  const [counting, setCounting] = useState<{ autoPause: boolean } | null>(null);
  const [done, setDone] = useState<RunDone>(null);
  const [kg, setKg] = useState(0);

  // The run kept on the phone, once: after the app was closed, it is there to carry on or finish. A
  // run whose service Android stopped (the phone restarted) is paused where its last point was.
  useEffect(() => {
    if (me === null) return;
    void loadRun().then(async (kept) => {
      if (kept === null || kept.userId !== me || kept.phase !== "running") return;
      if (await Location.hasStartedLocationUpdatesAsync(RUN_TASK)) return;
      await pauseRun(kept.lastFix?.at ?? kept.startedAt);
    });
  }, [me]);

  // The person's weight, for the calories as the run goes (the server works them out again): read
  // when a run is there, never at every opening of the app.
  const hasRun = run !== null;
  const finished = run?.phase === "finished";
  useEffect(() => {
    if (me === null || !hasRun) return;
    void session.signedIn({ method: "GET", path: "/v1/users/me" }, userProfileResponseSchema).then((answer) => {
      if (answer.kind === "ok") setKg(answer.data.user.weightKg ?? 0);
    });
  }, [me, session, hasRun, finished]);

  const start = useCallback(async (autoPause: boolean): Promise<StartProblem | null> => {
    const problem = await askLocation();
    if (problem !== null) return problem;
    setDone(null);
    setShown(true);
    setCounting({ autoPause });
    return null;
  }, []);

  const go = useCallback(async () => {
    const count = counting;
    setCounting(null);
    if (count === null || me === null) return;
    Vibration.vibrate(300);
    try {
      await startRun(me, newGoalId(), count.autoPause);
    } catch {
      await forgetRun();
      setDone(null);
    }
  }, [counting, me]);

  const value = useMemo<RunLayerValue>(
    () => ({
      start,
      open: () => {
        setShown(true);
      },
      run,
      units,
      done,
      clearDone: () => {
        setDone(null);
      },
    }),
    [start, run, units, done],
  );

  return (
    <RunLayerContext.Provider value={value}>
      {children}
      <Modal visible={counting !== null || (run !== null && shown)} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => { setShown(false); }}>
        {counting !== null ? (
          <Countdown onGo={() => void go()} />
        ) : run === null ? null : run.phase === "finished" ? (
          <Summary
            run={run}
            units={units}
            kg={kg}
            onSaved={(name, waiting) => {
              setDone({ name, waiting });
            }}
          />
        ) : (
          <Live run={run} units={units} kg={kg} onHide={() => { setShown(false); }} />
        )}
      </Modal>
    </RunLayerContext.Provider>
  );
}

// ── 3, 2, 1 ───────────────────────────────────────────────────────────────────────────────────

function Countdown({ onGo }: { onGo: () => void }) {
  const [left, setLeft] = useState(COUNT_FROM);
  const went = useRef(false);
  useEffect(() => {
    if (left <= 0) {
      if (!went.current) {
        went.current = true;
        onGo();
      }
      return undefined;
    }
    const timer = setTimeout(() => {
      setLeft((n) => n - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [left, onGo]);
  return (
    <View style={styles.countPage}>
      <View style={styles.countRing} accessible accessibilityLabel={`Starting in ${String(Math.max(left, 1))}`}>
        <Txt style={styles.countNumber}>{String(Math.max(left, 1))}</Txt>
      </View>
      <Txt kind="body" colour="textSoft" style={styles.countWord}>
        Get ready
      </Txt>
      <Button
        kind="link"
        label="Start now"
        style={styles.startNow}
        onPress={() => {
          if (went.current) return;
          went.current = true;
          onGo();
        }}
      />
    </View>
  );
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────

/** Seconds a second ticks, and the run's numbers worked out again: often on a short run, less often
 *  on a long one, so the phone never labours. Only while the screen is on and the app in front. */
function useLiveNumbers(run: LiveRun, kg: number): { now: number; sums: RunSums | null } {
  const [now, setNow] = useState(Date.now());
  const [sums, setSums] = useState<RunSums | null>(null);
  const lastWork = useRef(0);
  useEffect(() => {
    let active = AppState.currentState !== "background";
    const heard = AppState.addEventListener("change", (next) => {
      active = next !== "background";
    });
    const timer = setInterval(() => {
      if (!active) return;
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
      heard.remove();
    };
  }, []);
  const count = run.points.length;
  useEffect(() => {
    if (runIsFull(run, now)) void finishRun();
  }, [run, now]);
  useEffect(() => {
    const every = 2000 + count * 0.1;
    if (sums !== null && now - lastWork.current < every) return;
    lastWork.current = now;
    setSums(runSums(run.points, closedPauses(run, elapsedMs(run, now)), elapsedMs(run, now), kg));
  }, [now, count, run, kg, sums]);
  return { now, sums };
}

/** The pace over the last ten seconds, from where the person was then to where they are. */
function paceNow(run: LiveRun, units: Units): string {
  if (run.phase !== "running") return "--:--";
  const last = run.points[run.points.length - 1];
  if (last === undefined) return "--:--";
  let from = last;
  for (let i = run.points.length - 1; i >= 0; i--) {
    const p = run.points[i];
    if (p === undefined) break;
    from = p;
    if (last[0] - p[0] >= 10_000) break;
  }
  const seconds = (last[0] - from[0]) / 1000;
  if (seconds < 5) return "--:--";
  return pace(seconds, geodesicMetres(from[1], from[2], last[1], last[2]), units);
}

type Gps = { word: string; tone: "good" | "weak" | "none" };
export function gpsLight(lastFix: LiveRun["lastFix"], now: number): Gps {
  if (lastFix === null || now - lastFix.at > 8000) return { word: "Finding GPS", tone: "none" };
  if (lastFix.accuracyM !== null && lastFix.accuracyM > 20) return { word: "Weak GPS", tone: "weak" };
  return { word: "GPS", tone: "good" };
}

function GpsPill({ gps }: { gps: Gps }) {
  return (
    <View style={styles.pill} accessible accessibilityLabel={gps.word}>
      <View style={[styles.dot, gps.tone === "good" ? styles.dotGood : gps.tone === "weak" ? styles.dotWeak : styles.dotNone]} />
      <Txt kind="small" colour="text">
        {gps.word}
      </Txt>
    </View>
  );
}

function Live({ run, units, kg, onHide }: { run: LiveRun; units: Units; kg: number; onHide: () => void }) {
  const insets = useSafeAreaInsets();
  const { now, sums } = useLiveNumbers(run, kg);
  const elapsed = elapsedMs(run, now);
  const paused = closedPauses(run, elapsedMs(run, now)).reduce((t, [a, b]) => t + (b - a), 0);
  // The same moving time the summary gives: standing with no pause pressed is left out too.
  const moving = Math.max(0, elapsed - paused - ((sums?.leftOutS ?? 0) + (sums?.stillS ?? 0)) * 1000) / 1000;
  const metres = sums?.distanceM ?? 0;
  const per = units === "imperial" ? METRES_PER_MILE : 1000;
  const isPaused = run.phase === "paused";
  const [busy, setBusy] = useState(false);
  const press = (work: () => Promise<unknown>) => () => {
    if (busy) return;
    setBusy(true);
    void work().finally(() => {
      setBusy(false);
    });
  };
  return (
    <View style={[styles.livePage, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
      {isPaused ? <View style={styles.pausedBar} /> : null}
      <View style={styles.liveTop}>
        {isPaused ? (
          <View style={styles.pausedRow}>
            <View style={styles.pausedTag}>
              <Txt kind="small" colour="orange">
                {run.pausedByPerson ? "Paused" : "Auto-paused"}
              </Txt>
            </View>
            {run.pausedByPerson ? null : (
              <Button kind="link" label="Turn off Auto-pause" onPress={press(() => chooseAutoPause(false))} />
            )}
          </View>
        ) : (
          <GpsPill gps={gpsLight(run.lastFix, now)} />
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Back to the app" onPress={onHide} hitSlop={10} style={styles.hide}>
          <Icon name="down" size={22} colour="textSoft" />
        </Pressable>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.liveNumbers}>
        <Txt kind="eyebrow" colour="textFaint">
          Time
        </Txt>
        <Txt style={[styles.bigTime, isPaused ? styles.dim : null]} fit numberOfLines={1}>
          {clock(moving)}
        </Txt>
        <View style={styles.distanceRow}>
          <View style={styles.grow}>
            <Txt kind="eyebrow" colour="textFaint">
              Distance
            </Txt>
            <Txt style={[styles.bigDistance, isPaused ? styles.dim : null]} fit numberOfLines={1}>
              {distance(metres, units)}
              <Txt style={styles.unit}> {unitWord(units)}</Txt>
            </Txt>
          </View>
          {sums !== null && sums.track.length > 1 ? (
            <View style={styles.trace}>
              <RouteLine track={sums.track} starts={sums.trackStarts} units={units} height={110} marks={false} live={run.phase === "running"} testID="live-route" />
            </View>
          ) : null}
        </View>
        <View style={styles.pairs}>
          <Figure label="Current pace" value={paceNow(run, units)} unit={paceWord(units)} dim={isPaused} />
          {/* No average until there is ground to average: a standing start reads as no pace. */}
          <Figure label="Average pace" value={pace(moving, metres < 50 ? 0 : metres, units)} unit={paceWord(units)} dim={isPaused} />
        </View>
        <View style={styles.pairs}>
          <Figure label="Calories" value={String(sums?.kcal ?? 0)} dim={isPaused} />
          <Figure label={units === "imperial" ? "This mile" : "This km"} value={distance(metres % per, units)} unit={unitWord(units)} dim={isPaused} />
        </View>
      </ScrollView>
      <View style={styles.controls}>
        {isPaused ? (
          <>
            <RoundButton key="finish" label="Finish" kind="ghost" busy={busy} onPress={press(() => finishRun())} />
            <RoundButton key="resume" label="Resume" kind="main" busy={busy} onPress={press(() => resumeRun())} />
          </>
        ) : (
          <RoundButton key="pause" label="Pause" kind="main" busy={busy} onPress={press(() => pauseRun())} />
        )}
      </View>
    </View>
  );
}

function Figure({ label, value, unit, dim }: { label: string; value: string; unit?: string; dim: boolean }) {
  return (
    <View style={styles.figure}>
      <Txt kind="eyebrow" colour="textFaint">
        {label}
      </Txt>
      <Txt style={[styles.figureValue, dim ? styles.dim : null]} fit numberOfLines={1}>
        {value}
        {unit === undefined ? null : <Txt style={styles.figureUnit}> {unit}</Txt>}
      </Txt>
    </View>
  );
}

function RoundButton({ label, kind, onPress, busy }: { label: "Pause" | "Resume" | "Finish"; kind: "main" | "ghost"; onPress: () => void; busy: boolean }) {
  return (
    <View style={styles.roundWrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy }}
        onPress={onPress}
        style={({ pressed }) => [styles.round, kind === "main" ? styles.roundMain : styles.roundGhost, pressed ? styles.pressed : null]}
      >
        {label === "Pause" ? (
          <View style={styles.pauseMark}>
            <View style={styles.pauseBar} />
            <View style={styles.pauseBar} />
          </View>
        ) : label === "Finish" ? (
          <View style={styles.stopMark} />
        ) : (
          <Icon name="play" size={34} colour="onOrange" />
        )}
      </Pressable>
      <Txt kind="small" colour="textSoft" style={styles.roundLabel}>
        {label}
      </Txt>
    </View>
  );
}

// ── After Finish ──────────────────────────────────────────────────────────────────────────────

function Summary({ run, units, kg, onSaved }: { run: LiveRun; units: Units; kg: number; onSaved: (name: string, waiting: boolean) => void }) {
  const { outbox } = useRunOutbox();
  const insets = useSafeAreaInsets();
  const finished = run.finishedMs ?? 0;
  const sums = useMemo(() => runSums(run.points, closedPauses(run, finished), finished, kg), [run, finished, kg]);
  const startedAt = new Date(run.startedAt);
  const [name, setName] = useState(runName(startedAt));
  const [naming, setNaming] = useState(false);
  const [effort, setEffort] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notKept, setNotKept] = useState(false);
  const pausedS = Math.max(0, sums.elapsedS - sums.movingS - sums.leftOutS);

  const save = async () => {
    if (outbox === null || busy) return;
    setBusy(true);
    const kept = name.trim() === "" ? runName(startedAt) : name.trim().slice(0, 60);
    const body: SaveRunRequest = {
      runId: run.runId,
      startedAt: startedAt.toISOString(),
      elapsedMs: Math.round(finished),
      name: kept,
      effort,
      note: note.trim() === "" ? null : note.trim().slice(0, 1000),
      points: run.points.slice(0, RUN_MAX_POINTS).map(([at, lat, lng, acc]) => [Math.round(at), lat, lng, acc]),
      pauses: closedPauses(run, finished).map(([a, b]) => [Math.round(a), Math.round(b)]),
    };
    // The recorder's own files go only once the outbox holds the run on the phone (round one, L1).
    if (!(await outbox.add(body))) {
      setBusy(false);
      setNotKept(true);
      return;
    }
    await forgetRun();
    await outbox.send();
    onSaved(kept, outbox.view().waiting.some((r) => r.runId === body.runId));
  };

  return (
    <View style={styles.summaryPage}>
      <ScrollView contentContainerStyle={[styles.summaryBody, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.bleed}>
          <PictureTop
            picture="greekrun"
            tall={0.7}
            eyebrow={runWhen(startedAt)}
            foot={
              naming ? (
                <View style={styles.nameBox}>
                  <TextInput
                    accessibilityLabel="Run name"
                    value={name}
                    onChangeText={setName}
                    maxLength={60}
                    autoFocus
                    onSubmitEditing={() => {
                      setNaming(false);
                    }}
                    onBlur={() => {
                      setNaming(false);
                    }}
                    style={styles.nameInput}
                    selectionColor={colours.orange}
                  />
                </View>
              ) : (
                <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${name}`} onPress={() => { setNaming(true); }} style={styles.nameRow}>
                  <Txt kind="hero" numberOfLines={2} style={styles.nameText}>
                    {name}
                  </Txt>
                  <View style={styles.pen}>
                    <Icon name="pen" size={14} />
                  </View>
                </Pressable>
              )
            }
          />
        </View>
        <Txt style={styles.km} fit numberOfLines={1}>
          {distance(sums.distanceM, units)}
          <Txt style={styles.kmUnit}> {unitWord(units)}</Txt>
        </Txt>
        <View style={styles.three}>
          <Tile value={clock(sums.movingS)} label="Moving time" />
          <Tile value={clock(sums.elapsedS)} label="Total time" />
        </View>
        <View style={styles.three}>
          <Tile value={pace(sums.movingS, sums.distanceM < 50 ? 0 : sums.distanceM, units)} label={`Avg pace ${paceWord(units)}`} />
          <Tile value={String(sums.kcal)} label="Calories" />
        </View>
        {pausedS > 0 ? (
          <Txt kind="small" colour="textFaint">
            {`Paused for ${clock(pausedS)}`}
          </Txt>
        ) : null}
        {sums.leftOutM > 0 ? (
          <View style={styles.leftOut}>
            <Icon name="warn" size={18} colour="gold" />
            <Txt kind="small" colour="text" style={styles.grow}>
              {leftOutLine(sums.leftOutM, units)}
            </Txt>
          </View>
        ) : null}
        {sums.track.length > 1 ? (
          <View style={styles.card}>
            <Txt kind="h3">Route</Txt>
            <View style={styles.routeBox}>
              <RouteLine track={sums.track} starts={sums.trackStarts} units={units} height={200} testID="summary-route" />
            </View>
          </View>
        ) : null}
        {/* A wave needs two to compare: a run under two kilometres or miles has its pace above. */}
        {(units === "imperial" ? sums.splitsMi : sums.splitsKm).length > 1 ? (
          <View style={styles.card}>
            <Txt kind="h3">{units === "imperial" ? "Miles" : "Kilometres"}</Txt>
            <PaceWave splits={units === "imperial" ? sums.splitsMi : sums.splitsKm} units={units} />
            <Txt kind="small" colour="textFaint">
              Higher is faster
            </Txt>
          </View>
        ) : null}
        <View style={styles.card}>
          <Txt kind="h3">How did it feel?</Txt>
          <View style={styles.feel}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <Pressable
                key={String(n)}
                accessibilityRole="button"
                accessibilityLabel={`${String(n)} of 10`}
                accessibilityState={{ selected: effort === n }}
                onPress={() => {
                  setEffort(effort === n ? null : n);
                }}
                style={[styles.feelDot, effort === n ? styles.feelPicked : null]}
              >
                <Txt kind="small" colour={effort === n ? "onOrange" : "textSoft"} style={styles.feelNumber}>
                  {String(n)}
                </Txt>
              </Pressable>
            ))}
          </View>
          <View style={styles.ends}>
            <Txt kind="small" colour="textFaint">
              {EFFORT_ENDS[0]}
            </Txt>
            <Txt kind="small" colour="textFaint">
              {EFFORT_ENDS[1]}
            </Txt>
          </View>
        </View>
        <View style={styles.card}>
          <View style={styles.between}>
            <Txt kind="h3">Private note</Txt>
            <Txt kind="small" colour="textFaint">
              Only you see it
            </Txt>
          </View>
          <TextInput
            accessibilityLabel="Private note"
            value={note}
            onChangeText={setNote}
            placeholder="Add a note"
            placeholderTextColor={colours.textFaint}
            maxLength={1000}
            multiline
            style={styles.note}
            selectionColor={colours.orange}
          />
        </View>
        <Button label="Save run" onPress={() => void save()} busy={busy} wide style={styles.save} />
        {notKept ? (
          <Txt kind="small" colour="badText" style={styles.centredWords}>
            Your run couldn't be kept on this phone. Press Save run again.
          </Txt>
        ) : null}
        <Button
          kind="dangerLink"
          label="Discard run"
          style={styles.centred}
          onPress={() => {
            setAsking(true);
          }}
        />
      </ScrollView>
      <Sheet
        open={asking}
        title="Discard this run?"
        onClose={() => {
          setAsking(false);
        }}
      >
        <Txt kind="body" colour="textSoft">
          {`${distance(sums.distanceM, units)} ${unitWord(units)} in ${clock(sums.movingS)} won't be saved.`}
        </Txt>
        <Button
          kind="danger"
          label="Discard run"
          wide
          onPress={() => {
            setAsking(false);
            void forgetRun();
          }}
        />
        <Button
          kind="link"
          label="Keep run"
          style={styles.centred}
          onPress={() => {
            setAsking(false);
          }}
        />
      </Sheet>
    </View>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Txt style={styles.tileValue} fit numberOfLines={1}>
        {value}
      </Txt>
      <Txt kind="small" colour="textFaint" numberOfLines={2}>
        {label}
      </Txt>
    </View>
  );
}

/** Opens Android's settings for this app, where location is turned on. */
export const openAppSettings = (): void => {
  void Linking.openSettings();
};

const styles = StyleSheet.create({
  grow: { flex: 1 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dim: { color: colours.textDim },
  pressed: { opacity: 0.85 },
  // 3, 2, 1
  countPage: { flex: 1, backgroundColor: colours.page, alignItems: "center", justifyContent: "center", gap: 18 },
  countRing: {
    width: 240,
    height: 240,
    borderRadius: sizes.round,
    borderWidth: 3,
    borderColor: colours.orange,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: shadows.roundButton,
  },
  countNumber: { fontFamily: fonts.bold, fontSize: 140, lineHeight: 160, color: colours.text },
  countWord: { marginTop: 18 },
  startNow: { alignSelf: "center" },
  // The run
  livePage: { flex: 1, backgroundColor: colours.page, paddingHorizontal: 22 },
  pausedBar: { position: "absolute", top: 0, left: 0, right: 0, height: 5, backgroundColor: colours.orange, boxShadow: shadows.dotGlow },
  liveTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: sizes.press },
  hide: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center" },
  pill: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: sizes.round, backgroundColor: colours.veil, borderWidth: 1, borderColor: colours.lineStrong },
  dot: { width: 8, height: 8, borderRadius: sizes.round },
  dotGood: { backgroundColor: colours.good, boxShadow: `0 0 10px ${colours.good}` },
  dotWeak: { backgroundColor: colours.gold },
  dotNone: { backgroundColor: colours.textFaint },
  pausedRow: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  pausedTag: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: sizes.round, backgroundColor: colours.orangeFill, borderWidth: 1, borderColor: colours.orangeLine },
  liveNumbers: { paddingTop: 22, gap: 6, paddingBottom: 24 },
  bigTime: { fontFamily: fonts.bold, fontSize: 92, lineHeight: 100, letterSpacing: -3, color: colours.text },
  distanceRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 18 },
  bigDistance: { fontFamily: fonts.bold, fontSize: 62, lineHeight: 70, letterSpacing: -2, color: colours.text },
  unit: { fontFamily: fonts.semibold, fontSize: 22, color: colours.textSoft, letterSpacing: 0 },
  trace: { width: 120 },
  pairs: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colours.line, marginTop: 22, paddingTop: 18 },
  figure: { flex: 1, gap: 6 },
  figureValue: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 40, letterSpacing: -1, color: colours.text },
  figureUnit: { fontFamily: fonts.semibold, fontSize: 15, color: colours.textSoft, letterSpacing: 0 },
  controls: { flexDirection: "row", justifyContent: "center", gap: 38, paddingTop: 12 },
  roundWrap: { alignItems: "center" },
  round: { width: 96, height: 96, borderRadius: sizes.round, alignItems: "center", justifyContent: "center" },
  // Both keep a border of one width: Android stops the app when a view gains a gradient as its
  // border goes (React Native's BackgroundImageDrawable, seen on the moto g35).
  roundMain: { experimental_backgroundImage: orangeGradient, borderWidth: 2, borderColor: "transparent", boxShadow: shadows.roundButton },
  roundGhost: { borderWidth: 2, borderColor: colours.grab, backgroundColor: colours.fill },
  roundLabel: { marginTop: 10, fontFamily: fonts.bold },
  pauseMark: { flexDirection: "row", gap: 9 },
  pauseBar: { width: 9, height: 30, borderRadius: 3, backgroundColor: colours.onOrange },
  stopMark: { width: 26, height: 26, borderRadius: 5, backgroundColor: colours.text },
  // After Finish
  summaryPage: { flex: 1, backgroundColor: colours.page },
  summaryBody: { paddingHorizontal: sizes.edge, gap: 14 },
  bleed: { marginHorizontal: -sizes.edge },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  nameText: { flexShrink: 1 },
  pen: { width: 32, height: 32, borderRadius: sizes.round, alignItems: "center", justifyContent: "center", backgroundColor: colours.veil, borderWidth: 1, borderColor: colours.grab },
  nameBox: { borderRadius: 14, backgroundColor: colours.overWords, borderWidth: 1, borderColor: colours.fieldOnLine, paddingHorizontal: 12, minHeight: 48, justifyContent: "center" },
  nameInput: { fontFamily: fonts.bold, fontSize: 24, color: colours.text, paddingVertical: 8 },
  km: { fontFamily: fonts.bold, fontSize: 72, lineHeight: 80, letterSpacing: -3, color: colours.text },
  kmUnit: { fontFamily: fonts.semibold, fontSize: 26, color: colours.textSoft, letterSpacing: 0 },
  three: { flexDirection: "row", gap: 10 },
  tile: { flex: 1, borderRadius: 16, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 12, gap: 2, minHeight: 72 },
  tileValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colours.text },
  leftOut: { flexDirection: "row", gap: 10, alignItems: "flex-start", borderRadius: 16, padding: 13, backgroundColor: colours.goldFill, borderWidth: 1, borderColor: colours.goldLine },
  card: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 16, gap: 12 },
  routeBox: { borderRadius: 14, backgroundColor: colours.tabBar, borderWidth: 1, borderColor: colours.line, overflow: "hidden" },
  feel: { flexDirection: "row", gap: 5 },
  feelDot: { flex: 1, minHeight: sizes.press, borderRadius: sizes.round, alignItems: "center", justifyContent: "center", backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  feelPicked: { experimental_backgroundImage: orangeGradient, borderColor: "transparent", boxShadow: shadows.chip },
  feelNumber: { fontFamily: fonts.bold },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  note: { minHeight: 74, borderRadius: 14, backgroundColor: colours.field, borderWidth: 1, borderColor: colours.fieldLine, padding: 14, fontFamily: fonts.regular, fontSize: 15, color: colours.text, textAlignVertical: "top" },
  save: { marginTop: 10 },
  centred: { alignSelf: "center" },
  centredWords: { textAlign: "center" },
});
