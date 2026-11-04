import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { progressHeatmapSchema, type ProgressHeatmap } from "@app/shared";
import { colours, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Rise } from "../../look/Motion";
import { fonts, Txt } from "../../look/Txt";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead } from "../dashboard/useRead";
import { activeDaysWords, daySaid, level, monthCells, monthOf, monthRange, monthWords, nextMonth, sameMonth, yearColumns, type Month } from "./calendarRules";
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
        <MonthView month={month} setMonth={setMonth} first={range.first} last={range.last} workouts={workouts} today={today} />
      ) : (
        <YearView today={today} days={days} workouts={workouts} />
      )}
    </>
  );
}

function MonthView({ month, setMonth, first, last, workouts, today }: { month: Month; setMonth: (m: Month) => void; first: Month; last: Month; workouts: ReadonlyMap<string, number>; today: string }) {
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
          <Txt kind="h3" numberOfLines={1}>
            {monthWords(month)}
          </Txt>
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
                <View key={c.key} style={styles.cell} accessible accessibilityLabel={daySaid(c)}>
                  {c.workouts > 0 ? (
                    <Rise delay={200 + (w * 7 + i) * 12} style={styles.flame}>
                      <Flame size={30} />
                    </Rise>
                  ) : null}
                  <View style={[styles.dayRing, c.today ? styles.today : null]}>
                    <Txt kind="small" colour={c.workouts > 0 ? "onOrange" : c.later ? "textFaint" : "textSoft"} style={c.workouts > 0 ? styles.litNumber : styles.number}>
                      {String(c.date)}
                    </Txt>
                  </View>
                  {c.workouts > 1 ? (
                    <Txt kind="tiny" colour="gold" style={styles.times}>
                      {`×${String(c.workouts)}`}
                    </Txt>
                  ) : null}
                </View>
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

function YearView({ today, days, workouts }: { today: string; days: number; workouts: ReadonlyMap<string, number> }) {
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
            {col.squares.map((s) => (
              <View
                key={s.key}
                style={[styles.square, s.outside ? styles.squareOut : LEVELS[level(s.workouts)]]}
                accessible={s.workouts > 0}
                accessibilityLabel={s.workouts > 0 ? `${s.key}, ${String(s.workouts)} ${s.workouts === 1 ? "workout" : "workouts"}` : undefined}
              />
            ))}
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
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  room: { height: 92 },
  seg: { flexDirection: "row", padding: 3, borderRadius: sizes.round, backgroundColor: colours.overPicture, borderWidth: 1, borderColor: colours.line },
  segItem: { minHeight: 32, paddingHorizontal: 12, borderRadius: sizes.round, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: colours.orangeFill, borderWidth: 1, borderColor: colours.orangeLine },
  segWords: { fontFamily: fonts.semibold },
  monthNav: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1 },
  arrow: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center" },
  grid: { gap: 4 },
  week: { flexDirection: "row" },
  headCell: { flex: 1, alignItems: "center" },
  cell: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" },
  head: { fontFamily: fonts.bold, letterSpacing: 0.8 },
  flame: { position: "absolute", top: 0, bottom: 2, alignItems: "center", justifyContent: "center" },
  dayRing: { minWidth: 30, minHeight: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginTop: 6 },
  today: { borderWidth: 1.5, borderColor: colours.text },
  number: { fontFamily: fonts.semibold },
  litNumber: { fontFamily: fonts.bold, textShadowColor: colours.wordShadow, textShadowRadius: 3 },
  times: { position: "absolute", top: 0, right: 2, fontFamily: fonts.bold },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  bold: { fontFamily: fonts.bold, marginLeft: 8 },
  year: { gap: 3, paddingVertical: 4 },
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
