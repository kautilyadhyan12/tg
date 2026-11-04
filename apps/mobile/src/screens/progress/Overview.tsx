import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { personalRecordsSchema, progressPredictionsSchema, type PersonalRecords, type ProgressPredictions } from "@app/shared";
import { colours, type ColourName } from "../../look/colours";
import { Icon, type IconName } from "../../look/Icon";
import { Rise } from "../../look/Motion";
import { fonts, Txt } from "../../look/Txt";
import { useZoneSaved } from "../../session/TimeZoneSync";
import { useRead } from "../dashboard/useRead";
import { ForecastDays } from "./charts";
import { BandBox, BoxTitle, ReadOr } from "./parts";
import { bestTimeMini, forecastMini, plateauMini, predictionsFrom, weekGoalMini, type Mini } from "./predictionWords";
import { dayKeyOf, recordRows, recordsFrom, type RecordRow } from "./progressRules";

// Progress's Overview (ROADMAP Stage 5 35c-i): the web's Predictions under the runner, and its
// Personal Records under the push-up, each with the day it was set.

export const PREDICTIONS_READ = "/v1/progress/predictions";
export const RECORDS_READ = "/v1/progress/records";

export function Overview() {
  const zone = useZoneSaved();
  const predictions = useRead(PREDICTIONS_READ, progressPredictionsSchema, zone);
  const records = useRead(RECORDS_READ, personalRecordsSchema, zone);
  return (
    <>
      <Rise delay={60}>
        <BandBox
          picture="runner"
          title={
            <BoxTitle
              icon="sparkles"
              colour="orangeLight"
              title="Predictions"
              side={predictions.read.kind === "ok" ? <Txt kind="tiny">{predictionsFrom(predictions.read.data.workouts)}</Txt> : undefined}
            />
          }
        >
          <ReadOr read={predictions.read} again={predictions.again} what="Predictions">
            {(p) => <PredictionGrid p={p} />}
          </ReadOr>
        </BandBox>
      </Rise>
      <Rise delay={180}>
        <BandBox
          picture="pushup"
          title={<BoxTitle icon="trophy" colour="gold" title="Personal Records" side={records.read.kind === "ok" ? <Txt kind="tiny">{recordsFrom(records.read.data)}</Txt> : undefined} />}
        >
          <ReadOr read={records.read} again={records.again} what="Personal records">
            {(r) => <Records records={r} />}
          </ReadOr>
        </BandBox>
      </Rise>
    </>
  );
}

function PredictionGrid({ p }: { p: ProgressPredictions }) {
  const forecast = forecastMini(p.forecast);
  const best = bestTimeMini(p.bestTime);
  const plateau = plateauMini(p.steady);
  const goal = weekGoalMini(p.weekGoal);
  return (
    <View style={styles.grid}>
      <MiniCard title="Next 7 days" mini={forecast}>
        {forecast.days.length === 0 ? null : <ForecastDays days={forecast.days} />}
      </MiniCard>
      <MiniCard title="Best time" mini={best} icon={best.slot === null ? undefined : best.slot === "morning" || best.slot === "afternoon" ? "sun" : "moon"} />
      <MiniCard title="Plateau detector" mini={plateau} />
      <MiniCard title="Weekly goal" mini={goal}>
        {goal.steps === null ? null : <Steps done={goal.steps.done} of={goal.steps.of} />}
      </MiniCard>
    </View>
  );
}

function MiniCard({ title, mini, icon, children }: { title: string; mini: Mini; icon?: IconName | undefined; children?: ReactNode }) {
  return (
    <View style={styles.mini} accessible accessibilityLabel={[title, mini.value, mini.unit ?? "", ...mini.lines].filter((w) => w !== "").join(", ")}>
      <Txt kind="tiny" style={styles.miniTitle}>
        {title}
      </Txt>
      <View style={styles.valueRow}>
        {icon === undefined ? null : <Icon name={icon} size={20} colour="orangeLight" />}
        <Txt kind="big" colour={mini.warm ? "orange" : "text"} style={styles.miniValue}>
          {mini.value}
        </Txt>
        {mini.unit === undefined ? null : <Txt kind="small">{mini.unit}</Txt>}
      </View>
      {children}
      {mini.lines.map((line) => (
        <Txt key={line} kind="tiny" colour="textSoft">
          {line}
        </Txt>
      ))}
    </View>
  );
}

function Steps({ done, of }: { done: number; of: number }) {
  return (
    <View style={styles.steps}>
      {Array.from({ length: of }, (_, i) => (
        <View key={i} style={[styles.step, i < done ? styles.stepOn : null]} />
      ))}
    </View>
  );
}

const TINTS: Record<RecordRow["icon"], { ink: ColourName; fill: ColourName }> = {
  clock: { ink: "orangeLight", fill: "orangeFill" },
  flame: { ink: "orange", fill: "orangeFill" },
  star: { ink: "pink", fill: "pinkFill" },
  dumbbell: { ink: "gold", fill: "goldFill" },
  zap: { ink: "blue", fill: "blueFill" },
};

function Records({ records }: { records: PersonalRecords }) {
  const [first, ...rest] = recordRows(records, dayKeyOf(new Date()));
  return (
    <View style={styles.records}>
      {first === undefined ? null : <RecordTile row={first} wide />}
      <View style={styles.grid}>
        {rest.map((row) => (
          <RecordTile key={row.label} row={row} />
        ))}
      </View>
    </View>
  );
}

function RecordTile({ row, wide = false }: { row: RecordRow; wide?: boolean }) {
  const tint = TINTS[row.icon];
  return (
    <View style={[styles.record, wide ? styles.recordWide : styles.recordHalf]} accessible accessibilityLabel={`${row.label}, ${row.value}${row.day === null ? "" : `, ${row.day}`}`}>
      <View style={[styles.recordIcon, { backgroundColor: colours[row.held ? tint.fill : "fill"] }]}>
        <Icon name={row.icon} size={18} colour={row.held ? tint.ink : "textFaint"} />
      </View>
      <View style={styles.grow}>
        <Txt kind="tiny">{row.label}</Txt>
        <Txt kind={wide ? "big" : "strong"} colour={row.held ? "text" : "textSoft"} numberOfLines={1}>
          {row.value}
        </Txt>
        {row.day === null || wide ? null : <Txt kind="tiny">{row.day}</Txt>}
      </View>
      {wide && row.day !== null ? <Txt kind="tiny">{row.day}</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  mini: { width: "47%", flexGrow: 1, minHeight: 128, padding: 12, gap: 4, borderRadius: 16, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  miniTitle: { fontFamily: fonts.bold, textTransform: "uppercase", letterSpacing: 0.9 },
  valueRow: { flexDirection: "row", alignItems: "baseline", gap: 6, flexWrap: "wrap", marginTop: 2 },
  miniValue: { fontSize: 19, lineHeight: 24 },
  steps: { flexDirection: "row", gap: 6, marginVertical: 4 },
  step: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colours.track },
  stepOn: { backgroundColor: colours.orange },
  records: { gap: 10 },
  record: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 16, backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  recordWide: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  recordHalf: { width: "47%", flexGrow: 1 },
  recordIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1 },
});
