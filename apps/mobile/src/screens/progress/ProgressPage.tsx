import { useState } from "react";
import { Animated, Image, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import {
  personalRecordsSchema,
  progressOverviewSchema,
  progressTrendSchema,
  type PersonalRecords,
  type ProgressPeriod,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Badge, Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import { barGradient, boxShade, colours, sizes } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon, type IconName } from "../../look/Icon";
import { GrowUp, Rise, useCountUp, useGrow } from "../../look/Motion";
import { pictures } from "../../look/pictures";
import { StatTile } from "../../look/StatTile";
import { fonts, Txt } from "../../look/Txt";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead } from "../dashboard/useRead";
import { NOT_KNOWN, count, hoursWords } from "../dashboard/words";
import {
  PERIODS,
  buckets,
  caloriesSaid,
  consistencyPct,
  consistencyWords,
  cutWords,
  dayKeyOf,
  noneWords,
  periodWindow,
  recordRows,
  recordsFrom,
  stepFor,
  stepTitle,
  streakWords,
  totals,
  type Bucket,
  type Totals,
  type Window,
} from "./progressRules";

// Me → Progress (ROADMAP Stage 5 35c-i): the browser's Progress page in the Dashboard's look. Its four
// numbers with their pictures, Calories Burned and the workouts drawn as they fill, Personal Records
// and Consistency, from the person's own reads. Each box rises in and each number counts up.

export const RECORDS_READ = "/v1/progress/records";
/** Today's streak and the longest: a streak has no period, so it is read once, as the Dashboard reads it. */
export const STREAK_READ = "/v1/progress/overview?period=all";
export const trendRead = (period: ProgressPeriod) => `/v1/progress/trend?period=${period}`;
const CHART_HEIGHT = 120;
/** Room above the tallest bar for its number. */
const BAR_ROOM = 18;
const STEP_EACH = { day: "Each day", week: "Each week", month: "Each month", year: "Each year" } as const;

export function ProgressPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<ProgressPeriod>("30d");
  return (
    <CoverPage open={open} title="Progress" picture="progress" onClose={onClose}>
      {open ? (
        <>
          {/* One row, swiped sideways where the phone is too narrow for all five, as drawn. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swipe} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
            {PERIODS.map((p) => (
              <Chip key={p.key} label={p.label} small on={period === p.key} onPress={() => { setPeriod(p.key); }} />
            ))}
          </ScrollView>
          {/* One read for each period, drawn only under its own chip: a late answer for the chip left
              behind is dropped with its boxes, and the boxes rise in again. */}
          <PeriodBoxes key={period} period={period} />
        </>
      ) : null}
    </CoverPage>
  );
}

function PeriodBoxes({ period }: { period: ProgressPeriod }) {
  const zone = useZoneSaved();
  const trend = useRead(trendRead(period), progressTrendSchema, zone);
  const records = useRead(RECORDS_READ, personalRecordsSchema, zone);
  const streak = useRead(STREAK_READ, progressOverviewSchema, zone);
  const reads = [trend, records, streak];
  if (reads.some((r) => r.read.kind === "failed")) {
    return (
      <Card style={styles.failed}>
        <Icon name="wifioff" size={18} colour="textSoft" />
        <Txt kind="small" style={styles.grow}>
          Your progress couldn’t load.
        </Txt>
        <Button
          label="Try again"
          kind="link"
          say="Load your progress again"
          onPress={() => {
            for (const r of reads) r.again();
          }}
        />
      </Card>
    );
  }
  if (trend.read.kind !== "ok" || records.read.kind !== "ok" || streak.read.kind !== "ok") return <Txt kind="small">{NOT_KNOWN}</Txt>;
  const w = periodWindow(period, dayKeyOf(new Date()), trend.read.data);
  const r = records.read.data;
  if (w === null || r.totalWorkouts === 0) return <NoWorkouts records={r} />;
  const sum = totals(trend.read.data.points, w);
  const bars = buckets(trend.read.data.points, w);
  const cut = cutWords(w);
  return (
    <>
      {cut === null ? null : (
        <Rise style={styles.cut}>
          <Icon name="clock" size={14} colour="orange" />
          <Txt kind="small" style={styles.grow}>
            {cut}
          </Txt>
        </Rise>
      )}
      <Tiles sum={sum} streak={streak.read.data} />
      {sum.workouts === 0 ? (
        <Rise delay={160}>
          <Card style={styles.box}>
            <Txt kind="strong">{noneWords(w)}</Txt>
          </Card>
        </Rise>
      ) : (
        <>
          <Rise delay={160}>
            <Card style={styles.box}>
              <BoxTitle icon="flame" title="Calories Burned" side={STEP_EACH[stepFor(w.days)]} />
              <Area bars={bars} said={caloriesSaid(bars, sum.kcal)} />
            </Card>
          </Rise>
          <Rise delay={240}>
            <Card style={styles.box}>
              <BoxTitle icon="calendar" title={stepTitle(stepFor(w.days))} />
              <Bars bars={bars} />
            </Card>
          </Rise>
        </>
      )}
      <Rise delay={320}>
        <Records records={r} />
      </Rise>
      <Rise delay={400}>
        <Consistency sum={sum} w={w} />
      </Rise>
    </>
  );
}

