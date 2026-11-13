// Connect a heart rate monitor (ROADMAP Stage 5 item 37f-i): the box from the bottom that finds the
// monitors near the phone, tries the one picked, shows its heart rate so the person sees it is theirs,
// and keeps it; and the row that opens it, on the Running page and in Settings. One monitor, read from
// one place (`monitor.ts`), on both. A monitor whose address changes is paired as it is saved (37f-ii-b).
import { useEffect, useReducer, useRef, useState } from "react";
import { heartFoundSchema, type HeartFound } from "@app/shared";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../look/Button";
import { colours, sizes } from "../look/colours";
import { Icon } from "../look/Icon";
import { Sheet } from "../look/Sheet";
import { Txt } from "../look/Txt";
import { runNow } from "../screens/running/recorder";
import { heartNative } from "./heartNative";
import {
  askBluetoothOn,
  askNearby,
  bluetoothState,
  endTry,
  forgetMonitor,
  heartNow,
  isPaired,
  needsPairing,
  pairMonitor,
  pullHeart,
  saveMonitor,
  tryMonitor,
  useHeartNow,
  type BluetoothState,
  type Monitor,
} from "./monitor";

/** A monitor heard while looking: its address, its name, how strong it is heard (nearest first), and
 *  what kind of address it has. */
type Heard = HeartFound;

/** Looking stops by itself after this (the Bluetooth code's own 30 s). */
const LOOK_MS = 30_000;
/** A monitor tried that sends nothing for this long is said to send nothing. */
const QUIET_MS = 15_000;

export const monitorName = (name: string): string => (name.trim() === "" ? "Heart rate monitor" : name.trim());
export const bpmWords = (bpm: number | null): string => (bpm === null ? "No signal" : `${String(bpm)} bpm`);

function readHeard(raw: unknown): Heard | null {
  const heard = heartFoundSchema.safeParse(raw);
  return heard.success ? heard.data : null;
}

const SAVED = "Saved. It connects when you start a run.";
/** What Save says, after pairing or none. */
const PAIR_SAID = {
  paired: "Paired and saved. It connects when you start a run.",
  notNeeded: SAVED,
  notPaired: "Saved, not paired. If it says No signal later, press Change monitor.",
} as const;

const openBluetoothSettings = (): void => {
  void Linking.sendIntent("android.settings.BLUETOOTH_SETTINGS").catch(() => Linking.openSettings());
};

/** Bluetooth's state, asked again each second and when the person comes back to the app. */
function useBluetooth(active: boolean): BluetoothState {
  const [state, setState] = useState<BluetoothState>(() => bluetoothState());
  useEffect(() => {
    if (!active) return;
    const look = () => {
      setState(bluetoothState());
    };
    look();
    const every = setInterval(look, 1000);
    const back = AppState.addEventListener("change", (s) => {
      if (s === "active") look();
    });
    return () => {
      clearInterval(every);
      back.remove();
    };
  }, [active]);
  return state;
}

type Step =
  | { kind: "saved" }
  | { kind: "find" }
  | { kind: "try"; heard: Heard; since: number }
  | { kind: "pairing"; heard: Heard }
  | { kind: "remove" }
  | { kind: "removed"; name: string; paired: boolean };

