import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { progressDistributionSchema, progressTrendSchema, type ProgressDistribution, type ProgressPeriod } from "@app/shared";
import { Chip } from "../../look/Chip";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Rise } from "../../look/Motion";
import { Txt } from "../../look/Txt";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead } from "../dashboard/useRead";
import { count, hoursWords } from "../dashboard/words";
import { CaloriesChart, DayDots, FamilyRing, FillRing, sliceColour, WeekBars } from "./charts";
import { setsWords, slices } from "./otherRules";
import { ArtBox, BoxTitle, ReadOr } from "./parts";
import {
  PERIODS,
  addDays,
  buckets,
  consistencyPct,
  consistencyWords,
  cutWords,
  dayKeyOf,
  noneWords,
  periodWindow,
  stepFor,
  stepTitle,
  totals,
  type Window,
} from "./progressRules";

// Progress's Trends (ROADMAP Stage 5 35c-i): the five periods, then Calories Burned, Workouts Per
// Week, Consistency and Exercise Categories, each over the period's whole days ending today.

export const trendRead = (period: ProgressPeriod) => `/v1/progress/trend?period=${period}`;
export const distributionRead = (period: ProgressPeriod) => `/v1/progress/distribution?period=${period}`;
const EACH = { day: "Each day", week: "Each week", month: "Each month", year: "Each year" } as const;

export function Trends() {
  const [period, setPeriod] = useState<ProgressPeriod>("30d");
  return (
    <>
      {/* One row, swiped sideways where the phone is too narrow for all five. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.swipe} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
        {PERIODS.map((p) => (
          <Chip key={p.key} label={p.label} small on={period === p.key} onPress={() => { setPeriod(p.key); }} />
        ))}
      </ScrollView>
      {/* One read for each period, drawn only under its own chip: a late answer for the chip left
          behind is dropped with its boxes, and the boxes rise in again. */}
      <PeriodTrends key={period} period={period} />
    </>
  );
}

function PeriodTrends({ period }: { period: ProgressPeriod }) {
  const zone = useZoneSaved();
  const trend = useRead(trendRead(period), progressTrendSchema, zone);
  const families = useRead(distributionRead(period), progressDistributionSchema, zone);
  return (
    <ReadOr read={trend.read} again={trend.again} what="Your trends">
      {(t) => {
        const w = periodWindow(period, dayKeyOf(new Date()), t);
        if (w === null) {
          return (
            <Rise>
              <ArtBox picture="etch">
                <Txt kind="strong">{t.limitedToDays === null ? "No workouts yet" : `No workouts in your last ${count(t.limitedToDays)} days`}</Txt>
                {t.limitedToDays === null ? null : <Txt kind="small">Any older workouts are still saved.</Txt>}
              </ArtBox>
            </Rise>
          );
        }
        const sum = totals(t.points, w);
        const bars = buckets(t.points, w);
        const step = stepFor(w.days);
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
            {sum.workouts === 0 ? (
              <Rise delay={60}>
                <ArtBox picture="etch">
                  <Txt kind="strong">{noneWords(w)}</Txt>
                </ArtBox>
              </Rise>
            ) : (
              <>
                <Rise delay={60}>
                  <ArtBox picture="etch">
                    <BoxTitle
                      icon="flame"
                      title="Calories Burned"
                      side={
                        <Txt kind="big" colour="orangeLight">
                          {`${count(sum.kcal)} `}
                          <Txt kind="small">kcal</Txt>
                        </Txt>
                      }
                    />
                    <Txt kind="tiny">{EACH[step]}</Txt>
                    <CaloriesChart bars={bars} step={step} total={sum.kcal} />
                  </ArtBox>
                </Rise>
                <Rise delay={140}>
                  <ArtBox picture="rope">
                    <BoxTitle
                      icon="dumbbell"
                      colour="gold"
                      title={stepTitle(step)}
                      side={
                        <Txt kind="big">
                          {`${count(sum.workouts)} `}
                          <Txt kind="small">{`· ${hoursWords(sum.durationMs)}`}</Txt>
                        </Txt>
                      }
                    />
                    <WeekBars bars={bars} />
                  </ArtBox>
                </Rise>
              </>
            )}
            <Rise delay={220}>
              <Consistency w={w} daysTrained={sum.daysTrained} keys={t.points.filter((p) => p.workouts > 0).map((p) => p.date)} />
            </Rise>
            <Rise delay={300}>
              <ArtBox picture="plank">
                <BoxTitle icon="target" colour="gold" title="Exercise Categories" side={<Txt kind="tiny">{`by sets · ${w.days === 365 ? "1 year" : `${count(w.days)} ${w.days === 1 ? "day" : "days"}`}`}</Txt>} />
                <ReadOr read={families.read} again={families.again} what="Exercise categories">
                  {(d) => <Families d={d} w={w} />}
                </ReadOr>
              </ArtBox>
            </Rise>
          </>
        );
      }}
    </ReadOr>
  );
}

