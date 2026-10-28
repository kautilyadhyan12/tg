import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { GymAttendanceHistoryResponse, GymAttendanceVisit } from "@app/shared";
import { Button } from "../../look/Button";
import { Card, Pill } from "../../look/Card";
import { colours, orangeGradient, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import type { Answer } from "../../session/calls";
import {
  WEEK_HEADS,
  dayIn,
  dayLabel,
  emptyMonthNote,
  monthGrid,
  monthName,
  monthOfDay,
  monthWindow,
  shiftMonth,
  type ClockFormat,
  type DayCell,
} from "./visitsView";

// Days you came (docs/design/phone/pages/Gym): one place's month of visits, under that place's pass
// box, on the place's own clock. A day they came is tapped for its times.
//
// MOUNTED ONCE PER PLACE, KEYED BY ITS ID, so nothing here can carry one place's visits to another.
// It reads the month on screen when it is shown, when a month is stepped to, and each time `read`
// changes (the tab opened, the app back in front, the pass closed after a scan).

export const DAYS_COULD_NOT = "Couldn’t load the days you came.";
export const DAYS_MORE = "Some visits this month aren’t shown.";

export const historyPath = (gymId: string, window: { from: string; to: string }) =>
  `/v1/orgs/${encodeURIComponent(gymId)}/attendance/history?from=${window.from}&to=${window.to}`;

export type FetchVisits = (path: string) => Promise<Answer<GymAttendanceHistoryResponse>>;

type Held =
  | { status: "loading" }
  | { status: "failed"; forMonth: string }
  | { status: "ready"; forMonth: string; visits: GymAttendanceVisit[]; zone: string; clock: ClockFormat; more: boolean };

/** The phone's own date, until the place's answer has said its zone. */
function phoneDay(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

interface DaysYouCameProps {
  gymId: string;
  /** Changed by the Gym tab when the month should be read again. */
  read: number;
  fetchVisits: FetchVisits;
}

export function DaysYouCame({ gymId, read, fetchVisits }: DaysYouCameProps) {
  const [held, setHeld] = useState<Held>({ status: "loading" });
  // The place's zone and clock, from its last answer: the month and today are the place's.
  const [zone, setZone] = useState<string | null>(null);
  // The month stepped to, or null for the place's month now.
  const [step, setStep] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  // Bumped by Try again.
  const [attempt, setAttempt] = useState(0);
  // Reads are numbered as they start: an answer stands only if no later read has started.
  const started = useRef(0);

  // The phone's clock, read again whenever the tab asks for a fresh read.
  const now = useNow(read);
  const today = zone === null ? null : dayIn(zone, now);
  const thisMonth = monthOfDay(today ?? phoneDay(now));
  const month = step ?? thisMonth;

  useEffect(() => {
    if (month === null) return undefined;
    const window = monthWindow(month);
    if (window === null) return undefined;
    started.current += 1;
    const number = started.current;
    let live = true;
    void fetchVisits(historyPath(gymId, window)).then((answer) => {
      if (!live || number !== started.current) return;
      if (answer.kind === "ok") {
        const { attendance } = answer.data;
        setZone(attendance.timezone);
        setHeld({
          status: "ready",
          forMonth: month,
          // Only this month's days, whatever the answer holds.
          visits: attendance.visits.filter((visit) => visit.day >= window.from && visit.day < window.to),
          zone: attendance.timezone,
          clock: attendance.clockFormat,
          more: attendance.nextCursor !== null,
        });
      } else {
        // A month already on screen stays: a failed look again is no reason to take it away.
        setHeld((was) => (was.status === "ready" && was.forMonth === month ? was : { status: "failed", forMonth: month }));
      }
    });
    return () => {
      live = false;
    };
  }, [gymId, month, read, attempt, fetchVisits]);

  if (month === null) return null;
  const fresh = held.status !== "loading" && held.forMonth === month;
  const ready = fresh && held.status === "ready" ? held : null;
  const grid = monthGrid(month, ready?.visits ?? [], ready?.zone ?? "", ready?.clock ?? "24h", today);
  if (grid === null) return null;
  const opened = ready === null ? null : (grid.cells.find((cell) => cell.date === openDay && cell.came) ?? null);
  const atNow = thisMonth !== null && month >= thisMonth;

  const move = (by: number) => {
    setOpenDay(null);
    setStep(shiftMonth(month, by));
  };

  const cells: (DayCell | null)[] = [...Array.from({ length: grid.leading }, () => null), ...grid.cells];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <Card style={styles.box} testID={`days-${gymId}`}>
      <View style={styles.head}>
        <Txt kind="h3" style={styles.grow}>
          Days you came
        </Txt>
        <MonthArrow icon="back" say="Previous month" onPress={() => { move(-1); }} />
        <Txt colour="text" style={styles.month}>
          {monthName(month, thisMonth)}
        </Txt>
        <MonthArrow icon="go" say="Next month" disabled={atNow} onPress={() => { move(1); }} />
      </View>

      {fresh && held.status === "failed" ? (
        <View style={styles.row}>
          <Txt kind="small" colour="badText" style={styles.grow}>
            {DAYS_COULD_NOT}
          </Txt>
          <Button label="Try again" kind="link" onPress={() => { setAttempt((n) => n + 1); }} />
        </View>
      ) : (
        <>
          <View style={[styles.weeks, ready === null ? styles.waiting : null]} accessibilityState={{ busy: ready === null }}>
            <View style={styles.week}>
              {WEEK_HEADS.map((head) => (
                <Txt key={head} kind="tiny" style={styles.weekHead}>
                  {head}
                </Txt>
              ))}
            </View>
            {weeks.map((week) => (
              <View key={week.find((cell) => cell !== null)?.date ?? "none"} style={styles.week}>
                {week.map((cell, i) =>
                  cell === null ? (
                    <View key={`blank-${String(i)}`} style={styles.cell} />
                  ) : (
                    <Day key={cell.date} cell={cell} monthName={monthName(month, null)} onPress={() => { setOpenDay(cell.date); }} />
                  ),
                )}
              </View>
            ))}
          </View>
          {ready !== null && grid.cells.every((cell) => !cell.came) ? <Txt kind="small">{emptyMonthNote(month, thisMonth)}</Txt> : null}
          {ready?.more === true ? <Txt kind="tiny">{DAYS_MORE}</Txt> : null}
        </>
      )}

      <Sheet open={opened !== null} title={opened === null ? "" : dayLabel(opened.date)} onClose={() => { setOpenDay(null); }}>
        {opened === null ? null : (
          <>
            <Txt>You were here</Txt>
            {opened.times.length > 0 ? (
              <View style={styles.times}>
                {opened.times.map((time, i) => (
                  <Pill key={`${String(i)}-${time}`} label={time} tone="orange" icon="clock" />
                ))}
              </View>
            ) : null}
          </>
        )}
      </Sheet>
    </Card>
  );
}

/** The phone's clock, looked at again each time `key` changes. */
function useNow(key: number): Date {
  const [now, setNow] = useState(() => new Date());
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setNow(new Date());
  }, [key]);
  return now;
}