export function HeartMonitorSheet({ open, onClose, monitor }: { open: boolean; onClose: () => void; monitor: Monitor | null }) {
  const [step, setStep] = useState<Step>(monitor === null ? { kind: "find" } : { kind: "saved" });
  const [said, setSaid] = useState<string | null>(null);
  /** Each Save's own number: a pairing answered after the box moved on saves nothing. */
  const saving = useRef(0);
  const save = (heard: Heard, id: string, words: string) => {
    void saveMonitor({ id, name: heard.name }).then(() => {
      setSaid(words);
      setStep({ kind: "saved" });
    });
  };
  useEffect(() => {
    if (!open) return;
    setStep(monitor === null ? { kind: "find" } : { kind: "saved" });
    setSaid(null);
    // Opened afresh each time: the first step is the monitor kept, or looking for one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const close = () => {
    saving.current += 1;
    endTry();
    onClose();
  };
  // However the box goes (closed, or the page under it gone), a monitor tried and not saved is never left
  // watched in place of the saved one (round one, L1).
  useEffect(() => {
    if (open) return;
    saving.current += 1;
    endTry();
  }, [open]);
  useEffect(() => () => {
    endTry();
  }, []);
  const running = runNow() !== null && runNow()?.phase !== "finished";
  return (
    <Sheet open={open} title="Heart rate monitor" onClose={close}>
      {step.kind === "saved" && monitor !== null ? (
        <SavedStep monitor={monitor} said={said} running={running} onChange={() => { setSaid(null); setStep({ kind: "find" }); }} onRemove={() => { setStep({ kind: "remove" }); }} />
      ) : step.kind === "remove" && monitor !== null ? (
        <View style={styles.step}>
          <Txt kind="body">{`${monitorName(monitor.name)} won't connect to your runs.`}</Txt>
          <Button
            kind="danger"
            label="Remove"
            wide
            onPress={() => {
              const paired = isPaired(monitor.id);
              forgetMonitor();
              setStep({ kind: "removed", name: monitorName(monitor.name), paired });
            }}
          />
          <Button kind="link" label="Keep it" style={styles.centred} onPress={() => { setStep({ kind: "saved" }); }} />
        </View>
      ) : step.kind === "removed" ? (
        <View style={styles.step}>
          <Txt kind="body">{step.paired ? `Removed. ${step.name} is still paired with this phone.` : `Removed. ${step.name} won't connect to your runs.`}</Txt>
          {step.paired ? <Button kind="plain" label="Bluetooth settings" say="Open Bluetooth settings to unpair it" wide onPress={openBluetoothSettings} /> : null}
          <Button kind="link" label="Connect another" style={styles.centred} onPress={() => { setStep({ kind: "find" }); }} />
        </View>
      ) : step.kind === "pairing" ? (
        <View style={styles.step}>
          <View style={styles.live}>
            <Icon name="heart" size={28} colour="orange" />
            <Txt kind="h1" fit numberOfLines={1}>
              Pairing…
            </Txt>
          </View>
          <Txt kind="strong" style={styles.centredText}>
            {monitorName(step.heard.name)}
          </Txt>
          <Txt kind="small" colour="textFaint" style={styles.centredText}>
            Tap Pair when your phone asks.
          </Txt>
          <Button
            kind="link"
            label="Save without pairing"
            style={styles.centred}
            onPress={() => {
              saving.current += 1;
              save(step.heard, step.heard.id, PAIR_SAID.notPaired);
            }}
          />
        </View>
      ) : step.kind === "try" ? (
        <TryStep
          heard={step.heard}
          since={step.since}
          onSave={() => {
            const heard = step.heard;
            const mine = (saving.current += 1);
            if (!needsPairing(heard)) {
              save(heard, heard.id, SAVED);
              return;
            }
            setStep({ kind: "pairing", heard });
            void pairMonitor(heard).then((paired) => {
              if (saving.current !== mine) return;
              save(heard, paired.kind === "paired" ? paired.id : heard.id, PAIR_SAID[paired.kind]);
            });
          }}
          onNotThis={() => {
            endTry();
            setStep({ kind: "find" });
          }}
        />
      ) : running ? (
        <Txt kind="body">Finish your run to change your monitor.</Txt>
      ) : (
        <FindStep
          active={open}
          onPick={(heard) => {
            tryMonitor(heard.id);
            setStep({ kind: "try", heard, since: Date.now() });
          }}
        />
      )}
    </Sheet>
  );
}

function SavedStep({ monitor, said, running, onChange, onRemove }: { monitor: Monitor; said: string | null; running: boolean; onChange: () => void; onRemove: () => void }) {
  const { bpm, bluetooth } = useHeartNow(true);
  return (
    <View style={styles.step}>
      <View style={styles.live}>
        <Icon name="heart" size={28} colour={bpm === null ? "textFaint" : "orange"} />
        <Txt kind="h1" fit numberOfLines={1}>
          {bpmWords(bpm)}
        </Txt>
      </View>
      <Txt kind="strong" style={styles.centredText}>
        {monitorName(monitor.name)}
      </Txt>
      {said === null ? null : (
        <Txt kind="small" colour="goodText" style={styles.centredText}>
          {said}
        </Txt>
      )}
      <BluetoothProblem state={bluetooth} />
      {bluetooth === "on" && bpm === null ? (
        <Txt kind="small" colour="textFaint" style={styles.centredText}>
          {running ? "Wear it to connect." : "Wear it to connect. Still no signal? Change monitor and find it again."}
        </Txt>
      ) : null}
      {running ? null : (
        <>
          <Button kind="plain" label="Change monitor" wide onPress={onChange} />
          <Button kind="dangerLink" label="Remove" style={styles.centred} onPress={onRemove} />
        </>
      )}
    </View>
  );
}

function FindStep({ active, onPick }: { active: boolean; onPick: (heard: Heard) => void }) {
  const bluetooth = useBluetooth(active);
  const [heard, setHeard] = useState<Heard[]>([]);
  const [looking, setLooking] = useState(false);
  const [round, setRound] = useState(0);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    if (!active || bluetooth !== "on" || heartNative === null) return;
    const native = heartNative;
    setHeard([]);
    const listening = native.addListener("found", (raw) => {
      const one = readHeard(raw);
      if (one === null) return;
      setHeard((was) => [...was.filter((h) => h.id.toUpperCase() !== one.id.toUpperCase()), one].sort((a, b) => b.rssi - a.rssi));
    });
    setLooking(native.scan());
    const done = setTimeout(() => {
      setLooking(false);
    }, LOOK_MS);
    return () => {
      clearTimeout(done);
      listening.remove();
      native.stopScan();
    };
  }, [active, bluetooth, round]);

  if (bluetooth !== "on") {
    return (
      <View style={styles.step}>
        {bluetooth === "denied" ? (
          <>
            <Txt kind="body">Allow Nearby devices to find your monitor.</Txt>
            {blocked ? (
              <Button label="Open settings" wide onPress={() => void Linking.openSettings()} />
            ) : (
              <Button
                label="Allow"
                wide
                onPress={() =>
                  void askNearby().then((answer) => {
                    setBlocked(answer === "blocked");
                  })
                }
              />
            )}
          </>
        ) : (
          <BluetoothProblem state={bluetooth} />
        )}
      </View>
    );
  }
  return (
    <View style={styles.step}>
      <Txt kind="small" colour="textFaint">
        Wear your strap, or turn on your watch's heart rate broadcast.
      </Txt>
      <ScrollView style={styles.list} contentContainerStyle={styles.listInside}>
        {heard.map((one) => (
          <Pressable
            key={one.id}
            accessibilityRole="button"
            accessibilityLabel={`Connect ${monitorName(one.name)}`}
            onPress={() => {
              onPick(one);
            }}
            style={({ pressed }) => [styles.found, pressed ? styles.pressed : null]}
          >
            <Icon name="heart" size={20} colour="orange" />
            <Txt kind="strong" numberOfLines={1} style={styles.grow}>
              {monitorName(one.name)}
            </Txt>
            <Icon name="go" size={18} colour="textFaint" />
          </Pressable>
        ))}
      </ScrollView>
      {looking ? (
        <Txt kind="small" colour="textSoft" style={styles.centredText}>
          Looking for monitors…
        </Txt>
      ) : (
        <>
          {heard.length === 0 ? (
            <Txt kind="body" style={styles.centredText}>
              No heart rate monitor found.
            </Txt>
          ) : null}
          <Button kind="plain" label="Look again" wide onPress={() => { setRound((n) => n + 1); }} />
        </>
      )}
    </View>
  );
}

