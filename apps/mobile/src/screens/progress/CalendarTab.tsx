import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { progressHeatmapSchema, workoutPageSchema, type ProgressHeatmap } from "@app/shared";
import { chalk, chalkShadows, colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Rise } from "../../look/Motion";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead } from "../dashboard/useRead";
import { count } from "../dashboard/words";
import {
  activeDaysWords,
  dayTitle,
  daySaid,
  daySum,
  dayWindow,
  dayWorkouts,
  level,
  monthCells,
  monthOf,
  monthPickSaid,
  monthRange,
  monthWords,
  monthsToPick,
  nextMonth,
  sameMonth,
  squareSaid,
  yearColumns,
  type Month,
  type MonthPick,
} from "./calendarRules";
import { ArtBox, BoxTitle, Flame, ReadOr } from "./parts";
import { dayKeyOf } from "./progressRules";

// Progress's Calendar (ROADMAP Stage 5 35c-i): the web's month and its year of activity in one box,
// a flame on each day trained, under the trainer and its footprints.

export const HEATMAP_READ = "/v1/progress/heatmap";
/** The server's year of days (its heatmap reads the last 365). */
const YEAR_DAYS = 365;

export function CalendarTab() {
  const heatmap = useRead(HEATMAP_READ, progressHeatmapSchema, useZoneSaved());
  return (
    <Rise delay={60}>
      <ArtBox picture="steps" focus="top">
        <ReadOr read={heatmap.read} again={heatmap.again} what="Your calendar">
          {(h) => <Activity heatmap={h} />}
        </ReadOr>
      </ArtBox>
    </Rise>
  );
}

function Activity({ heatmap }: { heatmap: ProgressHeatmap }) {
  const today = dayKeyOf(new Date());
  const days = heatmap.limitedToDays === null ? YEAR_DAYS : Math.min(YEAR_DAYS, heatmap.limitedToDays);
  const workouts = useMemo(() => new Map(heatmap.days.map((d) => [d.date, d.count])), [heatmap]);
  const range = monthRange(today, days);
  const [view, setView] = useState<"month" | "year">("month");
  const [month, setMonth] = useState<Month>(monthOf(today));
  const [picking, setPicking] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  return (
    <>
      <BoxTitle
        icon="calendar"
        title="Activity"
        side={
          <View style={styles.seg} accessibilityRole="radiogroup">
            {(["month", "year"] as const).map((v) => (
              <Pressable
                key={v}
                accessibilityRole="radio"
                accessibilityLabel={v === "month" ? "Month" : "Year"}
                accessibilityState={{ selected: view === v }}
                onPress={() => {
                  setView(v);
                }}
                style={[styles.segItem, view === v ? styles.segOn : null]}
              >
                <Txt kind="small" colour={view === v ? "orangeLight" : "textSoft"} style={styles.segWords}>
                  {v === "month" ? "Month" : "Year"}
                </Txt>
              </Pressable>
            ))}
          </View>
        }
      />
      {/* Room for the trainer's drawing above the days. */}
      <View style={styles.room} />
      {view === "month" ? (
        <MonthView
          month={month}
          setMonth={setMonth}
          first={range.first}
          last={range.last}
          workouts={workouts}
          today={today}
          onPick={() => {
            setPicking(true);
          }}
          onDay={setDay}
        />
      ) : (
        <YearView today={today} days={days} workouts={workouts} onDay={setDay} />
      )}
      <Sheet
        open={picking}
        title="Pick a month"
        picture={CALENDAR_PICTURE}
        onClose={() => {
          setPicking(false);
        }}
      >
        <MonthPicker
          years={monthsToPick(range.first, range.last, workouts)}
          month={month}
          onPick={(m) => {
            setMonth(m);
            setView("month");
            setPicking(false);
          }}
        />
      </Sheet>
      <Sheet
        open={day !== null}
        title={day === null ? "" : dayTitle(day, today)}
        picture={CALENDAR_PICTURE}
        onClose={() => {
          setDay(null);
        }}
      >
        {/* One read for each day, so a late answer for a day left behind is never drawn under another. */}
        {day === null ? null : <DayBox key={day} day={day} />}
      </Sheet>
    </>
  );
}

/** The footprints across the calendar's boxes, as across its own. */
const CALENDAR_PICTURE = { name: "steps", focus: 0.3 } as const;