function MonthArrow({ icon, say, disabled = false, onPress }: { icon: "back" | "go"; say: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={say}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={ARROW_SLOP}
      style={({ pressed }) => [styles.arrow, disabled ? styles.arrowOff : null, pressed ? styles.pressed : null]}
    >
      <Icon name={icon} size={16} colour="textSoft" />
    </Pressable>
  );
}

function Day({ cell, monthName: name, onPress }: { cell: DayCell; monthName: string; onPress: () => void }) {
  const month = name.split(" ")[0] ?? "";
  return (
    <Pressable
      accessibilityRole={cell.came ? "button" : "text"}
      accessibilityLabel={cell.came ? `${String(cell.day)} ${month}, you came` : `${String(cell.day)} ${month}`}
      disabled={!cell.came}
      onPress={onPress}
      style={[styles.cell, cell.future ? styles.future : null]}
    >
      <View style={[styles.dot, cell.came ? styles.came : cell.today ? styles.today : null]}>
        <Txt colour={cell.came ? "onOrange" : cell.today ? "orange" : "textSoft"} style={styles.number}>
          {cell.day}
        </Txt>
      </View>
    </Pressable>
  );
}

const ARROW_SLOP = { top: 4, bottom: 4, left: 4, right: 4 };
const DOT = 32;

const styles = StyleSheet.create({
  box: { padding: 16, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  month: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, textAlign: "center", paddingHorizontal: 2 },
  arrow: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  arrowOff: { opacity: 0.35 },
  pressed: { opacity: 0.8 },
  weeks: { gap: 2 },
  waiting: { opacity: 0.4 },
  week: { flexDirection: "row" },
  weekHead: { flex: 1, textAlign: "center", fontFamily: fonts.bold, letterSpacing: 0.66, textTransform: "uppercase" },
  cell: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: sizes.press - 4, paddingVertical: 2 },
  future: { opacity: 0.35 },
  dot: { minWidth: DOT, minHeight: DOT, borderRadius: sizes.round, alignItems: "center", justifyContent: "center", paddingHorizontal: 2, backgroundColor: colours.fill },
  came: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient },
  today: { borderWidth: 1.5, borderColor: colours.orange, backgroundColor: colours.orangeFill },
  number: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