/** The browser's four numbers, in the Dashboard's boxes with their pictures, counted up. */
function Tiles({ sum, streak }: { sum: Totals; streak: { currentStreak: number; longestStreak: number } }) {
  const workouts = useCountUp(sum.workouts, 60);
  const time = useCountUp(sum.durationMs, 120);
  const kcal = useCountUp(sum.kcal, 180);
  const days = useCountUp(streak.currentStreak, 240);
  return (
    <Rise delay={60} style={styles.grid}>
      <StatTile picture="totalworkout" icon="dumbbell" value={count(Math.round(workouts))} label="Workouts" say={`${count(sum.workouts)} workouts`} />
      <StatTile picture="hourstrained" icon="clock" value={hoursWords(time)} label="Time Trained" say={`${hoursWords(sum.durationMs)} trained`} />
      <StatTile picture="caloriesburned" icon="flame" value={count(Math.round(kcal))} label="Calories Burned" say={`${count(sum.kcal)} calories burned`} />
      <StatTile
        picture="streak"
        icon="zap"
        tone="gold"
        value={streakWords(Math.round(days))}
        label="Streak"
        note={`Longest: ${streakWords(streak.longestStreak)}`}
        say={`Streak ${streakWords(streak.currentStreak)}, longest ${streakWords(streak.longestStreak)}`}
      />
    </Rise>
  );
}

function BoxTitle({ icon, title, side }: { icon: IconName; title: string; side?: string }) {
  return (
    <View style={styles.between}>
      <View style={styles.titleRow}>
        <Icon name={icon} size={16} colour="orange" />
        <Txt kind="h3" style={styles.boxTitle}>
          {title}
        </Txt>
      </View>
      {side === undefined ? null : <Txt kind="tiny">{side}</Txt>}
    </View>
  );
}

/** Nothing in the reads at all. A plan that shows only its last N days says older ones are kept. */
function NoWorkouts({ records }: { records: PersonalRecords }) {
  return (
    <Rise>
      <Card style={styles.box}>
        <Txt kind="strong">{records.limitedToDays === null ? "No workouts yet" : `No workouts in your last ${count(records.limitedToDays)} days`}</Txt>
        {records.limitedToDays === null ? null : <Txt kind="small">Any older workouts are still saved.</Txt>}
      </Card>
    </Rise>
  );
}