function TryStep({ heard, since, onSave, onNotThis }: { heard: Heard; since: number; onSave: () => void; onNotThis: () => void }) {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const every = setInterval(() => {
      pullHeart();
      tick();
    }, 1000);
    return () => {
      clearInterval(every);
    };
  }, []);
  const now = Date.now();
  const bpm = heartNow(now);
  const quiet = bpm === null && now - since > QUIET_MS;
  return (
    <View style={styles.step}>
      <View style={styles.live}>
        <Icon name="heart" size={28} colour={bpm === null ? "textFaint" : "orange"} />
        <Txt kind="h1" fit numberOfLines={1}>
          {bpm === null ? "Connecting…" : `${String(bpm)} bpm`}
        </Txt>
      </View>
      <Txt kind="strong" style={styles.centredText}>
        {monitorName(heard.name)}
      </Txt>
      <Txt kind="small" colour="textFaint" style={styles.centredText}>
        {quiet ? "No heart rate from it yet. Wear it, then wait a moment." : "Is this your heart rate?"}
      </Txt>
      <Button label="Save" wide disabled={bpm === null} onPress={onSave} />
      <Button kind="link" label="Not this one" style={styles.centred} onPress={onNotThis} />
    </View>
  );
}

/** What stands in the way of a monitor: no Bluetooth on the phone, or Bluetooth off. */
function BluetoothProblem({ state }: { state: BluetoothState }) {
  if (state === "on" || state === "denied") return null;
  if (state === "none") {
    return <Txt kind="body">This phone can't connect to a heart rate monitor.</Txt>;
  }
  return (
    <View style={styles.problem}>
      <Txt kind="body">Bluetooth is off.</Txt>
      <Button label="Turn on Bluetooth" wide onPress={askBluetoothOn} />
    </View>
  );
}

/** The row on the Running page, and under Settings' own heading (`named` false): the monitor and its heart
 *  rate now, or Connect. */
export function HeartMonitorRow({ active, onOpen, named = true }: { active: boolean; onOpen: () => void; named?: boolean }) {
  const { monitor, bpm } = useHeartNow(active);
  const what = monitor === null ? "Chest strap or watch" : named ? `${monitorName(monitor.name)} · ${bpmWords(bpm)}` : monitorName(monitor.name);
  return (
    <>
      <View style={styles.rowWords}>
        {named ? <Txt kind="body">Heart rate monitor</Txt> : null}
        <Txt kind={named ? "small" : "body"} colour={named ? "textFaint" : "textSoft"} numberOfLines={1}>
          {what}
        </Txt>
        {!named && monitor !== null ? (
          <Txt kind="small" colour="textFaint">
            {bpmWords(bpm)}
          </Txt>
        ) : null}
      </View>
      <Button kind="link" label={monitor === null ? "Connect" : "Change"} say={monitor === null ? "Connect a heart rate monitor" : "Change heart rate monitor"} onPress={onOpen} />
    </>
  );
}

const styles = StyleSheet.create({
  step: { gap: 14 },
  live: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 6 },
  centred: { alignSelf: "center" },
  centredText: { textAlign: "center" },
  problem: { gap: 10 },
  list: { maxHeight: 280 },
  listInside: { gap: 8 },
  found: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 16, borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line },
  pressed: { opacity: 0.88 },
  grow: { flex: 1 },
  rowWords: { flex: 1 },
});
