// The Workout tab's Running page (ROADMAP Stage 5 item 37a): the GPS light, Your runs (37c-i: the last
// run, and See all), Start, Auto-pause, the voice (37a-ii) and the units. The run itself opens over the
// app (RunLayer).
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import * as Location from "expo-location";
import { useIsFocused } from "@react-navigation/native";
import { runPageSchema, runRecordsSchema, type MapColours, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { Options } from "../../look/Choice";
import { Sheet } from "../../look/Sheet";
import { colours, dockShade, orangeGradient, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Page } from "../../look/Page";
import { PictureTop } from "../../look/PictureTop";
import { fonts, Txt } from "../../look/Txt";
import { useRead } from "../dashboard/useRead";
import { SettingsPage } from "../Settings";
import { autoPauseChoice, chooseAutoPause, chooseMapColours, chooseVoice, mapColoursChoice, readRunChoices, subscribeRun, voiceChoice } from "./recorder";
import { RefusedRuns } from "./RefusedRuns";
import { RUN_BAR_ROOM, gpsLight, openAppSettings, START_PROBLEM_WORDS, useRunLayer, type StartProblem } from "./RunLayer";
import { useRunOutbox } from "./RunOutbox";
import { useLookOpen } from "../setupFirst";
import { RunPage } from "./RunPage";
import { RecordsCard } from "./RecordParts";
import { RECORDS_PATH } from "./runRecords";
import { RunRow } from "./RunRow";
import { RunsPage } from "./RunsPage";
import { runVoiceNative, speakState, type SpeakState } from "./runVoiceNative";

/** The map's colours (37b-i): by the sun where the person is, as Google Maps and Waze switch, or fixed. */
export const MAP_COLOUR_CHOICES: readonly { value: MapColours; label: string; desc?: string }[] = [
  { value: "auto", label: "Automatic", desc: "Light by day, dark at night" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

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

/** How much of the page's foot START keeps for itself, over the page (37b-i). */
const DOCK_ROOM = 190;

/** The Running page, under its picture and the Workout tab's three `parts`. START stays over the
 *  page's foot, just above the tab bar, on any phone (Kd, 37b-i: "the start button is almost hidden
 *  behind the bottom bar"); while a run is on, the run's own bar stands there instead (RunLayer).
 *  What Start says, and a run just saved, are said at the page's end, which it scrolls to. */
export function RunningTab({ units, parts }: { units: Units; parts: ReactNode }) {
  const scroller = useRef<ScrollView>(null);
  const showEnd = useCallback(() => {
    requestAnimationFrame(() => {
      scroller.current?.scrollToEnd({ animated: true });
    });
  }, []);
  const focused = useIsFocused();
  const layer = useRunLayer();
  // While the person looks at the app before setup (14d), a run waits for setup.
  const look = useLookOpen();
  const { view } = useRunOutbox();
  const autoPause = useSyncExternalStore(subscribeRun, autoPauseChoice);
  const voiceOn = useSyncExternalStore(subscribeRun, voiceChoice);
  const mapColours = useSyncExternalStore(subscribeRun, mapColoursChoice);
  const [pickingColours, setPickingColours] = useState(false);
  useEffect(() => {
    void readRunChoices();
  }, []);
  const canSpeak = useCanSpeak(focused && voiceOn);
  // No voice code of this app's on this phone (an iPhone, until Stage 5 item 21): the row stays.
  const noVoiceYet = runVoiceNative === null;
  const [problem, setProblem] = useState<StartProblem | null>(null);
  const [settings, setSettings] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [changed, setChanged] = useState(0);
  // A run deleted from its page opened here, said where its box was (37c-i, round one).
  const [deleted, setDeleted] = useState<string | null>(null);
  const going = layer.run !== null;
  // A run going on shows its own Auto-pause, and the switch changes it at once (Kd, 37a's click-through).
  const shownAuto = layer.run !== null && layer.run.phase !== "finished" ? layer.run.autoPause : autoPause;
  const [asked, setAsked] = useState(0);
  const gps = useGpsBefore(focused && !going, asked);
  const last = useRead("/v1/geo/runs?limit=1", runPageSchema, view.sent + changed);
  const lastRun = last.read.kind === "ok" ? (last.read.data.items[0] ?? null) : null;
  const recordsRead = useRead(RECORDS_PATH, runRecordsSchema, view.sent + changed);
  const records = recordsRead.read.kind === "ok" ? recordsRead.read.data : null;
  const anyRecord = records !== null && Object.values(records).some((r) => r !== null);

  // A run just finished takes the place of what was said of the one deleted before it.
  useEffect(() => {
    if (layer.done !== null) setDeleted(null);
  }, [layer.done]);
  const saidUnderStart = problem !== null || layer.done !== null || view.refused.length > 0;
  useEffect(() => {
    if (saidUnderStart) showEnd();
  }, [saidUnderStart, problem, layer.done, showEnd]);

  const start = async () => {
    if (look !== null) {
      look();
      return;
    }
    setProblem(null);
    const said = await layer.start(autoPause);
    setProblem(said);
    setAsked((n) => n + 1);
  };

  return (
    <View style={styles.grow}>
      <Page
        scroller={scroller}
        room={going ? RUN_BAR_ROOM : DOCK_ROOM}
        top={
          <PictureTop
            picture="track"
            tall={0.8}
            foot={
              <View style={styles.runTitle}>
                <Icon name="footprints" size={26} colour="orange" />
                <Txt kind="h1">Run</Txt>
              </View>
            }
          />
        }
      >
        {parts}
        <View style={styles.page}>
          {gps === null || going ? null : (
            <View style={styles.pill} accessible accessibilityLabel={gps.word === "GPS" ? "GPS ready" : gps.word}>
              <View style={[styles.dot, gps.tone === "good" ? styles.dotGood : gps.tone === "weak" ? styles.dotWeak : styles.dotNone]} />
              <Txt kind="small">{gps.word === "GPS" ? "GPS ready" : gps.word}</Txt>
            </View>
          )}
          {deleted === null ? null : (
            <Txt kind="small" colour="goodText">
              {deleted}
            </Txt>
          )}
          {lastRun === null ? null : (
            <View style={styles.yours} testID="your-runs">
              <View style={styles.yoursHead}>
                <Txt kind="h3">Your runs</Txt>
                <Button
                  kind="link"
                  label="See all"
                  say="See all your runs"
                  onPress={() => {
                    setDeleted(null);
                    setRunsOpen(true);
                  }}
                />
              </View>
              <RunRow
                run={lastRun}
                units={units}
                line={false}
                onOpen={(id) => {
                  setDeleted(null);
                  setOpenRun(id);
                }}
              />
            </View>
          )}
          {records === null || !anyRecord ? null : (
            <RecordsCard
              records={records}
              units={units}
              onOpen={(id) => {
                setDeleted(null);
                setOpenRun(id);
              }}
            />
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
                  {noVoiceYet ? "Coming soon" : units === "imperial" ? "Your time and pace each mile" : "Your time and pace each kilometre"}
                </Txt>
                {voiceOn && canSpeak !== "ok" ? (
                  <View style={styles.problem}>
                    <Txt kind="small" colour="badText">
                      {canSpeak === "off" ? "Text-to-speech is off on this phone." : "Your phone has no English voice for text-to-speech."}
                    </Txt>
                    <Button
                      kind="link"
                      label={canSpeak === "off" ? "Turn it on" : "Add a voice"}
                      say="Open text-to-speech settings"
                      onPress={openSpeechSettings}
                    />
                  </View>
                ) : null}
              </View>
              <Switch
                accessibilityLabel="Voice"
                disabled={noVoiceYet}
                value={voiceOn && !noVoiceYet}
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
            <View style={[styles.row, styles.rowLine]}>
              <View style={styles.grow}>
                <Txt kind="body">Map colours</Txt>
                <Txt kind="small" colour="textFaint">
                  {mapColours === "auto" ? "Automatic: light by day, dark at night" : mapColours === "light" ? "Light" : "Dark"}
                </Txt>
              </View>
              <Button
                kind="link"
                label="Change"
                say="Change map colours"
                onPress={() => {
                  setPickingColours(true);
                }}
              />
            </View>
          </View>
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
          <RefusedRuns />
          <Sheet
            open={pickingColours}
            title="Map colours"
            onClose={() => {
              setPickingColours(false);
            }}
          >
            <Options
              options={MAP_COLOUR_CHOICES}
              selected={mapColours}
              solid
              onPick={(choice) => {
                setPickingColours(false);
                void chooseMapColours(choice);
              }}
            />
          </Sheet>
          <SettingsPage
            open={settings}
            onClose={() => {
              setSettings(false);
            }}
          />
          <RunsPage
            open={runsOpen}
            units={units}
            onClose={() => {
              setRunsOpen(false);
              setChanged((n) => n + 1);
            }}
            onStart={() => {
              setRunsOpen(false);
            }}
          />
          <RunPage
            runId={openRun}
            units={units}
            onClose={() => {
              setOpenRun(null);
            }}
            onChanged={() => {
              setChanged((n) => n + 1);
            }}
            onDeleted={(gone) => {
              setDeleted(`${gone.name} was deleted.`);
              setChanged((n) => n + 1);
            }}
          />
        </View>
      </Page>
      {going ? null : (
        <View pointerEvents="box-none" style={styles.dock}>
          <Pressable accessibilityRole="button" accessibilityLabel="Start run" onPress={() => void start()} style={({ pressed }) => [styles.go, pressed ? styles.pressed : null]}>
            <Txt style={styles.goWord}>START</Txt>
          </Pressable>
        </View>
      )}
    </View>
  );
}

/** Whether the phone can speak, asked while the Voice switch is on and the page shown, and again
 *  when the person comes back from the phone's settings. A phone with no voice code of this app's
 *  (none on an iPhone yet) is not told its text-to-speech is off. */
function useCanSpeak(asking: boolean): SpeakState {
  const [can, setCan] = useState<SpeakState>("ok");
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
      (answer) => {
        if (live) setCan(speakState(answer));
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
  runTitle: { flexDirection: "row", alignItems: "center", gap: 10 },
  // START over the page's foot, the page fading out under it.
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", paddingTop: 18, experimental_backgroundImage: dockShade },
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
    marginVertical: 18,
    borderRadius: sizes.round,
    alignItems: "center",
    justifyContent: "center",
    experimental_backgroundImage: orangeGradient,
    boxShadow: shadows.roundButton,
  },
  // The width of the round, not the word's own: Android cut the T of START on a small phone (37b-i).
  goWord: { alignSelf: "stretch", textAlign: "center", fontFamily: fonts.bold, fontSize: 21, letterSpacing: 0.5, color: colours.onOrange },
  problem: { gap: 4, alignItems: "flex-start" },
  choices: { flexDirection: "row", gap: 16, flexWrap: "wrap" },
  said: { textAlign: "center" },
  rows: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 64 },
  rowLine: { borderTopWidth: 1, borderTopColor: colours.line },
  yours: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  yoursHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
});