/** The records beside the trophy lifted high, as the Dashboard's boxes stand beside their pictures. */
function Records({ records }: { records: PersonalRecords }) {
  return (
    <Card style={styles.split}>
      <View style={[styles.grow, styles.inner]}>
        <View style={styles.tightest}>
          <BoxTitle icon="trophy" title="Personal Records" />
          <Txt kind="tiny">{recordsFrom(records)}</Txt>
        </View>
        {recordRows(records).map((row) => (
          <View key={row.label} style={styles.record}>
            <Badge icon={row.icon} tone={row.held ? "orange" : "plain"} />
            <View style={styles.grow}>
              <Txt kind="tiny">{row.label}</Txt>
              <Txt kind="strong" colour={row.held ? "text" : "textSoft"}>
                {row.value}
              </Txt>
            </View>
          </View>
        ))}
      </View>
      <View style={styles.sideArt}>
        <Image source={pictures.records} resizeMode="contain" style={styles.fill} accessible={false} />
      </View>
    </Card>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const RING = 96;
const RING_STROKE = 9;

/** The days with a workout as a ring that fills, over the strap's woven bars. */
function Consistency({ sum, w }: { sum: Totals; w: Window }) {
  const pct = consistencyPct(sum, w);
  const shown = useCountUp(pct, 480, 1000);
  const grown = useGrow(pct / 100, 480, 1000);
  const r = (RING - RING_STROKE) / 2;
  const around = 2 * Math.PI * r;
  const offset = grown.interpolate({ inputRange: [0, 1], outputRange: [around, 0] });
  const words = consistencyWords(sum, w);
  return (
    <View style={[styles.card, styles.consistency]}>
      <View style={styles.consistencyArt}>
        <Image source={pictures.consistency} resizeMode="cover" style={styles.fill} accessible={false} />
      </View>
      <View style={[StyleSheet.absoluteFill, styles.shade]} />
      <View style={[styles.inner, styles.consistencyWords]}>
        <BoxTitle icon="target" title="Consistency" />
        <View style={styles.ringRow} accessible accessibilityLabel={`Days you worked out: ${words}, ${String(pct)} percent`}>
          <View style={{ width: RING, height: RING }}>
            <Svg width={RING} height={RING}>
              <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={colours.track} strokeWidth={RING_STROKE} fill="none" />
              {pct > 0 ? (
                <AnimatedCircle
                  cx={RING / 2}
                  cy={RING / 2}
                  r={r}
                  stroke={colours.orange}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${String(around)} ${String(around)}`}
                  strokeDashoffset={offset}
                  fill="none"
                  transform={`rotate(-90 ${String(RING / 2)} ${String(RING / 2)})`}
                />
              ) : null}
            </Svg>
            <View style={[StyleSheet.absoluteFill, styles.ringMiddle]}>
              <Txt kind="big" colour="orange">
                {`${String(Math.round(shown))}%`}
              </Txt>
            </View>
          </View>
          <View style={styles.grow}>
            <Txt kind="strong">{words}</Txt>
            <Txt kind="tiny">with a workout</Txt>
          </View>
        </View>
      </View>
    </View>
  );
}

/** The calories of each bar as a glowing line over a soft fill, drawn from the left. One bar is a dot. */
function Area({ bars, said }: { bars: readonly Bucket[]; said: string }) {
  const [width, setWidth] = useState(0);
  const drawn = useGrow(1, 260, 1100);
  const top = Math.max(1, ...bars.map((b) => b.kcal));
  const edge = 8;
  const x = (i: number) => (bars.length === 1 ? width / 2 : edge + (i / (bars.length - 1)) * (width - 2 * edge));
  const y = (kcal: number) => edge + 14 + (1 - kcal / top) * (CHART_HEIGHT - 2 * edge - 14);
  const line = bars.map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(b.kcal).toFixed(1)}`).join(" ");
  const peak = bars.reduce((best, b, i) => ((bars[best]?.kcal ?? 0) < b.kcal ? i : best), 0);
  const peakBar = bars[peak];
  return (
    <View style={styles.chart}>
      <View
        accessible
        accessibilityLabel={said}
        style={{ height: CHART_HEIGHT }}
        onLayout={(e) => {
          setWidth(e.nativeEvent.layout.width);
        }}
      >
        {width > 0 ? (
          <Animated.View style={[styles.reveal, { width: drawn.interpolate({ inputRange: [0, 1], outputRange: [0, width] }) }]}>
            <Svg width={width} height={CHART_HEIGHT}>
              <Defs>
                <LinearGradient id="burned" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colours.orange} stopOpacity={0.45} />
                  <Stop offset="1" stopColor={colours.orange} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              {bars.length === 1 ? null : (
                <>
                  <Path d={`${line} L${x(bars.length - 1).toFixed(1)} ${String(CHART_HEIGHT)} L${x(0).toFixed(1)} ${String(CHART_HEIGHT)} Z`} fill="url(#burned)" />
                  <Path d={line} fill="none" stroke={colours.orange} strokeOpacity={0.22} strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
                  <Path d={line} fill="none" stroke={colours.orangeLight} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
                </>
              )}
              {bars.length > 14
                ? null
                : bars.map((b, i) => (
                    <Circle key={b.from} cx={x(i)} cy={y(b.kcal)} r={i === peak ? 5 : 3} fill={i === peak ? colours.orangeLight : colours.orange} stroke={colours.box} strokeWidth={2} />
                  ))}
            </Svg>
            {peakBar === undefined || peakBar.kcal === 0 ? null : (
              <View pointerEvents="none" style={[styles.peak, { left: Math.max(0, Math.min(width - 64, x(peak) - 32)), top: Math.max(0, y(peakBar.kcal) - 24) }]}>
                <Txt kind="tiny" colour="orangeLight" style={styles.peakWords}>
                  {count(peakBar.kcal)} kcal
                </Txt>
              </View>
            )}
          </Animated.View>
        ) : null}
      </View>
      <Labels bars={bars} />
    </View>
  );
}

/** The workouts of each bar, in orange running light at the top, growing up one after another. */
function Bars({ bars }: { bars: readonly Bucket[] }) {
  const top = Math.max(1, ...bars.map((b) => b.workouts));
  const each = Math.min(70, Math.round(500 / Math.max(1, bars.length)));
  return (
    <View style={styles.chart}>
      <View style={[styles.bars, { height: CHART_HEIGHT }]}>
        {bars.map((bar, i) => (
          <View key={bar.from} style={styles.column} accessible accessibilityLabel={bar.said}>
            {bar.workouts === 0 ? null : (
              <>
                <Rise delay={320 + i * each}>
                  <Txt kind="tiny" colour="textSoft" style={styles.centre}>
                    {count(bar.workouts)}
                  </Txt>
                </Rise>
                <GrowUp delay={280 + i * each} style={[styles.bar, { height: Math.max(6, Math.round((bar.workouts / top) * (CHART_HEIGHT - BAR_ROOM))) }]} />
              </>
            )}
          </View>
        ))}
      </View>
      <Labels bars={bars} />
    </View>
  );
}

function Labels({ bars }: { bars: readonly Bucket[] }) {
  return (
    <View style={styles.labels}>
      {bars.map((bar) => (
        <View key={bar.from} style={styles.label}>
          <Txt kind="tiny" numberOfLines={1} style={styles.labelWords}>
            {bar.label}
          </Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  // To the phone's edge, with room for the lit chip's glow.
  swipe: { marginHorizontal: -sizes.edge, marginVertical: -8 },
  chips: { gap: 8, paddingHorizontal: sizes.edge, paddingVertical: 8 },
  box: { gap: 14 },
  card: {
    backgroundColor: colours.box,
    borderWidth: 1,
    borderColor: colours.line,
    borderRadius: sizes.boxRadius,
    overflow: "hidden",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  boxTitle: { fontSize: 14, lineHeight: 18, color: colours.textSoft },
  grow: { flex: 1 },
  tightest: { gap: 2 },
  inner: { padding: 14, gap: 12 },
  failed: { flexDirection: "row", alignItems: "center", gap: 8 },
  cut: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 14, backgroundColor: colours.orangeFill },
  split: { flexDirection: "row", padding: 0, gap: 0 },
  // Beside the rows and never under them, as on the Dashboard's boxes.
  sideArt: { width: 112 },
  fill: { position: "absolute", width: "100%", height: "100%" },
  record: { flexDirection: "row", alignItems: "center", gap: 12 },
  // The picture on the right half, the box's own colour under the words on the left.
  consistency: { minHeight: 170 },
  consistencyArt: { position: "absolute", top: 0, bottom: 0, right: 0, width: "62%" },
  consistencyWords: { width: "70%" },
  shade: { experimental_backgroundImage: boxShade },
  ringRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  ringMiddle: { alignItems: "center", justifyContent: "center" },
  chart: { gap: 6 },
  reveal: { height: CHART_HEIGHT, overflow: "hidden" },
  peak: { position: "absolute", width: 64, alignItems: "center" },
  peakWords: { fontFamily: fonts.semibold },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  column: { flex: 1, justifyContent: "flex-end", height: "100%", gap: 4 },
  // Flat ends at the foot, round at the top, light orange running down to orange; it never has a border.
  bar: { borderTopLeftRadius: 7, borderTopRightRadius: 7, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: colours.orange, experimental_backgroundImage: barGradient },
  labels: { flexDirection: "row", gap: 8 },
  label: { flex: 1, alignItems: "center", overflow: "visible" },
  centre: { textAlign: "center" },
  // Wider than a thin bar: a crowded row names only some bars, so a name runs under its blank neighbours.
  labelWords: { textAlign: "center", width: 72 },
});
