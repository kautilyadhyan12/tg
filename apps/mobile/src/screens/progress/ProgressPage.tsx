import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { personalRecordsSchema, progressTrendSchema, type PersonalRecords, type ProgressPeriod } from "@app/shared";
import { Button } from "../../look/Button";
import { Badge, Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import { colours } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead } from "../dashboard/useRead";
import { NOT_KNOWN, count } from "../dashboard/words";
import {
  PERIODS,
  buckets,
  caloriesSaid,
  consistencyWords,
  cutWords,
  dayKeyOf,
  periodWindow,
  recordRows,
  recordsFrom,
  stepFor,
  stepTitle,
  totals,
  type Bucket,
} from "./progressRules";

// Me → Progress (ROADMAP Stage 5 35c-i; docs/design/phone/pages/Progress.src.html): the five periods,
// Calories Burned, the workouts in bars, Personal Records and Consistency, from the person's own reads.

export const RECORDS_READ = "/v1/progress/records";
export const trendRead = (period: ProgressPeriod) => `/v1/progress/trend?period=${period}`;
const CHART_HEIGHT = 110;

export function ProgressPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [period, setPeriod] = useState<ProgressPeriod>("30d");
  return (
    <CoverPage open={open} title="Progress" picture="progress" onClose={onClose}>
      {open ? (
        <>
          <View style={styles.chips} accessibilityRole="radiogroup">
            {PERIODS.map((p) => (
              <Chip key={p.key} label={p.label} small on={period === p.key} onPress={() => { setPeriod(p.key); }} />
            ))}
          </View>
          {/* One read for each period, drawn only under its own chip: a late answer for the chip left
              behind is dropped with its box. */}
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
  if (trend.read.kind === "failed" || records.read.kind === "failed") {
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
            trend.again();
            records.again();
          }}
        />
      </Card>
    );
  }
  if (trend.read.kind === "loading" || records.read.kind === "loading") return <Txt kind="small">{NOT_KNOWN}</Txt>;
  const today = dayKeyOf(new Date());
  const w = periodWindow(period, today, trend.read.data);
  const r = records.read.data;
  if (w === null || r.totalWorkouts === 0) return <NoWorkouts records={r} />;
  const sum = totals(trend.read.data.points, w);
  const bars = buckets(trend.read.data.points, w);
  const cut = cutWords(w);
  return (
    <>
      {cut === null ? null : (
        <View style={styles.cut}>
          <Icon name="clock" size={14} colour="orange" />
          <Txt kind="small" style={styles.grow}>
            {cut}
          </Txt>
        </View>
      )}
      <Card style={styles.box}>
        <View style={styles.between}>
          <Txt kind="h3">Calories Burned</Txt>
          <Txt kind="strong" colour="orange">
            {count(sum.kcal)} kcal
          </Txt>
        </View>
        <Area bars={bars} said={caloriesSaid(bars, sum.kcal)} />
      </Card>
      <Card style={styles.box}>
        <View style={styles.between}>
          <Txt kind="h3">{stepTitle(stepFor(w.days))}</Txt>
          <Txt kind="small">
            {count(sum.workouts)} {sum.workouts === 1 ? "workout" : "workouts"}
          </Txt>
        </View>
        <Bars bars={bars} />
      </Card>
      <Records records={r} />
      <Card style={styles.box}>
        <View style={styles.between}>
          <Txt kind="h3">Consistency</Txt>
          <Txt kind="small">{consistencyWords(sum, w)}</Txt>
        </View>
        <View style={styles.track} accessible accessibilityLabel={`Days you worked out: ${consistencyWords(sum, w)}`}>
          <View style={[styles.lit, { flex: sum.daysTrained }]} />
          <View style={{ flex: Math.max(0, w.days - sum.daysTrained) }} />
        </View>
      </Card>
    </>
  );
}

/** Nothing in the reads at all. A plan that shows only its last N days says older ones are kept. */
function NoWorkouts({ records }: { records: PersonalRecords }) {
  return (
    <Card style={styles.box}>
      <Txt kind="strong">{records.limitedToDays === null ? "No workouts yet" : `No workouts in your last ${count(records.limitedToDays)} days`}</Txt>
      {records.limitedToDays === null ? null : <Txt kind="small">Any older workouts are still saved.</Txt>}
    </Card>
  );
}

