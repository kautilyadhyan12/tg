// See plan (ROADMAP Stage 5 item 37d-i): this week's runs day by day, ticked as they are recorded, the
// weeks ahead, the paces and where they come from, and Change my answers.
import { StyleSheet, View } from "react-native";
import type { PlanDay, RunPlan, Units } from "@app/shared";
import { Button } from "../../look/Button";
import { colours, sizes } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { PictureTop } from "../../look/PictureTop";
import { fonts, Txt } from "../../look/Txt";
import { GOAL_WORDS, paceOf, planDistance, sessionDetail, sessionTitle, walkRunCore, weekdayShort } from "./runPlanWords";
import { phoneToday } from "./RunPlanBox";

type Shown = Exclude<RunPlan, { kind: "none" }>;

export const RULES_LINE = "No run is more than 10 % longer than your longest of the last month (a 2025 study of 5,205 runners), and a week grows by 10 % at most, with an easier week every fourth.";
export const NHS_LINE = "Go at a pace where you can still talk. Have a rest day between runs. If a week felt hard, do it again: the plan waits for you. From the NHS Couch to 5K plan.";

export function RunPlanPage({ plan, units, onClose, onChange }: { plan: Shown | null; units: Units; onClose: () => void; onChange: () => void }) {
  const runs = plan === null ? 0 : plan.days.filter((d) => d.session !== null).length;
  const hero =
    plan === null ? undefined : (
      <PictureTop
        picture={plan.kind === "c25k" ? "runner" : "greekrun"}
        tall={0.62}
        eyebrow={plan.kind === "c25k" ? "Couch to 5K" : `Aiming for ${GOAL_WORDS[plan.goal]}`}
        title={plan.kind === "c25k" ? `Week ${String(plan.week)} of 9` : `Week ${String(plan.week)}`}
        foot={
          <Txt kind="small" colour="textSoft">
            {plan.kind === "c25k" ? `${String(runs)} ${runs === 1 ? "run" : "runs"} this week` : `${planDistance(plan.weekM, units)} · ${String(runs)} ${runs === 1 ? "run" : "runs"}${plan.easier ? " · an easier week" : ""}`}
          </Txt>
        }
      />
    );
  const today = phoneToday();
  return (
    <CoverPage open={plan !== null} title="Your run plan" onClose={onClose} {...(hero === undefined ? {} : { hero })}>
      {plan === null ? null : (
        <>
          {plan.kind === "runner" && plan.ready ? <Txt kind="small" colour="goodText">{`You’re ready for a ${GOAL_WORDS[plan.goal]}. Your plan keeps this week steady now.`}</Txt> : null}
          {plan.kind === "runner" && plan.held ? <Txt kind="small" colour="gold">No run was recorded last week, so this week stays the same. Record your runs here so your plan can grow.</Txt> : null}
          <View style={styles.list}>
            {plan.days.filter((d) => d.session !== null).map((d, i) => (
              <Session key={d.day} day={d} first={i === 0} today={d.day === today} plan={plan} units={units} />
            ))}
            {runs === 0 ? <Txt kind="small" style={styles.pad}>No runs left this week.</Txt> : null}
          </View>
          {plan.ahead.length === 0 ? null : (
            <>
              <View style={styles.monthRow}>
                <Txt kind="eyebrow">Weeks ahead</Txt>
                <Txt kind="tiny">{plan.kind === "runner" ? "grows from what you run" : "after each week’s runs"}</Txt>
              </View>
              <View style={styles.list}>
                {plan.ahead.map((a, i) => (
                  <View key={a.week} style={[styles.ahead, i === 0 ? null : styles.line]}>
                    <Txt kind="body" style={styles.grow}>{`Week ${String(a.week)}${a.easier ? " · easier week" : ""}`}</Txt>
                    <Txt kind="strong" style={styles.aheadValue}>
                      {a.m !== null ? planDistance(a.m, units) : a.parts !== null ? walkRunCore(a.parts) : ""}
                    </Txt>
                  </View>
                ))}
              </View>
            </>
          )}
          {plan.kind === "runner" ? <Paces plan={plan} units={units} onChange={onChange} /> : null}
          <Txt kind="tiny" style={styles.note}>
            {plan.kind === "c25k" ? NHS_LINE : RULES_LINE}
          </Txt>
          {plan.kind === "c25k" ? (
            <View style={styles.box}>
              <Txt kind="h3">After week 9</Txt>
              <Txt kind="small">{`Running for 30 minutes without stopping. Your plan then grows towards a ${GOAL_WORDS[plan.goal]}.`}</Txt>
            </View>
          ) : null}
          <Button kind="link" label="Change my answers" say="Change your run plan answers" style={styles.change} onPress={onChange} />
        </>
      )}
    </CoverPage>
  );
}

