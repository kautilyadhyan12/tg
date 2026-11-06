import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Linking, PixelRatio, Pressable, ScrollView, StyleSheet, Switch, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import {
  REMINDER_KINDS,
  remindersResponseSchema,
  type Reminder,
  type ReminderKind,
} from "@app/shared";
import { Button } from "../look/Button";
import { colours, orangeGradient, shadows, sizes } from "../look/colours";
import { Sheet } from "../look/Sheet";
import { fonts, Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { DONE_LINE, MINUTES, PAUSED_LINE, SAFE_MODE_LINE, clockWords, reminderLine, timeWheels, wheelTime } from "./remindersView";
import { NO_ANSWER } from "./SignIn";

// Your training (ROADMAP Stage 5 item 19e-i): the workout reminder (its days and a time) and a reminder
// for each meal, set by the person and saved on their account at once. Never bombarded (Kd, 2026-11-05):
// all start off, none goes on a day already done, and one paused because the app was not opened for a
// week says so here, with Turn on.

const LABEL: Record<ReminderKind, string> = { workout: "Workout reminder", breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
const DAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"] as const;
const DAY_NAME = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
type Loaded = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; reminders: Reminder[]; safeMode: boolean };

/** `onTurnedOn`: a reminder was just switched on, so Android is asked, if it has not been, to let it show.
 *  `after`: what follows the reminders under Your training (19e-ii), told whether Safe mode is on (null while
 *  that could not be read). */
export function TrainingReminders({
  offOnPhone,
  phoneAllowed,
  onTurnedOn,
  after,
}: {
  offOnPhone: boolean;
  phoneAllowed: boolean;
  onTurnedOn: () => void;
  after?: (safeMode: boolean | null) => ReactNode;
}) {
  const { session } = useSession();
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState<ReminderKind | null>(null);
  const [said, setSaid] = useState<{ kind: ReminderKind; words: string } | null>(null);
  const [timeFor, setTimeFor] = useState<Reminder | null>(null);
  // Each save counts here, so a read begun before it never puts the old answer back.
  const saves = useRef(0);

  useEffect(() => {
    const run = { live: true };
    const read = () => {
      const at = saves.current;
      void session.signedIn({ method: "GET", path: "/v1/users/me/reminders" }, remindersResponseSchema).then((answer) => {
        if (!run.live || saves.current !== at) return;
        if (answer.kind === "ok") setLoaded({ kind: "ok", reminders: answer.data.reminders, safeMode: answer.data.safeMode });
        else setLoaded((was) => (was.kind === "ok" ? was : { kind: "failed" }));
      });
    };
    read();
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") read();
    });
    return () => {
      run.live = false;
      back.remove();
    };
  }, [session, tries]);

  const save = async (reminder: Reminder, change: Partial<Pick<Reminder, "on" | "time" | "days">>): Promise<boolean> => {
    if (busy !== null) return false;
    saves.current += 1;
    setBusy(reminder.kind);
    setSaid(null);
    const next = { on: change.on ?? reminder.on, time: change.time ?? reminder.time, days: change.days ?? reminder.days };
    const answer = await session.signedIn({ method: "PUT", path: `/v1/users/me/reminders/${reminder.kind}`, body: next }, remindersResponseSchema);
    saves.current += 1;
    setBusy(null);
    if (answer.kind === "ok") {
      setLoaded({ kind: "ok", reminders: answer.data.reminders, safeMode: answer.data.safeMode });
      if (change.on === true) onTurnedOn();
      return true;
    }
    setSaid({ kind: reminder.kind, words: answer.kind === "refused" ? answer.message : NO_ANSWER });
    return false;
  };

  if (loaded.kind === "loading") return null;
  return (
    <View testID="training-reminders">
      <Txt kind="eyebrow">Your training</Txt>
      {loaded.kind === "failed" ? (
        <View style={styles.between}>
          <Txt kind="small" style={styles.grow}>
            Couldn’t load your reminders.
          </Txt>
          <Button label="Try again" kind="link" say="Try reminders again" onPress={() => { setLoaded({ kind: "loading" }); setTries((n) => n + 1); }} />
        </View>
      ) : (
        <>
          {REMINDER_KINDS.map((kind) => {
            const reminder = loaded.reminders.find((r) => r.kind === kind);
            if (reminder === undefined) return null;
            // Safe mode holds the workout reminder: its switch stays, its days and time wait.
            const held = kind === "workout" && loaded.safeMode && reminder.on;
            const live = reminder.on && !reminder.paused && !held;
            return (
              <View key={kind} style={styles.row} testID={`reminder-${kind}`}>
                <View style={styles.between}>
                  <View style={styles.grow}>
                    <Txt kind="h3">{LABEL[kind]}</Txt>
                    <Txt kind="small">{held ? SAFE_MODE_LINE : reminderLine(reminder)}</Txt>
                  </View>
                  {live && kind !== "workout" ? <TimePill reminder={reminder} disabled={busy !== null} onPress={() => { setTimeFor(reminder); }} /> : null}
                  <Switch
                    testID={`switch-reminder-${kind}`}
                    accessibilityLabel={LABEL[kind]}
                    value={reminder.on}
                    disabled={busy !== null}
                    onValueChange={(value) => void save(reminder, { on: value })}
                    trackColor={{ false: colours.lineStrong, true: colours.orange }}
                    thumbColor={colours.text}
                  />
                </View>
                {live && kind === "workout" ? (
                  <>
                    <View style={styles.days}>
                      {DAY_LETTER.map((letter, i) => {
                        const day = i + 1;
                        const lit = reminder.days.includes(day);
                        return (
                          <Pressable
                            key={DAY_NAME[i]}
                            testID={`day-${String(day)}`}
                            accessibilityRole="checkbox"
                            accessibilityLabel={DAY_NAME[i]}
                            accessibilityState={{ checked: lit, disabled: busy !== null }}
                            disabled={busy !== null}
                            hitSlop={DAY_SLOP}
                            onPress={() => {
                              if (lit && reminder.days.length === 1) {
                                setSaid({ kind, words: "Pick at least one day." });
                                return;
                              }
                              void save(reminder, { days: lit ? reminder.days.filter((d) => d !== day) : [...reminder.days, day].sort((a, b) => a - b) });
                            }}
                            style={[styles.day, lit ? styles.dayOn : null]}
                          >
                            <Txt colour={lit ? "onOrange" : "textSoft"} style={styles.dayLetter}>
                              {letter}
                            </Txt>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View style={styles.start}>
                      <TimePill reminder={reminder} disabled={busy !== null} onPress={() => { setTimeFor(reminder); }} />
                    </View>
                  </>
                ) : null}
                {reminder.on && reminder.paused && !held ? (
                  <View style={styles.paused}>
                    <Txt kind="small" colour="gold" style={styles.grow}>
                      {PAUSED_LINE}
                    </Txt>
                    <Button label="Turn on" kind="link" say={`Turn on ${LABEL[kind]}`} disabled={busy !== null} onPress={() => void save(reminder, { on: true })} />
                  </View>
                ) : null}
                {live && offOnPhone && phoneAllowed ? (
                  <View style={styles.between}>
                    <Txt kind="small" colour="badText" style={styles.grow}>
                      Reminders are off on this phone.
                    </Txt>
                    <Button label="Open phone settings" kind="link" say="Open phone settings for Reminders" onPress={() => void Linking.openSettings()} />
                  </View>
                ) : null}
                {said?.kind === kind ? (
                  <Txt kind="small" colour="badText">
                    {said.words}
                  </Txt>
                ) : null}
              </View>
            );
          })}
          <Txt kind="tiny" style={styles.foot}>
            {DONE_LINE}
          </Txt>
        </>
      )}
      {after?.(loaded.kind === "ok" ? loaded.safeMode : null)}
      <TimeBox
        reminder={timeFor}
        onClose={() => { setTimeFor(null); }}
        onSave={async (time) => {
          if (timeFor === null) return;
          if (await save(timeFor, { time })) setTimeFor(null);
        }}
        busy={busy !== null}
      />
    </View>
  );
}

function TimePill({ reminder, disabled, onPress }: { reminder: Reminder; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      testID={`time-${reminder.kind}`}
      accessibilityRole="button"
      accessibilityLabel={`${LABEL[reminder.kind]} time, ${clockWords(reminder.time)}`}
      accessibilityHint="Change the time"
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={styles.pill}
    >
      <Txt colour="orangeLight" style={styles.pillWords}>
        {clockWords(reminder.time)} ▾
      </Txt>
    </Pressable>
  );
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;
const HALVES = ["AM", "PM"] as const;

function TimeBox({ reminder, onClose, onSave, busy }: { reminder: Reminder | null; onClose: () => void; onSave: (time: string) => Promise<void>; busy: boolean }) {
  const [hour, setHour] = useState(0);
  const [minute, setMinute] = useState(0);
  const [half, setHalf] = useState(0);
  const shown = reminder?.time ?? null;
  useEffect(() => {
    if (shown === null) return;
    const at = timeWheels(shown);
    setHour(at.hour);
    setMinute(at.minute);
    setHalf(at.half);
  }, [shown]);
  return (
    <Sheet open={reminder !== null} title={reminder === null ? "" : LABEL[reminder.kind]} onClose={onClose}>
      {reminder === null ? null : (
        <View style={styles.wheels}>
          <View pointerEvents="none" style={[styles.band, { top: wheelRow() * 2, height: wheelRow() }]} />
          <Wheel label="Hour" rows={HOURS.map(String)} index={hour} onPick={setHour} />
          <Wheel label="Minute" rows={MINUTES.map((m) => String(m).padStart(2, "0"))} index={minute} onPick={setMinute} />
          <Wheel label="AM or PM" rows={[...HALVES]} index={half} onPick={setHalf} />
        </View>
      )}
      <Button label="Save" busy={busy} disabled={busy} style={styles.save} onPress={() => void onSave(wheelTime(hour, minute, half))} />
    </Sheet>
  );
}

const SHOWN_ROWS = 5;
/** A wheel's row grows with the phone's text size, so a large word is never cut. */
const wheelRow = () => Math.round(40 * Math.min(PixelRatio.getFontScale(), 1.6));
const DAY_SLOP = { top: 4, bottom: 4, left: 0, right: 0 };

/** A wheel of choices to spin, as a phone's own alarm clock has; the middle row is the pick. A screen
 *  reader moves it a row at a time. */
function Wheel({ label, rows, index, onPick }: { label: string; rows: readonly string[]; index: number; onPick: (index: number) => void }) {
  const row = wheelRow();
  const list = useRef<ScrollView>(null);
  const last = rows.length - 1;
  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const at = Math.max(0, Math.min(last, Math.round(e.nativeEvent.contentOffset.y / row)));
    if (at !== index) onPick(at);
  };
  useEffect(() => {
    list.current?.scrollTo({ y: index * row, animated: false });
  }, [index, row]);
  const pick = rows[index] ?? "";
  return (
    <View
      style={[styles.wheel, { height: row * SHOWN_ROWS }]}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: pick }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment") onPick(Math.min(last, index + 1));
        if (e.nativeEvent.actionName === "decrement") onPick(Math.max(0, index - 1));
      }}
      testID={`wheel-${label}`}
    >
      <ScrollView
        ref={list}
        showsVerticalScrollIndicator={false}
        snapToInterval={row}
        decelerationRate="fast"
        contentContainerStyle={{ paddingVertical: row * 2 }}
        contentOffset={{ x: 0, y: index * row }}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={(e) => {
          if (e.nativeEvent.velocity === undefined || Math.abs(e.nativeEvent.velocity.y) < 0.05) settle(e);
        }}
      >
        {rows.map((words, i) => (
          <View key={words} style={[styles.wheelRow, { height: row }]}>
            <Txt colour={i === index ? "text" : "textFaint"} style={i === index ? styles.wheelPick : styles.wheelWords}>
              {words}
            </Txt>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  between: { flexDirection: "row", alignItems: "center", gap: sizes.gap },
  row: { gap: 8, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colours.line },
  start: { flexDirection: "row" },
  days: { flexDirection: "row", gap: 6 },
  day: {
    flex: 1,
    maxWidth: 44,
    minHeight: 40,
    aspectRatio: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  dayOn: { borderColor: "transparent", backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.chip },
  dayLetter: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  pill: {
    minHeight: 32,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colours.orangeLine,
    backgroundColor: colours.orangeFill,
    justifyContent: "center",
  },
  pillWords: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  paused: {
    flexDirection: "row",
    alignItems: "center",
    gap: sizes.gap,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.goldLine,
    backgroundColor: colours.goldFill,
  },
  foot: { marginTop: 4 },
  wheels: { flexDirection: "row", justifyContent: "center", gap: 18, marginVertical: 12 },
  save: { alignSelf: "stretch" },
  wheel: { width: 72, overflow: "hidden" },
  band: {
    position: "absolute",
    left: 24,
    right: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.orangeLine,
    backgroundColor: colours.orangeFill,
  },
  wheelRow: { alignItems: "center", justifyContent: "center" },
  wheelWords: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 26 },
  wheelPick: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 30 },
});