function Records({ records }: { records: PersonalRecords }) {
  return (
    <Card style={styles.box}>
      <View style={styles.between}>
        <Txt kind="h3">Personal Records</Txt>
        <Txt kind="tiny">{recordsFrom(records)}</Txt>
      </View>
      {recordRows(records).map((row) => (
        <View key={row.label} style={styles.record}>
          <Badge icon={row.icon} />
          <Txt kind="strong" style={styles.grow}>
            {row.label}
          </Txt>
          <Txt kind="strong" colour={row.value.endsWith("yet") ? "textSoft" : "orange"}>
            {row.value}
          </Txt>
        </View>
      ))}
    </Card>
  );
}

/** The calories of each bar as a line over a soft fill, as drawn. One bar is a dot. */
function Area({ bars, said }: { bars: readonly Bucket[]; said: string }) {
  const [width, setWidth] = useState(0);
  const top = Math.max(1, ...bars.map((b) => b.kcal));
  const edge = 4;
  const x = (i: number) => (bars.length === 1 ? width / 2 : (i / (bars.length - 1)) * width);
  const y = (kcal: number) => edge + (1 - kcal / top) * (CHART_HEIGHT - 2 * edge);
  const line = bars.map((b, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(b.kcal).toFixed(1)}`).join(" ");
  const first = bars[0];
  return (
    <View
      accessible
      accessibilityLabel={said}
      style={{ height: CHART_HEIGHT }}
      onLayout={(e) => {
        setWidth(e.nativeEvent.layout.width);
      }}
    >
      {width > 0 ? (
        <Svg width={width} height={CHART_HEIGHT}>
          <Defs>
            <LinearGradient id="burned" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colours.orange} stopOpacity={0.35} />
              <Stop offset="1" stopColor={colours.orange} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {bars.length === 1 && first !== undefined ? (
            <Circle cx={x(0)} cy={y(first.kcal)} r={4} fill={colours.orange} />
          ) : (
            <>
              <Path d={`${line} L${width.toFixed(1)} ${String(CHART_HEIGHT)} L0 ${String(CHART_HEIGHT)} Z`} fill="url(#burned)" />
              <Path d={line} fill="none" stroke={colours.orange} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
        </Svg>
      ) : null}
    </View>
  );
}

function Bars({ bars }: { bars: readonly Bucket[] }) {
  const top = Math.max(1, ...bars.map((b) => b.workouts));
  return (
    <View style={styles.chart}>
      <View style={[styles.bars, { height: CHART_HEIGHT }]}>
        {bars.map((bar) => (
          <View key={bar.from} style={styles.column} accessible accessibilityLabel={bar.said}>
            {bar.workouts === 0 ? null : (
              <View style={[styles.bar, { height: Math.max(4, Math.round((bar.workouts / top) * CHART_HEIGHT)) }]} />
            )}
          </View>
        ))}
      </View>
      <View style={styles.labels}>
        {bars.map((bar) => (
          <View key={bar.from} style={styles.label}>
            <Txt kind="tiny" numberOfLines={1} style={styles.centre}>
              {bar.label}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  box: { gap: 12 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  grow: { flex: 1 },
  failed: { flexDirection: "row", alignItems: "center", gap: 8 },
  cut: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 14, backgroundColor: colours.orangeFill },
  record: { flexDirection: "row", alignItems: "center", gap: 12 },
  track: { flexDirection: "row", height: 8, borderRadius: 4, backgroundColor: colours.track, overflow: "hidden" },
  lit: { height: 8, borderRadius: 4, backgroundColor: colours.orange },
  chart: { gap: 6 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  column: { flex: 1, justifyContent: "flex-end", height: "100%" },
  bar: { borderTopLeftRadius: 6, borderTopRightRadius: 6, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: colours.orange },
  labels: { flexDirection: "row", gap: 8 },
  label: { flex: 1, alignItems: "center", overflow: "visible" },
  centre: { textAlign: "center", width: 44 },
});