/** The months in rows of four, a short row keeping its boxes' width. */
function rowsOfFour<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  items.forEach((item, i) => {
    if (i % 4 === 0) rows.push([]);
    rows[rows.length - 1]?.push(item);
  });
  return rows;
}

function MonthPicker({ years, month, onPick }: { years: readonly { year: number; months: readonly MonthPick[] }[]; month: Month; onPick: (m: Month) => void }) {
  return (
    <View style={styles.picker}>
      {years.map((y) => (
        <View key={y.year} style={styles.pickYear}>
          <Txt kind="eyebrow">{String(y.year)}</Txt>
          {rowsOfFour(y.months).map((row) => (
            <View key={row.map((p) => p.label).join()} style={styles.pickGrid}>
              {row.map((p) => {
                const on = sameMonth(p.month, month);
                return (
                  <Pressable
                    key={p.label}
                    accessibilityRole="button"
                    accessibilityLabel={monthPickSaid(p)}
                    accessibilityState={{ selected: on, disabled: !p.open }}
                    disabled={!p.open}
                    onPress={() => {
                      onPick(p.month);
                    }}
                    style={({ pressed }) => [styles.pickMonth, p.active > 0 && p.open ? styles.pickLit : null, on ? styles.pickOn : null, pressed ? styles.pressed : null, p.open ? null : styles.pickShut]}
                  >
                    <Txt kind="strong" colour={on ? "onOrange" : p.open ? "text" : "textFaint"}>
                      {p.label}
                    </Txt>
                    {p.open ? (
                      <View style={styles.pickDays}>
                        {p.active > 0 && !on ? <Flame size={9} /> : null}
                        <Txt kind="tiny" colour={on ? "onBar" : p.active > 0 ? "orangeLight" : "textFaint"} style={styles.boldWords}>
                          {p.active === 1 ? "1 day" : `${count(p.active)} days`}
                        </Txt>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
              {Array.from({ length: 4 - row.length }, (_, i) => (
                <View key={`gap${String(i)}`} style={[styles.pickMonth, styles.unseen]} />
              ))}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const WORKOUTS_MOST = 100;

function DayBox({ day }: { day: string }) {
  const { from, to } = dayWindow(day);
  const list = useRead(`/v1/workouts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${String(WORKOUTS_MOST)}`, workoutPageSchema);
  return (
    <ReadOr read={list.read} again={list.again} what="This day’s workouts">
      {(page) => {
        if (page.items.length === 0) {
          return (
            <View style={styles.dayNone}>
              <Txt kind="small">No workout this day</Txt>
            </View>
          );
        }
        const sum = daySum(page.items);
        return (
          <View style={styles.dayBox}>
            <View style={styles.daySum}>
              <DayStat value={sum.workouts} label={page.items.length === 1 ? "workout" : "workouts"} />
              {sum.trained === null ? null : <DayStat value={sum.trained} label="trained" />}
              {sum.kcal === null ? null : <DayStat value={sum.kcal} label="kcal" warm />}
            </View>
            {dayWorkouts(page.items).map((w) => (
              <View key={w.id} style={styles.dayWorkout} accessible accessibilityLabel={w.said}>
                <Flame size={28} glow />
                <View style={styles.grow}>
                  <Txt kind="strong">{w.when}</Txt>
                  <Txt kind="tiny">{w.what}</Txt>
                </View>
                {w.kcal === null ? null : (
                  <View style={styles.dayKcal}>
                    <Txt kind="strong" colour="orangeLight">
                      {w.kcal}
                    </Txt>
                    <Txt kind="tiny">kcal</Txt>
                  </View>
                )}
              </View>
            ))}
            {page.nextCursor === null ? null : <Txt kind="tiny">{`Showing the first ${String(WORKOUTS_MOST)} workouts of the day`}</Txt>}
          </View>
        );
      }}
    </ReadOr>
  );
}

function DayStat({ value, label, warm = false }: { value: string; label: string; warm?: boolean }) {
  return (
    <View style={styles.dayStat} accessible accessibilityLabel={`${value} ${label}`}>
      <Txt kind="big" colour={warm ? "orangeLight" : "text"} numberOfLines={1} fit>
        {value}
      </Txt>
      <Txt kind="tiny">{label}</Txt>
    </View>
  );
}

function MonthView({
  month,
  setMonth,
  first,
  last,
  workouts,
  today,
  onPick,
  onDay,
}: {
  month: Month;
  setMonth: (m: Month) => void;
  first: Month;
  last: Month;
  workouts: ReadonlyMap<string, number>;
  today: string;
  onPick: () => void;
  onDay: (key: string) => void;
}) {
  const cells = monthCells(month, workouts, today);
  const earlier = !sameMonth(month, first);
  const later = !sameMonth(month, last);
  return (
    <>
      <View style={styles.between}>
        <View style={styles.monthNav}>
          <Pressable accessibilityRole="button" accessibilityLabel="Month before" accessibilityState={{ disabled: !earlier }} disabled={!earlier} onPress={() => { setMonth(nextMonth(month, -1)); }} style={styles.arrow}>
            <Icon name="back" size={18} colour={earlier ? "text" : "textFaint"} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${monthWords(month)}. Pick a month`} onPress={onPick} style={styles.monthName}>
            <Txt kind="h3" numberOfLines={1}>
              {monthWords(month)}
            </Txt>
            <Icon name="down" size={16} colour="orangeLight" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Month after" accessibilityState={{ disabled: !later }} disabled={!later} onPress={() => { setMonth(nextMonth(month, 1)); }} style={styles.arrow}>
            <Icon name="go" size={18} colour={later ? "text" : "textFaint"} />
          </Pressable>
        </View>
        <Txt kind="tiny" numberOfLines={1}>
          {activeDaysWords(cells)}
        </Txt>
      </View>
      <View style={styles.grid}>
        <View style={styles.week}>
          {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
            <View key={i} style={styles.headCell}>
              <Txt kind="tiny" style={styles.head}>
                {d}
              </Txt>
            </View>
          ))}
        </View>
        {weeksOf(cells).map((week, w) => (
          <View key={w} style={styles.week}>
            {week.map((c, i) =>
              c === null ? (
                <View key={`blank${String(i)}`} style={styles.cell} />
              ) : (
                <Pressable
                  key={c.key}
                  style={({ pressed }) => [styles.cell, pressed ? styles.pressed : null]}
                  accessibilityRole={c.later ? undefined : "button"}
                  accessibilityLabel={daySaid(c)}
                  disabled={c.later}
                  onPress={() => {
                    onDay(c.key);
                  }}
                >
                  {c.workouts > 0 ? (
                    <Rise delay={200 + (w * 7 + i) * 12} style={styles.flame}>
                      <Flame size={36} glow />
                    </Rise>
                  ) : null}
                  <View style={[styles.dayRing, c.today ? styles.today : null, c.workouts > 0 ? styles.litRing : null]}>
                    <Txt kind={c.workouts > 0 ? "tiny" : "small"} colour={c.workouts > 0 ? "onOrange" : c.later ? "textFaint" : "textSoft"} style={c.workouts > 0 ? styles.litNumber : styles.number}>
                      {String(c.date)}
                    </Txt>
                  </View>
                  {c.workouts > 1 ? (
                    <Txt kind="tiny" colour="gold" style={styles.times}>
                      {`×${String(c.workouts)}`}
                    </Txt>
                  ) : null}
                </Pressable>
              ),
            )}
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        <Flame size={12} />
        <Txt kind="tiny">A day you trained</Txt>
        <Txt kind="tiny" colour="gold" style={styles.bold}>
          ×2
        </Txt>
        <Txt kind="tiny">Two workouts</Txt>
      </View>
    </>
  );
}

/** The month's cells in weeks of seven, the last week filled out with blanks. */
function weeksOf<T>(cells: readonly (T | null)[]): (T | null)[][] {
  const out: (T | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    while (week.length < 7) week.push(null);
    out.push(week);
  }
  return out;
}

const SQUARE = 13;

function YearView({ today, days, workouts, onDay }: { today: string; days: number; workouts: ReadonlyMap<string, number>; onDay: (key: string) => void }) {
  const columns = yearColumns(today, days, workouts);
  const scroll = useRef<ScrollView>(null);
  const lit = [...workouts.entries()].filter(([, n]) => n > 0).length;
  return (
    <>
      <View style={styles.between}>
        <Txt kind="h3">{`Last ${String(days)} days`}</Txt>
        <Txt kind="tiny">{`${String(lit)} active ${lit === 1 ? "day" : "days"}`}</Txt>
      </View>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={() => {
          scroll.current?.scrollToEnd({ animated: false });
        }}
        contentContainerStyle={styles.year}
      >
        {columns.map((col) => (
          <View key={col.squares[0]?.key ?? col.label} style={styles.yearColumn}>
            <View style={styles.yearLabelBox}>
              <Txt kind="tiny" numberOfLines={1} style={styles.yearLabel}>
                {col.label}
              </Txt>
            </View>
            {col.squares.map((s) =>
              s.workouts > 0 ? (
                <Pressable
                  key={s.key}
                  style={[styles.square, LEVELS[level(s.workouts)]]}
                  accessibilityRole="button"
                  accessibilityLabel={squareSaid(s, today)}
                  onPress={() => {
                    onDay(s.key);
                  }}
                />
              ) : (
                <View key={s.key} style={[styles.square, s.outside ? styles.squareOut : LEVELS[level(s.workouts)]]} />
              ),
            )}
          </View>
        ))}
      </ScrollView>
      <View style={styles.legend}>
        <Txt kind="tiny">Less</Txt>
        {([0, 1, 2, 3] as const).map((l) => (
          <View key={l} style={[styles.square, LEVELS[l]]} />
        ))}
        <Txt kind="tiny">More</Txt>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", columnGap: 8, flexWrap: "wrap" },
  room: { height: 92 },
  seg: { flexDirection: "row", padding: 3, borderRadius: sizes.round, backgroundColor: colours.overPicture, borderWidth: 1, borderColor: colours.line },
  segItem: { minHeight: 32, paddingHorizontal: 12, borderRadius: sizes.round, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: colours.orangeFill, borderWidth: 1, borderColor: colours.orangeLine },
  segWords: { fontFamily: fonts.semibold },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 2 },
  arrow: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center" },
  grid: { gap: 4 },
  week: { flexDirection: "row" },
  headCell: { flex: 1, alignItems: "center" },
  cell: { flex: 1, minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 14 },
  pressed: { opacity: 0.7 },
  monthName: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: sizes.press },
  picker: { gap: 14 },
  pickYear: { gap: 8 },
  pickGrid: { flexDirection: "row", gap: 8 },
  // The same border lit or not: a gradient on a box whose border changes crashed Android (31a).
  pickMonth: { flex: 1, minHeight: 66, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 14, backgroundColor: colours.fill, borderWidth: 1, borderColor: chalk.glassLine },
  pickLit: { borderColor: chalk.bestLine, boxShadow: chalkShadows.trained },
  pickOn: { backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, borderColor: colours.orange, boxShadow: chalkShadows.picked },
  pickShut: { opacity: 0.35 },
  unseen: { opacity: 0 },
  pickDays: { flexDirection: "row", alignItems: "center", gap: 3 },
  boldWords: { fontFamily: fonts.bold },
  dayNone: { alignItems: "center", padding: 22, borderRadius: 16, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  dayBox: { gap: 8 },
  daySum: { flexDirection: "row", gap: 8, marginBottom: 6 },
  dayStat: { flex: 1, minHeight: 64, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  dayWorkout: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  dayKcal: { alignItems: "flex-end" },
  grow: { flex: 1 },
  head: { fontFamily: fonts.bold, letterSpacing: 0.8 },
  flame: { position: "absolute", top: 0, bottom: 2, alignItems: "center", justifyContent: "center" },
  dayRing: { minWidth: 30, minHeight: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 6 },
  today: { borderWidth: 1.5, borderColor: colours.text },
  number: { fontFamily: fonts.semibold },
  // A trained day's number sits low in its flame.
  litRing: { marginTop: 18 },
  litNumber: { fontFamily: fonts.bold, textShadowColor: colours.wordShadow, textShadowRadius: 3 },
  times: { position: "absolute", top: 0, right: 2, fontFamily: fonts.bold },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  bold: { fontFamily: fonts.bold, marginLeft: 8 },
  // Room after the last column for its month's name.
  year: { gap: 3, paddingVertical: 4, paddingRight: 28 },
  yearColumn: { gap: 3 },
  // A month's name runs on over the columns after it, which have none.
  yearLabelBox: { height: 14, width: SQUARE, overflow: "visible" },
  yearLabel: { position: "absolute", left: 0, width: 40 },
  square: { width: SQUARE, height: SQUARE, borderRadius: 3 },
  squareOut: { backgroundColor: "transparent" },
});

const LEVELS = StyleSheet.create({
  0: { backgroundColor: colours.track },
  1: { backgroundColor: colours.orangeLine },
  2: { backgroundColor: colours.orange },
  3: { backgroundColor: colours.orangeLight, boxShadow: shadows.dotGlow },
});
