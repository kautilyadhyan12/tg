import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  METRIC_NOTE,
  PLAN_NOTE,
  WORKING_NOTE,
  flagLines,
  kcalText,
  targetLine,
  workingSteps,
  type PlanNumbers,
  type Units,
} from "@app/shared";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";

// The live daily number, on every setup screen from the moment the server has one: one slim
// line, and "How it's worked out" opens the whole plan from the bottom (Kd, 2026-10-27: the open
// sums were a wall). Until the server has a number the line is not drawn at all; no number is
// ever built from a default. Every figure here is the server's.

interface PlanProps {
  plan: PlanNumbers | null;
  direction: "lose" | "maintain" | "gain" | null;
  units: Units;
  /** The target as setup shows it, which the healthy-weight line is held against. */
  targetShown: number | null;
}

export function PlanBar({ plan, direction, units, targetShown }: PlanProps) {
  const [open, setOpen] = useState(false);
  if (plan === null) return null;
  const flagged = flagLines(plan, direction, units, targetShown).length > 0;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Your daily number, ${kcalText(plan.targetKcal)} kcal a day. How it's worked out`}
        onPress={() => {
          setOpen(true);
        }}
        style={({ pressed }) => [styles.bar, pressed ? styles.pressed : null]}
      >
        {/* Two halves that fall onto two lines on a narrow phone rather than run off its edge. */}
        <View style={styles.half}>
          <Icon name="flame" size={16} colour="orange" />
          <Txt style={styles.number}>{kcalText(plan.targetKcal)}</Txt>
          <Txt style={styles.unit}>kcal a day</Txt>
          {flagged ? <View style={styles.dot} /> : null}
        </View>
        <View style={styles.half}>
          <Txt style={styles.how}>How it’s worked out</Txt>
          <Icon name="go" size={14} colour="orange" />
        </View>
      </Pressable>
      <PlanSheet open={open} onClose={() => { setOpen(false); }} plan={plan} direction={direction} units={units} targetShown={targetShown} />
    </>
  );
}

/** The plan's steps as figures alone, each a line: what the sums say, without the sums. */
function breakdown(plan: PlanNumbers): { label: string; value: string }[] {
  const w = plan.workings;
  const rows = [
    { label: "Resting burn", value: kcalText(w.resting.kcal) },
    { label: "Your day", value: `× ${String(w.day.factor)}` },
    { label: "Training", value: `+ ${kcalText(w.training.kcal)}` },
    { label: "You burn", value: kcalText(plan.dailyBurnKcal) },
  ];
  if (plan.dailyChangeKcal !== 0) {
    rows.push({
      label: plan.dailyChangeKcal < 0 ? "Less, for your pace" : "More, for your pace",
      value: `${plan.dailyChangeKcal < 0 ? "−" : "+"} ${kcalText(Math.abs(plan.dailyChangeKcal))}`,
    });
  }
  return rows;
}

function PlanSheet({ open, onClose, plan, direction, units, targetShown }: PlanProps & { open: boolean; onClose: () => void; plan: PlanNumbers }) {
  const [sums, setSums] = useState(false);
  const target = targetLine(plan, units);
  const flags = flagLines(plan, direction, units, targetShown);
  return (
    <Sheet open={open} title="Your daily number" onClose={onClose}>
      <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetContent}>
        <View style={styles.headline}>
          <Txt style={styles.big}>{kcalText(plan.targetKcal)}</Txt>
          <Txt style={styles.unit}>kcal a day</Txt>
        </View>
        {target === null ? null : <Txt style={styles.target}>{target}</Txt>}
        <View style={styles.macros}>
          {[
            ["Protein", plan.proteinG],
            ["Carbs", plan.carbsG],
            ["Fat", plan.fatG],
          ].map(([name, grams]) => (
            <View key={String(name)} style={styles.macro}>
              <Txt style={styles.macroValue}>{`${String(grams)} g`}</Txt>
              <Txt style={styles.macroName}>{String(name)}</Txt>
            </View>
          ))}
        </View>
        {flags.map((line) => (
          <View key={line} style={styles.flag}>
            <Icon name="warn" size={14} colour="gold" />
            <Txt style={styles.flagWords}>{line}</Txt>
          </View>
        ))}
        <View style={styles.rows}>
          {breakdown(plan).map((r) => (
            <View key={r.label} style={styles.row}>
              <Txt style={styles.rowLabel}>{r.label}</Txt>
              <Txt style={styles.rowValue}>{r.value}</Txt>
            </View>
          ))}
          <View style={[styles.row, styles.total]}>
            <Txt style={styles.totalLabel}>To eat</Txt>
            <Txt style={styles.totalValue}>{kcalText(plan.targetKcal)}</Txt>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: sums }}
          onPress={() => {
            setSums((o) => !o);
          }}
          style={styles.sumsButton}
        >
          <Txt style={styles.how}>{sums ? "Hide the formulas" : "The formulas and sources"}</Txt>
          <View style={sums ? styles.up : null}>
            <Icon name="down" size={14} colour="orange" />
          </View>
        </Pressable>
        {sums ? (
          <View style={styles.sums}>
            {workingSteps(plan, direction).map((s) => (
              <View key={s.title} style={styles.sum}>
                <Txt style={styles.sumTitle}>{s.title}</Txt>
                <Txt style={styles.sumLine}>{s.sum}</Txt>
                {s.note === null ? null : <Txt style={styles.sumNote}>{s.note}</Txt>}
              </View>
            ))}
            <Txt style={styles.sumNote}>{units === "imperial" ? `${WORKING_NOTE} ${METRIC_NOTE}` : WORKING_NOTE}</Txt>
          </View>
        ) : null}
        <Txt style={styles.disclaimer}>{PLAN_NOTE}</Txt>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: 10,
    rowGap: 2,
    minHeight: sizes.press,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: sizes.round,
    backgroundColor: colours.orangeFill,
    borderWidth: 1,
    borderColor: colours.orangeLine,
  },
  pressed: { opacity: 0.85 },
  number: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: colours.orangeLight },
  unit: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colours.textSoft },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colours.gold },
  half: { flexDirection: "row", alignItems: "center", gap: 6 },
  how: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colours.orange },
  sheetBody: { maxHeight: 560 },
  sheetContent: { gap: 14, paddingBottom: 8 },
  headline: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  big: { fontFamily: fonts.bold, fontSize: 34, lineHeight: 38, color: colours.text },
  target: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19, color: colours.textSoft },
  macros: { flexDirection: "row", gap: 8 },
  macro: { flex: 1, paddingVertical: 10, borderRadius: 14, backgroundColor: colours.fill, alignItems: "center", gap: 2 },
  macroValue: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20, color: colours.text },
  macroName: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colours.textFaint },
  flag: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  flagWords: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, color: colours.gold },
  rows: { borderRadius: 14, borderWidth: 1, borderColor: colours.line, paddingHorizontal: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colours.line },
  rowLabel: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 18, color: colours.textSoft },
  rowValue: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colours.text },
  total: { borderBottomWidth: 0 },
  totalLabel: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: colours.text },
  totalValue: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 18, color: colours.orangeLight },
  sumsButton: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: sizes.press, alignSelf: "flex-start" },
  up: { transform: [{ rotate: "180deg" }] },
  sums: { gap: 10 },
  sum: { gap: 2 },
  sumTitle: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colours.text },
  sumLine: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colours.textSoft },
  sumNote: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, color: colours.textFaint },
  disclaimer: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colours.textFaint },
});
