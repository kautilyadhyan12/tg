import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { foodWeekResponseSchema, type FoodWeekFigure, type FoodWeekResponse } from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import Svg, { Line } from "react-native-svg";
import type { FoodBand } from "@app/shared";
import { colours, weekBarGlow, weekBarLight, type ColourName } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { SoftBar } from "../../look/Waiting";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead, type Read } from "../dashboard/useRead";
import { count } from "../dashboard/words";
import {
  WEEK_FIGURES,
  averageLine,
  barSaid,
  chartTop,
  dayLetter,
  factLead,
  factWords,
  monthLabel,
  TARGETS_DIFFER_WORDS,
  targetsDiffer,
  weekBars,
  weekLine,
  type Bar,
  type TodayHere,
} from "./weekRules";

// Your week in food (ROADMAP Stage 5 34f-ii; one Week tab since 32c-i, Kd's drawing of 2026-11-14): the last
// 7 or 30 days of any of the four figures, and the facts in words. The 7 days are read once for the page:
// its plates of the week are coloured from the same read.

export const FOOD_WEEK_READ = "/v1/nutrition/food-week";
const MONTH_READ = `${FOOD_WEEK_READ}?days=30`;
const CHART_HEIGHT = 112;

interface Ctx {
  /** Today as the day's plate shows it, or null where the phone cannot say. */
  here: TodayHere | null;
  /** Moves each time the server takes a meal or a change: the week is read again. */
  sent: number;
  /** The phone's own today: the week is read again when it moves on (midnight with the page open). */
  today: string;
  /** Opens setup where the daily numbers are missing. */
  onSetup: () => void;
}

/** The last 7 days, read again when the numbers or answers change (`fresh`), a meal is sent, or the day moves on. */
export function useFoodWeek({ fresh, sent, today }: { fresh: number; sent: number; today: string }): { read: Read<FoodWeekResponse>; again: () => void } {
  const week = useRead(FOOD_WEEK_READ, foodWeekResponseSchema, useZoneSaved() + fresh);
  useAgainOn(sent, week.again);
  useAgainOn(today, week.again);
  return week;
}

/** The Week tab. */
export function FoodWeek({ week, ...ctx }: Ctx & { week: { read: Read<FoodWeekResponse>; again: () => void } }) {
  const { read, again } = week;
  return (
    <Card style={styles.box}>
      {read.kind === "failed" ? (
        <View style={styles.row}>
          <Icon name="wifioff" size={18} colour="textSoft" />
          <Txt kind="small" style={styles.grow}>
            Your week couldn’t load.
          </Txt>
          <Button label="Try again" kind="link" say="Load your week again" onPress={again} />
        </View>
      ) : read.kind === "loading" ? (
        <SoftBar width="70%" />
      ) : (
        <WeekDetail week={read.data} ctx={ctx} />
      )}
    </Card>
  );
}

/** Reads again each time `moved` moves, never on the first draw (the read's own first read covers it). */
function useAgainOn(moved: number | string, again: () => void) {
  const first = useRef(moved);
  useEffect(() => {
    if (moved !== first.current) again();
  }, [moved, again]);
}

const SET_UP_WORDS = "Set daily numbers";

function WeekDetail({ week, ctx }: { week: FoodWeekResponse; ctx: Ctx }) {
  const [month, setMonth] = useState(false);
  const [figure, setFigure] = useState<FoodWeekFigure>("kcal");
  return (
    <View style={styles.detail}>
      <View style={styles.chips} accessibilityRole="radiogroup">
        <Chip label="7 days" small on={!month} onPress={() => { setMonth(false); }} />
        <Chip label="30 days" small on={month} onPress={() => { setMonth(true); }} />
      </View>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {WEEK_FIGURES.map((f) => (
          <Chip key={f.key} label={f.name} small on={figure === f.key} onPress={() => { setFigure(f.key); }} />
        ))}
      </View>
      {month ? <MonthRead figure={figure} ctx={ctx} /> : <Detail week={week} figure={figure} ctx={ctx} month={false} />}
    </View>
  );
}