function Session({ day, first, today, plan, units }: { day: PlanDay; first: boolean; today: boolean; plan: Shown; units: Units }) {
  const session = day.session;
  if (session === null) return null;
  const paces = plan.kind === "runner" ? plan.paces : null;
  return (
    <View style={[styles.session, first ? null : styles.line]} accessible accessibilityLabel={`${weekdayShort(day.weekday)}${today ? ", today" : ""}: ${sessionTitle(session, units)}. ${sessionDetail(session, paces, units)}.${day.done ? " Done." : ""}`}>
      <Txt kind="tiny" colour={today ? "gold" : "textFaint"} style={styles.dayName}>
        {weekdayShort(day.weekday).toUpperCase()}
      </Txt>
      <View style={styles.grow}>
        <Txt kind="strong">{sessionTitle(session, units)}</Txt>
        <Txt kind="small">{sessionDetail(session, paces, units)}</Txt>
        {session.kind === "walk_run" ? <Bars parts={session.parts} /> : null}
      </View>
      <View style={[styles.tick, day.done ? styles.tickDone : null]}>{day.done ? <Icon name="check" size={14} colour="onOrange" /> : null}</View>
    </View>
  );
}

/** The run's walks and runs, each as wide as it is long: runs tall and orange, walks low. */
function Bars({ parts }: { parts: readonly { kind: "walk" | "run"; s: number }[] }) {
  return (
    <View style={styles.bars} accessible={false}>
      {parts.map((p, i) => (
        <View key={i} style={[p.kind === "run" ? styles.barRun : styles.barWalk, { flex: p.s }]} />
      ))}
    </View>
  );
}

function Paces({ plan, units, onChange }: { plan: Extract<Shown, { kind: "runner" }>; units: Units; onChange: () => void }) {
  const p = plan.paces;
  const per = units === "imperial" ? "/mi" : "/km";
  return (
    <View style={styles.box}>
      <Txt kind="h3">Your paces</Txt>
      {p === null ? (
        <>
          <Txt kind="small">{plan.raceOld ? "Your race time is more than 6 weeks old, so you run by feel until you add a new one." : "By feel: easy is a pace where you can still talk; steady is comfortably hard; fast is hard, but in control."}</Txt>
          <Button kind="link" label="Add a race time" say="Add a race time for your paces" onPress={onChange} />
        </>
      ) : (
        <>
          <View style={styles.paces}>
            <Pace value={`${paceOf(p.easy[0], units)}–${paceOf(p.easy[1], units)}`} label={`Easy ${per}`} />
            <Pace value={`${paceOf(p.steady[0], units)}–${paceOf(p.steady[1], units)}`} label={`Steady ${per}`} />
            <Pace value={paceOf(p.fast, units)} label={`Fast ${per}`} />
          </View>
          <Txt kind="tiny">From your race time, by Jack Daniels’ formula.</Txt>
        </>
      )}
    </View>
  );
}

function Pace({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.pace}>
      <Txt kind="strong" style={styles.paceValue}>{value}</Txt>
      <Txt kind="tiny">{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line },
  session: { flexDirection: "row", gap: 12, padding: 14, alignItems: "flex-start" },
  line: { borderTopWidth: 1, borderTopColor: colours.line },
  dayName: { width: 38, paddingTop: 3, fontFamily: fonts.bold, letterSpacing: 1 },
  grow: { flex: 1, gap: 3 },
  pad: { padding: 14 },
  tick: { width: 24, height: 24, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, alignItems: "center", justifyContent: "center" },
  tickDone: { backgroundColor: colours.orange, borderColor: colours.orange },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 20, marginTop: 6 },
  barRun: { height: 20, borderRadius: 3, backgroundColor: colours.orange },
  barWalk: { height: 8, borderRadius: 3, backgroundColor: colours.lineStrong },
  monthRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 8, paddingHorizontal: 4 },
  ahead: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  aheadValue: { flexShrink: 1, textAlign: "right" },
  box: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 16, gap: 8, alignItems: "flex-start" },
  paces: { flexDirection: "row", gap: 8, alignSelf: "stretch" },
  pace: { flex: 1, borderRadius: 14, backgroundColor: colours.raised, padding: 10, gap: 2 },
  paceValue: { fontVariant: ["tabular-nums"] },
  note: { paddingHorizontal: 4, lineHeight: 17 },
  change: { alignSelf: "center" },
});
