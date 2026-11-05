// The Workout tab's Running page (ROADMAP Stage 5 item 37a): the GPS light, the last run, Start,
// Auto-pause and the units. The run itself opens over the app (RunLayer).
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, View } from "react-native";
import * as Location from "expo-location";
import { useIsFocused } from "@react-navigation/native";
import { runPageSchema, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { useRead } from "../dashboard/useRead";
import { SettingsPage } from "../Settings";
import { phoneRunFiles, setAutoPause as setRunAutoPause } from "./recorder";
import { gpsLight, openAppSettings, START_PROBLEM_WORDS, useRunLayer, type StartProblem } from "./RunLayer";
import { useRunOutbox } from "./RunOutbox";
import { clock, distance, unitWord } from "./runWords";

const SETTINGS_FILE = "run-settings.json";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Auto-pause on or off, kept on the phone for the next run. On until the person turns it off. */
function useAutoPauseChoice(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    void phoneRunFiles.read(SETTINGS_FILE).then((text) => {
      if (text === null) return;
      try {
        const kept: unknown = JSON.parse(text);
        if (typeof kept === "object" && kept !== null && Reflect.get(kept, "autoPause") === false) setOn(false);
      } catch {
        // A file that cannot be read keeps the choice as it is.
      }
    }, () => undefined);
  }, []);
  return [
    on,
    (next) => {
      setOn(next);
      void phoneRunFiles.write(SETTINGS_FILE, JSON.stringify({ autoPause: next })).catch(() => undefined);
    },
  ];
}

/** The GPS light before a run: only while the page is on screen and the person already allowed it. */
function useGpsBefore(watching: boolean, asked: number): ReturnType<typeof gpsLight> | null {
  const [fix, setFix] = useState<{ at: number; accuracyM: number | null } | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!watching) return undefined;
    let stop: (() => void) | null = null;
    const page = { gone: false };
    // Read through a function: the page may be gone by the time the watch has begun.
    const isGone = () => page.gone;
    void Location.getForegroundPermissionsAsync().then(async (answer) => {
      if (page.gone || !answer.granted) return;
      setAllowed(true);
      const sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 }, (where) => {
        setFix({ at: where.timestamp, accuracyM: where.coords.accuracy ?? null });
      });
      if (isGone()) sub.remove();
      else stop = () => {
        sub.remove();
      };
    }, () => undefined);
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 2000);
    return () => {
      page.gone = true;
      stop?.();
      clearInterval(timer);
    };
    // Asked again after each Start, so a location allowed at Start lights it at once.
  }, [watching, asked]);
  return allowed ? gpsLight(fix, now) : null;
}