function MonthRead({ figure, ctx }: { figure: FoodWeekFigure; ctx: Ctx }) {
  const { read, again } = useRead(MONTH_READ, foodWeekResponseSchema, useZoneSaved());
  useAgainOn(ctx.sent, again);
  useAgainOn(ctx.today, again);
  return <ReadOr read={read} again={again}>{(month) => <Detail week={month} figure={figure} ctx={ctx} month />}</ReadOr>;
}

function ReadOr({ read, again, children }: { read: Read<FoodWeekResponse>; again: () => void; children: (week: FoodWeekResponse) => ReactNode }) {
  if (read.kind === "loading") return <SoftBar width="70%" />;
  if (read.kind === "failed")
    return (
      <View style={styles.row}>
        <Txt kind="small" style={styles.grow}>
          These days couldn’t load.
        </Txt>
        <Button label="Try again" kind="link" onPress={again} />
      </View>
    );
  return <>{children(read.data)}</>;
}

function Detail({ week, figure, ctx, month }: { week: FoodWeekResponse; figure: FoodWeekFigure; ctx: Ctx; month: boolean }) {
  const bars = weekBars(week, figure, ctx.here);
  const line = weekLine(week, ctx.here);
  const facts = WEEK_FIGURES.flatMap((f) => {
    const words = factWords(f.key, week.facts[f.key]);
    return words === null ? [] : [{ words, lead: factLead(week.facts[f.key]) }];
  });
  const average = averageLine(week);
  const of = WEEK_FIGURES.find((f) => f.key === figure);
  const target = week.days.at(-1)?.targets?.[figure];
  return (
    <>
      {bars.every((b) => b.value === null) ? (
        <Txt kind="small">No meals on these days.</Txt>
      ) : (
        <>
          <Chart bars={bars} figure={figure} month={month} line={target ?? null} />
          <Legend bars={bars} />
          {target === undefined || of === undefined ? null : (
            <Txt kind="tiny">Line: your daily target, {count(target)} {of.unit} today</Txt>
          )}
          {targetsDiffer(bars, target ?? null) ? <Txt kind="tiny">{TARGETS_DIFFER_WORDS}</Txt> : null}
        </>
      )}
      <View style={styles.facts}>
        {facts.length > 0 ? (
          facts.map((fact) => <Fact key={fact.words} words={fact.words} lead={fact.lead} />)
        ) : (
          <>
            <Txt kind="small" colour="text">
              {line.words}
            </Txt>
            {line.setUp ? <Button label={SET_UP_WORDS} kind="soft" small onPress={ctx.onSetup} style={styles.start} /> : null}
          </>
        )}
        {facts.length > 0 && !month && factWords("kcal", week.facts.kcal) === null ? (
          <Txt kind="small" colour="text">
            {line.words}
          </Txt>
        ) : null}
        {average === null ? null : (
          <View style={styles.average}>
            <Txt kind="small">{average.words}</Txt>
          </View>
        )}
      </View>
      {bars.some((b) => b.about) ? <Txt kind="tiny">~ Includes a scan’s estimate.</Txt> : null}
      {bars.some((b) => b.current) ? <Txt kind="tiny">Some days are shown against today’s daily numbers.</Txt> : null}
      {average?.partial === true ? <Txt kind="tiny">* Some foods have no fibre or sodium figure.</Txt> : null}
    </>
  );
}

/** A fact in a box of its colour, with its sign: a cup on target, an arrow under or over (32c-i, as drawn). */
const FACT_LOOK = {
  on: { icon: "trophy", colour: "goodText", fill: "goodFill", line: "goodLine" },
  under: { icon: "down", colour: "blue", fill: "blueFill", line: "blueFill" },
  over: { icon: "up", colour: "orange", fill: "orangeFill", line: "orangeLine" },
} as const;

function Fact({ words, lead }: { words: string; lead: FoodBand | null }) {
  const look = lead === null ? null : FACT_LOOK[lead];
  return (
    <View style={[styles.fact, look === null ? null : { backgroundColor: colours[look.fill], borderColor: colours[look.line] }]}>
      {look === null ? null : <Icon name={look.icon} size={18} colour={look.colour} />}
      <Txt kind="small" colour="text" style={styles.grow}>
        {words}
      </Txt>
    </View>
  );
}

const LEGEND: readonly (readonly [ColourName, string])[] = [
  ["good", "On target"],
  ["blue", "Under"],
  ["orange", "Over"],
  ["textSoft", "No target"],
  ["textFaint", "Today so far"],
];

