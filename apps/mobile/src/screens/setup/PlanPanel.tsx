import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  METRIC_NOTE,
  PLAN_NOTE,
  WORKING_NOTE,
  changeLine,
  flagLines,
  kcalText,
  targetLine,
  workingSteps,
  type PlanNumbers,
  type Units,
} from "@app/shared";
import { Card } from "../../look/Card";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";

// The live daily number, on every setup screen from the moment the server has one: the browser's
// plan panel. Until then it is not drawn at all; no number is ever built from a default. Under it,
// "How is this worked out?" opens the server's own steps. Every number here is the server's.

interface PlanPanelProps {
  plan: PlanNumbers | null;
  direction: "lose" | "maintain" | "gain" | null;
  units: Units;
  /** The target as setup shows it, which the healthy-weight line is held against. */
  targetShown: number | null;
}

export function PlanPanel({ plan, direction, units, targetShown }: PlanPanelProps) {
  const [open, setOpen] = useState(false);
  if (plan === null) return null;
  const target = targetLine(plan, units);
  const flags = flagLines(plan, direction, units, targetShown);
  return (
    <Card glass>
      <View style={styles.eyebrow}>
        <Icon name="flame" size={14} colour="orange" />
        <Txt kind="eyebrow">Your daily number</Txt>
      </View>
      <View style={styles.number}>
        <Txt kind="hero">{kcalText(plan.targetKcal)}</Txt>
        <Txt kind="small">kcal a day</Txt>
      </View>
      <Txt kind="small">{changeLine(plan)}.</Txt>
      {target === null ? null : <Txt kind="strong">{target}</Txt>}
      <Txt kind="small">
        Protein {String(plan.proteinG)} g · Carbs {String(plan.carbsG)} g · Fat {String(plan.fatG)} g
      </Txt>
      {flags.map((line) => (
        <Txt key={line} colour="orangeLight" style={styles.flag}>
          {line}
        </Txt>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((o) => !o);
        }}
        style={styles.how}
      >
        <Txt colour="orange" style={styles.howLabel}>
          How is this worked out?
        </Txt>
        <View style={open ? styles.up : null}>
          <Icon name="down" size={14} colour="orange" />
        </View>
      </Pressable>
      {open ? (
        <View style={styles.steps}>
          {workingSteps(plan, direction).map((s) => (
            <View key={s.title} style={styles.step}>
              <Txt kind="h3">{s.title}</Txt>
              <Txt kind="small">{s.sum}</Txt>
              {s.note === null ? null : <Txt kind="tiny">{s.note}</Txt>}
            </View>
          ))}
          <Txt kind="tiny">{units === "imperial" ? `${WORKING_NOTE} ${METRIC_NOTE}` : WORKING_NOTE}</Txt>
        </View>
      ) : null}
      <Txt kind="tiny">{PLAN_NOTE}</Txt>
    </Card>
  );
}

const styles = StyleSheet.create({
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 6 },
  number: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  flag: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  how: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32, alignSelf: "flex-start" },
  howLabel: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  up: { transform: [{ rotate: "180deg" }] },
  steps: { gap: 10 },
  step: { gap: 2 },
});