export function RunningTab({ units }: { units: Units }) {
  const focused = useIsFocused();
  const layer = useRunLayer();
  const { view, outbox } = useRunOutbox();
  const [autoPause, setAutoPause] = useAutoPauseChoice();
  const [problem, setProblem] = useState<StartProblem | null>(null);
  const [settings, setSettings] = useState(false);
  const going = layer.run !== null;
  // A run going on shows its own Auto-pause, and the switch changes it at once (Kd, 37a's click-through).
  const shownAuto = layer.run !== null && layer.run.phase !== "finished" ? layer.run.autoPause : autoPause;
  const [asked, setAsked] = useState(0);
  const gps = useGpsBefore(focused && !going, asked);
  const last = useRead("/v1/geo/runs?limit=1", runPageSchema, view.sent);
  const lastRun = last.read.kind === "ok" ? (last.read.data.items[0] ?? null) : null;

  const start = async () => {
    setProblem(null);
    const said = await layer.start(autoPause);
    setProblem(said);
    setAsked((n) => n + 1);
  };

  return (
    <View style={styles.page}>
      {gps === null ? null : (
        <View style={styles.pill} accessible accessibilityLabel={gps.word === "GPS" ? "GPS ready" : gps.word}>
          <View style={[styles.dot, gps.tone === "good" ? styles.dotGood : gps.tone === "weak" ? styles.dotWeak : styles.dotNone]} />
          <Txt kind="small">{gps.word === "GPS" ? "GPS ready" : gps.word}</Txt>
        </View>
      )}
      {lastRun === null ? null : (
        <Txt kind="small" colour="textSoft">
          {`Last run · ${DAYS[new Date(lastRun.startedAt).getDay()] ?? ""} · ${distance(lastRun.distanceM, units)} ${unitWord(units)} in ${clock(lastRun.durationS)}`}
        </Txt>
      )}
      <View style={styles.rows}>
        <View style={styles.row}>
          <View style={styles.grow}>
            <Txt kind="body">Auto-pause</Txt>
            <Txt kind="small" colour="textFaint">
              Stops the clock when you stop
            </Txt>
          </View>
          <Switch
            accessibilityLabel="Auto-pause"
            value={shownAuto}
            onValueChange={(on) => {
              setAutoPause(on);
              void setRunAutoPause(on);
            }}
            trackColor={{ false: colours.lineStrong, true: colours.orange }}
            thumbColor={colours.text}
          />
        </View>
        <View style={[styles.row, styles.rowLine]}>
          <View style={styles.grow}>
            <Txt kind="body">Units</Txt>
            <Txt kind="small" colour="textFaint">
              {units === "imperial" ? "Miles" : "Kilometres"}
            </Txt>
          </View>
          <Button
            kind="link"
            label="Change"
            say="Change units"
            onPress={() => {
              setSettings(true);
            }}
          />
        </View>
      </View>
      {going ? (
        <View style={styles.centre}>
          <Txt kind="h3">{layer.run?.phase === "finished" ? "Your run is waiting to be saved." : "Your run is going."}</Txt>
          <Button label="Open run" onPress={layer.open} />
        </View>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Start run" onPress={() => void start()} style={({ pressed }) => [styles.go, pressed ? styles.pressed : null]}>
          <Txt style={styles.goWord}>START</Txt>
        </Pressable>
      )}
      {problem === null ? null : (
        <View style={styles.problem}>
          <Txt kind="small" colour="badText">
            {START_PROBLEM_WORDS[problem]}
          </Txt>
          {problem === "approximate" ? (
            <View style={styles.choices}>
              <Button kind="link" label="Allow precise location" onPress={() => void start()} />
              <Button kind="quiet" label="Open settings" onPress={openAppSettings} />
            </View>
          ) : problem === "settings" ? (
            <Button kind="link" label="Open settings" onPress={openAppSettings} />
          ) : problem === "denied" ? (
            <Button kind="link" label="Allow location" onPress={() => void start()} />
          ) : null}
        </View>
      )}
      {layer.done === null ? null : (
        <Txt kind="small" colour={layer.done.waiting ? "textSoft" : "goodText"} style={styles.said}>
          {layer.done.waiting ? `${layer.done.name} is saved on this phone. It will be sent when you're online.` : `${layer.done.name} is saved.`}
        </Txt>
      )}
      {view.refused.map((r) => (
        <View key={r.runId} style={styles.problem}>
          <Txt kind="small" colour="badText">
            {`${r.name}: ${r.message}`}
          </Txt>
          <Button
            kind="quiet"
            label="OK"
            onPress={() => {
              outbox?.forgetRefused(r.runId);
            }}
          />
        </View>
      ))}
      <SettingsPage
        open={settings}
        onClose={() => {
          setSettings(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  grow: { flex: 1 },
  pressed: { opacity: 0.88 },
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 7, borderRadius: sizes.round, backgroundColor: colours.veil, borderWidth: 1, borderColor: colours.lineStrong },
  dot: { width: 8, height: 8, borderRadius: sizes.round },
  dotGood: { backgroundColor: colours.good, boxShadow: `0 0 10px ${colours.good}` },
  dotWeak: { backgroundColor: colours.gold },
  dotNone: { backgroundColor: colours.textFaint },
  centre: { alignItems: "center", gap: 12, paddingVertical: 18 },
  go: {
    alignSelf: "center",
    width: 132,
    height: 132,
    marginVertical: 22,
    borderRadius: sizes.round,
    alignItems: "center",
    justifyContent: "center",
    experimental_backgroundImage: orangeGradient,
    boxShadow: shadows.roundButton,
  },
  goWord: { fontFamily: fonts.bold, fontSize: 21, letterSpacing: 0.5, color: colours.onOrange },
  problem: { gap: 4, alignItems: "flex-start" },
  choices: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  said: { textAlign: "center" },
  rows: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 },
  rowLine: { borderTopWidth: 1, borderTopColor: colours.line },
});