const BAND_COLOUR: Record<NonNullable<Bar["band"]>, ColourName> = { on: "good", under: "blue", over: "orange" };

function barColour(bar: Bar): ColourName {
  if (bar.today) return "textFaint";
  return bar.band === null ? "textSoft" : BAND_COLOUR[bar.band];
}

/** A bar in its colour; the three judged colours lit from the top and glowing (32c-i). */
function barLight(colour: ColourName) {
  if (colour === "good" || colour === "blue" || colour === "orange") {
    return { backgroundColor: colours[colour], experimental_backgroundImage: weekBarLight[colour], boxShadow: weekBarGlow[colour] };
  }
  return { backgroundColor: colours[colour] };
}

/** `line`: today's target, drawn once straight across the bars (null while there is none). */
function Chart({ bars, figure, month, line }: { bars: readonly Bar[]; figure: FoodWeekFigure; month: boolean; line: number | null }) {
  const top = chartTop(bars);
  const height = (n: number) => Math.max(2, Math.round((n / top) * CHART_HEIGHT));
  return (
    <View style={styles.chart}>
      <View style={[styles.bars, { height: CHART_HEIGHT }]}>
        {bars.map((bar) => (
          <View key={bar.day} style={[styles.column, month ? styles.thin : null]} accessible accessibilityLabel={barSaid(bar, figure)}>
            {bar.value === null ? null : (
              <>
                {bar.about ? (
                  <Txt kind="tiny" style={styles.about}>
                    ~
                  </Txt>
                ) : null}
                <View style={[styles.bar, month ? styles.thinBar : null, barLight(barColour(bar)), { height: height(bar.value) }]} />
              </>
            )}
          </View>
        ))}
        {line === null ? null : (
          <View pointerEvents="none" style={[styles.target, { bottom: height(line) }]}>
            <Svg width="100%" height={2}>
              <Line x1="0" y1="1" x2="100%" y2="1" stroke={colours.textSoft} strokeWidth={1.5} strokeDasharray="5 4" />
            </Svg>
          </View>
        )}
        {line === null ? null : (
          <Txt kind="tiny" colour="textSoft" style={[styles.lineWords, { bottom: height(line) + 4 }]}>
            {count(line)}
          </Txt>
        )}
      </View>
      <View style={styles.labels}>
        {bars.map((bar, i) => (
          <View key={bar.day} style={[styles.label, month ? styles.thin : null]}>
            <Txt kind="tiny" colour={bar.today ? "orange" : "textSoft"} numberOfLines={1} style={[styles.centre, month ? styles.date : null]}>
              {month ? monthLabel(bar.day, bars.length - 1 - i) : dayLetter(bar.day)}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The key names only the colours the bars use. */
function Legend({ bars }: { bars: readonly Bar[] }) {
  const used = new Set(bars.filter((b) => b.value !== null).map(barColour));
  const one = (colour: ColourName, words: string) => (
    <View key={colour} style={styles.key}>
      <View style={[styles.dot, { backgroundColor: colours[colour] }]} />
      <Txt kind="tiny">{words}</Txt>
    </View>
  );
  return (
    <View style={styles.legend}>
      {LEGEND.filter(([colour]) => used.has(colour)).map(([colour, words]) => one(colour, words))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
  start: { alignSelf: "flex-start" },
  detail: { gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  facts: { gap: 8 },
  chart: { gap: 6 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  labels: { flexDirection: "row", gap: 6 },
  column: { flex: 1, alignItems: "stretch", justifyContent: "flex-end", height: "100%" },
  label: { flex: 1, alignItems: "center", overflow: "visible" },
  // A date under a thin bar of the 30 days is wider than its bar, and is drawn across the bars beside it.
  date: { width: 32 },
  thin: { marginHorizontal: -2 },
  bar: { marginHorizontal: 6, borderTopLeftRadius: 999, borderTopRightRadius: 999, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  thinBar: { marginHorizontal: 0, borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  target: { position: "absolute", left: 0, right: 0, height: 2 },
  fact: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colours.line },
  average: { paddingTop: 10, borderTopWidth: 1, borderTopColor: colours.line },
  lineWords: { position: "absolute", right: 0 },
  about: { textAlign: "center" },
  centre: { textAlign: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6 },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
