import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { foodWeekResponseSchema, type FoodWeekFigure, type FoodWeekResponse } from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import { colours, type ColourName } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead, type Read } from "../dashboard/useRead";
import { NOT_KNOWN, count } from "../dashboard/words";
import {
  WEEK_FIGURES,
  averageLine,
  barSaid,
  chartTop,
  dayLetter,
  factWords,
  monthLabel,
  TARGETS_DIFFER_WORDS,
  targetsDiffer,
  weekBars,
  weekLine,
  type Bar,
  type TodayHere,
} from "./weekRules";

// Your week in food (ROADMAP Stage 5 34f-ii): a box on the Food screen with the last 7 days' calories,
// and a box from the bottom with 7 or 30 days of any of the four figures, and the facts in words.

export const FOOD_WEEK_READ = "/v1/nutrition/food-week";
const MONTH_READ = `${FOOD_WEEK_READ}?days=30`;
const CHART_HEIGHT = 112;

interface Ctx {
  /** Today as the day's rings show it, or null where the phone cannot say. */
  here: TodayHere | null;
  /** Moves each time the server takes a meal or a change: the week is read again. */
  sent: number;
  /** The phone's own today: the week is read again when it moves on (midnight with the page open). */
  today: string;
  /** Opens setup where the daily numbers are missing. */
  onSetup: () => void;
}

interface FoodWeekProps extends Ctx {
  /** Moves when the daily numbers or the setup answers change. */
  fresh: number;
}

export function FoodWeek({ fresh, ...ctx }: FoodWeekProps) {
  const { read, again } = useRead(FOOD_WEEK_READ, foodWeekResponseSchema, useZoneSaved() + fresh);
  const [open, setOpen] = useState(false);
  useAgainOn(ctx.sent, again);
  useAgainOn(ctx.today, again);
  const setUp = () => {
    setOpen(false);
    ctx.onSetup();
  };
  return (
    <Card style={styles.box}>
      <View style={styles.row}>
        <View style={[styles.titleRow, styles.grow]}>
          <Icon name="chart" size={16} colour="orange" />
          <Txt kind="h3">This Week</Txt>
        </View>
        {read.kind === "ok" ? <Button label="See your week" kind="link" onPress={() => { setOpen(true); }} /> : null}
      </View>
      {read.kind === "failed" ? (
        <View style={styles.row}>
          <Icon name="wifioff" size={18} colour="textSoft" />
          <Txt kind="small" style={styles.grow}>
            Your week couldn’t load.
          </Txt>
          <Button label="Try again" kind="link" say="Load your week again" onPress={again} />
        </View>
      ) : read.kind === "loading" ? (
        <Txt kind="small">{NOT_KNOWN}</Txt>
      ) : (
        <WeekBody week={read.data} here={ctx.here} onSetup={ctx.onSetup} />
      )}
      <Sheet open={open && read.kind === "ok"} title="Your Week in Food" onClose={() => { setOpen(false); }}>
        {read.kind === "ok" && open ? <WeekDetail week={read.data} ctx={{ ...ctx, onSetup: setUp }} /> : null}
      </Sheet>
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

function WeekBody({ week, here, onSetup }: { week: FoodWeekResponse; here: TodayHere | null; onSetup: () => void }) {
  const bars = weekBars(week, "kcal", here);
  const line = weekLine(week, here);
  const target = week.days.at(-1)?.targets?.kcal;
  return (
    <>
      {bars.every((b) => b.value === null) ? null : (
        <>
          <Chart bars={bars} figure="kcal" month={false} line={target ?? null} />
          <Legend bars={bars} />
        </>
      )}
      {bars.every((b) => b.value === null) || target === undefined ? null : (
        <Txt kind="tiny">Line: your daily target, {count(target)} kcal today</Txt>
      )}
      {targetsDiffer(bars, target ?? null) ? <Txt kind="tiny">{TARGETS_DIFFER_WORDS}</Txt> : null}
      <Txt kind="small" colour="text">
        {line.words}
      </Txt>
      {line.setUp ? <Button label={SET_UP_WORDS} kind="soft" small onPress={onSetup} style={styles.start} /> : null}
    </>
  );
}

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
  if (read.kind === "loading") return <Txt kind="small">{NOT_KNOWN}</Txt>;
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
  const facts = WEEK_FIGURES.map((f) => factWords(f.key, week.facts[f.key])).filter((w): w is string => w !== null);
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
          facts.map((words) => (
            <Txt key={words} kind="small" colour="text">
              {words}
            </Txt>
          ))
        ) : (
          <>
            <Txt kind="small" colour="text">
              {line.words}
            </Txt>
            {line.setUp ? <Button label={SET_UP_WORDS} kind="soft" small onPress={ctx.onSetup} style={styles.start} /> : null}
          </>
        )}
        {average === null ? null : <Txt kind="small">{average.words}</Txt>}
      </View>
      {bars.some((b) => b.about) ? <Txt kind="tiny">~ Includes a scan’s estimate.</Txt> : null}
      {bars.some((b) => b.current) ? <Txt kind="tiny">Some days are shown against today’s daily numbers.</Txt> : null}
      {average?.partial === true ? <Txt kind="tiny">* Some foods have no fibre or sodium figure.</Txt> : null}
    </>
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
                <View style={[styles.bar, { height: height(bar.value), backgroundColor: colours[barColour(bar)] }]} />
              </>
            )}
          </View>
        ))}
        {line === null ? null : <View pointerEvents="none" style={[styles.target, { bottom: height(line) }]} />}
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
  facts: { gap: 6 },
  chart: { gap: 6 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  labels: { flexDirection: "row", gap: 6 },
  column: { flex: 1, alignItems: "stretch", justifyContent: "flex-end", height: "100%" },
  label: { flex: 1, alignItems: "center", overflow: "visible" },
  // A date under a thin bar of the 30 days is wider than its bar, and is drawn across the bars beside it.
  date: { width: 32 },
  thin: { marginHorizontal: -2 },
  bar: { borderTopLeftRadius: 6, borderTopRightRadius: 6 },
  target: { position: "absolute", left: 0, right: 0, height: 2, borderRadius: 1, backgroundColor: colours.text },
  about: { textAlign: "center" },
  centre: { textAlign: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 6 },
  key: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
