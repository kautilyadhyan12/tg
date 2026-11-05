// The Workout tab's Running page (ROADMAP Stage 5 item 37a): the GPS light, the last run, Start,
// Auto-pause, the voice (37a-ii) and the units. The run itself opens over the app (RunLayer).
import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Linking, Pressable, StyleSheet, Switch, View } from "react-native";
import * as Location from "expo-location";
import { useIsFocused } from "@react-navigation/native";
import { runPageSchema, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { Sheet } from "../../look/Sheet";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { fonts, Txt } from "../../look/Txt";
import { useRead } from "../dashboard/useRead";
import { SettingsPage } from "../Settings";
import { autoPauseChoice, chooseAutoPause, chooseVoice, readRunChoices, subscribeRun, voiceChoice } from "./recorder";
import { gpsLight, openAppSettings, START_PROBLEM_WORDS, useRunLayer, type StartProblem } from "./RunLayer";
import { useRunOutbox } from "./RunOutbox";
import { runVoiceNative } from "./runVoiceNative";
import { clock, distance, unitWord } from "./runWords";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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
      // Refused when the person said No, thanks to Android's location accuracy: the light stays
      // on Finding GPS, and Start asks again.
    }).catch(() => undefined);
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

/** `showEnd` scrolls the page to its end: what Start says, and a run just saved, are said under
 *  START, which on a phone sits at the screen's foot (37a-ii, found on Kd's phone). */
export function RunningTab({ units, showEnd }: { units: Units; showEnd?: () => void }) {
  const focused = useIsFocused();
  const layer = useRunLayer();
  const { view, outbox } = useRunOutbox();
  const autoPause = useSyncExternalStore(subscribeRun, autoPauseChoice);
  const voiceOn = useSyncExternalStore(subscribeRun, voiceChoice);
  useEffect(() => {
    void readRunChoices();
  }, []);
  const canSpeak = useCanSpeak(focused && voiceOn);
  const [problem, setProblem] = useState<StartProblem | null>(null);
  const [settings, setSettings] = useState(false);
  const [removing, setRemoving] = useState<{ runId: string; name: string } | null>(null);
  const going = layer.run !== null;
  // A run going on shows its own Auto-pause, and the switch changes it at once (Kd, 37a's click-through).
  const shownAuto = layer.run !== null && layer.run.phase !== "finished" ? layer.run.autoPause : autoPause;
  const [asked, setAsked] = useState(0);
  const gps = useGpsBefore(focused && !going, asked);
  const last = useRead("/v1/geo/runs?limit=1", runPageSchema, view.sent);
  const lastRun = last.read.kind === "ok" ? (last.read.data.items[0] ?? null) : null;

  const saidUnderStart = problem !== null || layer.done !== null || view.refused.length > 0;
  useEffect(() => {
    if (saidUnderStart) showEnd?.();
  }, [saidUnderStart, problem, layer.done, showEnd]);

  const start = async () => {
    setProblem(null);
    const said = await layer.start(autoPause);
    setProblem(said);
    setAsked((n) => n + 1);
  };

  return (
    <View style={styles.page}>
      {gps === null || going ? null : (
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
              void chooseAutoPause(on);
            }}
            trackColor={{ false: colours.lineStrong, true: colours.orange }}
            thumbColor={colours.text}
          />
        </View>
        <View style={[styles.row, styles.rowLine]}>
          <View style={styles.grow}>
            <Txt kind="body">Voice</Txt>
            <Txt kind="small" colour="textFaint">
              {units === "imperial" ? "Your time and pace each mile" : "Your time and pace each kilometre"}
            </Txt>
            {voiceOn && !canSpeak ? (
              <View style={styles.problem}>
                <Txt kind="small" colour="badText">
                  Text-to-speech is off on this phone.
                </Txt>
                <Button kind="link" label="Turn it on" say="Open text-to-speech settings" onPress={openSpeechSettings} />
              </View>
            ) : null}
          </View>
          <Switch
            accessibilityLabel="Voice"
            value={voiceOn}
            onValueChange={(on) => {
              void chooseVoice(on);
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
          <Button label="Open run" onPress={layer.open} style={styles.middle} />
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
          ) : problem === "off" ? (
            <Button kind="link" label="Turn on location" onPress={() => void turnOnLocation().then((on) => (on ? start() : undefined))} />
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
          <View style={styles.choices}>
            {r.run === undefined ? null : (
              <Button
                kind="link"
                label="Try again"
                say={`Send ${r.name} again`}
                onPress={() => {
                  void outbox?.retryRefused(r.runId).then(() => outbox.send());
                }}
              />
            )}
            <Button
              kind="dangerLink"
              label="Remove"
              say={`Remove ${r.name}`}
              onPress={() => {
                setRemoving({ runId: r.runId, name: r.name });
              }}
            />
          </View>
        </View>
      ))}
      <Sheet
        open={removing !== null}
        title="Remove this run?"
        onClose={() => {
          setRemoving(null);
        }}
      >
        <Txt kind="body" colour="textSoft">
          {`${removing?.name ?? "This run"} will be deleted from this phone. It was never saved.`}
        </Txt>
        <Button
          kind="danger"
          label="Remove run"
          wide
          onPress={() => {
            if (removing !== null) outbox?.removeRefused(removing.runId);
            setRemoving(null);
          }}
        />
        <Button
          kind="link"
          label="Keep it"
          style={styles.middle}
          onPress={() => {
            setRemoving(null);
          }}
        />
      </Sheet>
      <SettingsPage
        open={settings}
        onClose={() => {
          setSettings(false);
        }}
      />
    </View>
  );
}

/** Whether the phone can speak, asked while the Voice switch is on and the page shown, and again
 *  when the person comes back from the phone's settings. A phone with no voice code of this app's
 *  (none on an iPhone yet) is not told its text-to-speech is off. */
function useCanSpeak(asking: boolean): boolean {
  const [can, setCan] = useState(true);
  const [back, setBack] = useState(0);
  useEffect(() => {
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") setBack((n) => n + 1);
    });
    return () => {
      heard.remove();
    };
  }, []);
  useEffect(() => {
    if (!asking || runVoiceNative === null) return;
    let live = true;
    void runVoiceNative.check().then(
      (yes) => {
        if (live) setCan(yes);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [asking, back]);
  return can;
}

/** The phone's location turned on in Android's own box (Google's, as the GPS light asks); its
 *  Location page where a phone has no such box. True once it is on. */
async function turnOnLocation(): Promise<boolean> {
  try {
    await Location.enableNetworkProviderAsync();
    return true;
  } catch {
    await Linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS").catch(() => Linking.openSettings());
    return false;
  }
}

/** Android's own Text-to-speech page; the app's settings where a phone has none by that name. */
const openSpeechSettings = (): void => {
  void Linking.sendIntent("com.android.settings.TTS_SETTINGS").catch(() => Linking.openSettings());
};

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
  middle: { alignSelf: "center" },
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
