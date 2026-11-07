// The small calendar of Your runs (ROADMAP Stage 5 37c-i; Kd, 2026-11-07: "a small calendar button by
// tapping that can select any date and can see the active date ... a footprint logo on active dates
// glowing with numbers date in middle"). A month at a time; each day the person ran a glowing
// footprint with its date in the middle; any day up to today picked, and the list opens there.
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { runDaysResponseSchema, type RunDaysResponse, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { colours, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { distance, unitWord } from "./runWords";

export const RUN_DAYS_PATH = "/v1/geo/runs/days";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const WEEKDAY_WORDS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const two = (n: number): string => String(n).padStart(2, "0");
/** A day of the phone's own time, YYYY-MM-DD. */
export const dayKey = (at: Date): string => `${String(at.getFullYear())}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
/** "November 2026" from "2026-11". */
export const monthWords = (month: string): string => `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ""} ${month.slice(0, 4)}`;
/** The month before or after "2026-11". */
export function stepMonth(month: string, by: 1 | -1): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + by;
  const at = new Date(y, m, 1);
  return `${String(at.getFullYear())}-${two(at.getMonth() + 1)}`;
}

/** The month's days as the calendar lays them out, Monday first: null for the places before the 1st. */
export function monthGrid(month: string): (string | null)[] {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  return [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => `${month}-${two(i + 1)}`)];
}

type Read = { kind: "loading" } | { kind: "ok"; data: RunDaysResponse } | { kind: "failed" };

/** The calendar in a box from the bottom: `onPick` takes the day pressed, and the box closes. */
export function RunCalendar({ open, start, units, onPick, onClose }: { open: boolean; start: string | null; units: Units; onPick: (day: string) => void; onClose: () => void }) {
  const { session } = useSession();
  const today = dayKey(new Date());
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState((start ?? today).slice(0, 7));
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [asked, setAsked] = useState(0);
  // Opened again: on the month of the day the list starts at, or this month.
  useEffect(() => {
    if (open) setMonth((start ?? dayKey(new Date())).slice(0, 7));
  }, [open, start]);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setRead({ kind: "loading" });
    void session.signedIn({ method: "GET", path: `${RUN_DAYS_PATH}?month=${month}` }, runDaysResponseSchema).then((answer) => {
      if (!live) return;
      setRead(answer.kind === "ok" ? { kind: "ok", data: answer.data } : { kind: "failed" });
    });
    return () => {
      live = false;
    };
  }, [open, month, session, asked]);
  const again = useCallback(() => {
    setAsked((n) => n + 1);
  }, []);

  const days = read.kind === "ok" && read.data.month === month ? read.data.days : [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  const first = read.kind === "ok" ? read.data.first : null;
  const runs = days.reduce((sum, d) => sum + d.runs, 0);
  const metres = days.reduce((sum, d) => sum + d.distanceM, 0);
  // Back as far as the month of the first run; forward to this month.
  const canBack = first !== null && first.slice(0, 7) < month;
  const canOn = month < thisMonth;

  return (
    <Sheet open={open} title="Pick a day" onClose={onClose}>
      <View style={styles.head}>
        <Arrow name="back" say="Month before" on={canBack} onPress={() => { setMonth(stepMonth(month, -1)); }} />
        <View style={styles.month}>
          <Txt kind="h2" style={styles.centred}>
            {monthWords(month)}
          </Txt>
          <Txt kind="small" colour="textFaint" style={styles.centred}>
            {read.kind !== "ok" ? " " : runs === 0 ? "No runs" : `${String(runs)} ${runs === 1 ? "run" : "runs"} · ${distance(metres, units)} ${unitWord(units)}`}
          </Txt>
        </View>
        <Arrow name="go" say="Month after" on={canOn} onPress={() => { setMonth(stepMonth(month, 1)); }} />
      </View>
      <View style={styles.grid}>
        {WEEKDAYS.map((w, i) => (
          <View key={`w${String(i)}`} style={styles.cell}>
            <Txt kind="tiny" style={styles.weekday}>
              {w}
            </Txt>
          </View>
        ))}
        {monthGrid(month).map((day, i) => {
          if (day === null) return <View key={`e${String(i)}`} style={styles.cell} />;
          const ran = byDay.get(day);
          const after = day > today;
          const n = Number(day.slice(8));
          const weekday = WEEKDAY_WORDS[(i % 7)] ?? "";
          const said = ran === undefined ? `${weekday} ${String(n)}, no run` : `${weekday} ${String(n)}, ${String(ran.runs)} ${ran.runs === 1 ? "run" : "runs"}, ${distance(ran.distanceM, units)} ${unitWord(units)}`;
          return (
            <View key={day} style={styles.cell}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={said}
                accessibilityState={{ disabled: after }}
                disabled={after}
                onPress={() => {
                  onPick(day);
                }}
                style={({ pressed }) => [styles.day, day === today ? styles.today : null, pressed ? styles.pressed : null]}
                testID={ran === undefined ? undefined : `ran-${day}`}
              >
                {ran === undefined ? null : (
                  <View style={styles.foot} pointerEvents="none">
                    <View style={styles.glow} />
                    <Icon name="footprints" size={34} colour="orange" />
                  </View>
                )}
                <Txt style={[styles.date, ran === undefined ? null : styles.dateRan, after ? styles.dateAfter : null]}>{String(n)}</Txt>
              </Pressable>
            </View>
          );
        })}
      </View>
      {read.kind === "failed" ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            Your runs couldn't load.
          </Txt>
          <Button label="Try again" kind="link" say="Try the calendar again" onPress={again} />
        </View>
      ) : null}
    </Sheet>
  );
}

function Arrow({ name, say, on, onPress }: { name: "back" | "go"; say: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={say}
      accessibilityState={{ disabled: !on }}
      disabled={!on}
      onPress={onPress}
      style={[styles.arrow, on ? null : styles.off]}
    >
      <Icon name={name} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  month: { flex: 1, gap: 2 },
  centred: { textAlign: "center" },
  arrow: { width: sizes.press, height: sizes.press, borderRadius: sizes.round, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colours.lineStrong },
  off: { opacity: 0.3 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: "14.2857%", alignItems: "center", paddingVertical: 3 },
  weekday: { fontFamily: fonts.bold, letterSpacing: 1 },
  day: { width: sizes.press, height: sizes.press, borderRadius: sizes.round, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 1.5, borderColor: colours.orange },
  pressed: { opacity: 0.7 },
  foot: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  glow: { position: "absolute", width: 26, height: 26, borderRadius: sizes.round, backgroundColor: colours.orangeLine, boxShadow: shadows.dayGlow },
  date: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: colours.textSoft },
  dateRan: { fontFamily: fonts.bold, color: colours.text, textShadowColor: colours.page, textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } },
  dateAfter: { color: colours.textFaint, opacity: 0.5 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
});