function Consistency({ w, daysTrained, keys }: { w: Window; daysTrained: number; keys: readonly string[] }) {
  const sum = { workouts: daysTrained, kcal: 0, durationMs: 0, daysTrained };
  const pct = consistencyPct(sum, w);
  const words = consistencyWords(sum, w);
  const trained = new Set(keys);
  // A dot a day while the period's days fit a row or two; a longer period shows its ring alone.
  const lit = w.days <= 31 ? Array.from({ length: w.days }, (_, i) => trained.has(addDays(w.from, i))) : null;
  return (
    <ArtBox picture="balance">
      <BoxTitle icon="target" title="Consistency" />
      <View style={styles.ringRow} accessible accessibilityLabel={`Consistency: ${words} with a workout, ${String(pct)} percent`}>
        <FillRing pct={pct} />
        <View style={styles.grow}>
          <Txt kind="big">{words}</Txt>
          <Txt kind="tiny">with a workout</Txt>
        </View>
      </View>
      {lit === null ? null : (
        <View style={styles.dotsBox}>
          <DayDots lit={lit} />
        </View>
      )}
    </ArtBox>
  );
}

function Families({ d, w }: { d: ProgressDistribution; w: Window }) {
  const parts = slices(d);
  const total = parts.reduce((n, s) => n + s.sets, 0);
  if (parts.length === 0) return <Txt kind="small">{`No sets in the last ${w.days === 365 ? "year" : `${count(w.days)} days`}`}</Txt>;
  return (
    <View style={styles.families}>
      <FamilyRing shares={parts.map((s) => s.sets)} total={total} />
      <View style={styles.legend}>
        {parts.map((s, i) => (
          <View key={s.name} style={styles.legendRow} accessible accessibilityLabel={`${s.name}, ${String(s.pct)} percent, ${setsWords(s.sets)}`}>
            <View style={styles.between}>
              <View style={styles.legendName}>
                <View style={[styles.swatch, { backgroundColor: sliceColour(i) }]} />
                <Txt kind="strong" numberOfLines={1} style={styles.grow}>
                  {s.name}
                </Txt>
              </View>
              <Txt kind="small">{`${String(s.pct)}%`}</Txt>
            </View>
            <View style={styles.shareTrack}>
              <View style={[styles.shareFill, { flex: Math.max(1, s.pct), backgroundColor: sliceColour(i) }]} />
              <View style={{ flex: Math.max(0, 100 - s.pct) }} />
            </View>
            <Txt kind="tiny">{setsWords(s.sets)}</Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // To the phone's edge, with room for the lit chip's glow.
  swipe: { marginHorizontal: -sizes.edge, marginVertical: -8 },
  chips: { gap: 8, paddingHorizontal: sizes.edge, paddingVertical: 8 },
  grow: { flex: 1 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cut: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 14, backgroundColor: colours.orangeFill },
  ringRow: { flexDirection: "row", alignItems: "center", gap: 16, width: "78%" },
  dotsBox: { width: "64%" },
  families: { flexDirection: "row", alignItems: "center", gap: 16 },
  legend: { flex: 1, gap: 10 },
  legendRow: { gap: 4 },
  legendName: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  shareTrack: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: colours.track },
  shareFill: { borderRadius: 3 },
});
