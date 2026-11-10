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

export const RULES_LINE = "No run is more than 10\u00a0% longer than your longest of the last 30 days (a 2025 study of 5,205 runners), and a week grows by 10\u00a0% at most, with a recovery week every fourth.";
export const NHS_LINE = "Go at a pace where you can still talk. Have a rest day between runs. If a week felt hard, do it again: the plan waits for you. From the NHS Couch to 5K plan.";

export function RunPlanPage({ plan, units, onClose, onChange }: { plan: Shown | null; units: Units; onClose: () => void; onChange: () => void }) {
  const runs = plan === null ? 0 : plan.days.filter((d) => d.session !== null).length;
  const hero =
    plan === null ? undefined : (
      <PictureTop
        picture={plan.kind === "c25k" ? "runner" : "greekrun"}
        tall={0.62}
        eyebrow={plan.kind === "c25k" ? "Couch to 5K" : `${GOAL_WORDS[plan.goal]} plan`}
        title={plan.kind === "c25k" ? `Week ${String(plan.week)} of 9` : `Week ${String(plan.week)}`}
        foot={
          <Txt kind="small" colour="textSoft">
            {plan.kind === "c25k" ? `${String(runs)} ${runs === 1 ? "run" : "runs"} this week` : `${planDistance(plan.weekM, units)} · ${String(runs)} ${runs === 1 ? "run" : "runs"}${plan.easier ? " · recovery week" : ""}`}
          </Txt>
        }
      />
    );
  const today = phoneToday();
  return (
    <CoverPage open={plan !== null} title="Training plan" onClose={onClose} {...(hero === undefined ? {} : { hero })}>
      {plan === null ? null : (
        <>
          {plan.kind === "runner" && plan.ready ? <Txt kind="small" colour="goodText">{`You’re ready for ${GOAL_WORDS[plan.goal] === "Half marathon" ? "a half marathon" : `a ${GOAL_WORDS[plan.goal]}`}. Your plan now holds at this level.`}</Txt> : null}
          {plan.kind === "runner" && plan.held ? <Txt kind="small" colour="gold">No runs recorded last week, so this week stays the same. Record your runs in the app so your plan can build.</Txt> : null}
          <View style={styles.list}>
            {plan.days.filter((d) => d.session !== null).map((d, i, shown) => (
              <Session key={d.day} day={d} first={i === 0} today={d.day === today} plan={plan} units={units} sameAs={sameRunBefore(d, shown.slice(0, i))} />
            ))}
            {runs === 0 ? <Txt kind="small" style={styles.pad}>No runs left this week.</Txt> : null}
          </View>
          {plan.ahead.length === 0 ? null : (
            <>
              <View style={styles.monthRow}>
                <Txt kind="eyebrow">Upcoming weeks</Txt>
                <Txt kind="tiny">{plan.kind === "runner" ? "builds from what you run" : "after this week’s runs"}</Txt>
              </View>
              <View style={styles.list}>
                {plan.ahead.map((a, i) =>
                  a.parts !== null ? (
                    <View key={a.week} style={[styles.aheadWalk, i === 0 ? null : styles.line]}>
                      <Txt kind="strong">{`Week ${String(a.week)}`}</Txt>
                      <Txt kind="small">{sentence(walkRunCore(a.parts))}</Txt>
                    </View>
                  ) : (
                    <View key={a.week} style={[styles.ahead, i === 0 ? null : styles.line]}>
                      <Txt kind="body" style={styles.grow}>{`Week ${String(a.week)}${a.easier ? " · recovery week" : ""}`}</Txt>
                      <Txt kind="strong">{a.m === null ? "" : planDistance(a.m, units)}</Txt>
                    </View>
                  ),
                )}
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
              <Txt kind="small">{`Running 30 minutes without stopping. Your plan then builds towards ${plan.goal === "half" ? "a half marathon" : `a ${GOAL_WORDS[plan.goal]}`}.`}</Txt>
            </View>
          ) : null}
          <Button kind="link" label="Edit plan" say="Edit your training plan" style={styles.change} onPress={onChange} />
        </>
      )}
    </CoverPage>
  );
}

/** Couch to 5K's run number of an earlier run this week with the very same walks and runs, as the NHS
 *  plan writes "Repeat week 1 run 1". */
function sameRunBefore(day: PlanDay, before: readonly PlanDay[]): number | null {
  const session = day.session;
  if (session?.kind !== "walk_run") return null;
  const same = before.find((d) => d.session?.kind === "walk_run" && JSON.stringify(d.session.parts) === JSON.stringify(session.parts));
  return same?.session?.kind === "walk_run" ? same.session.run : null;
}

const sentence = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1);

function Session({ day, first, today, plan, units, sameAs }: { day: PlanDay; first: boolean; today: boolean; plan: Shown; units: Units; sameAs: number | null }) {
  const session = day.session;
  if (session === null) return null;
  const paces = plan.kind === "runner" ? plan.paces : null;
  const detail = sameAs === null ? sessionDetail(session, paces, units) : `Same as Run ${String(sameAs)}`;
  return (
    <View style={[styles.session, first ? null : styles.line]} accessible accessibilityLabel={`${weekdayShort(day.weekday)}${today ? ", today" : ""}: ${sessionTitle(session, units)}. ${detail}.${day.done ? " Done." : ""}`}>
      <Txt kind="tiny" colour={today ? "gold" : "textFaint"} style={styles.dayName}>
        {weekdayShort(day.weekday).toUpperCase()}
      </Txt>
      <View style={styles.grow}>
        <Txt kind="strong">{sessionTitle(session, units)}</Txt>
        <Txt kind="small">{detail}</Txt>
        {session.kind === "walk_run" && sameAs === null ? <Bars parts={session.parts} /> : null}
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
          <Txt kind="small">{plan.raceOld ? "Your race time is more than 6 weeks old. Paces are by feel until you add a new one." : "By feel: easy is a conversational pace, tempo is comfortably hard, intervals are hard but controlled."}</Txt>
          <Button kind="link" label="Add a race time" say="Add a race time to set your paces" onPress={onChange} />
        </>
      ) : (
        <>
          <View style={styles.paces}>
            <Pace label="Easy" value={`${paceOf(p.easy[0], units)}–${paceOf(p.easy[1], units)} ${per}`} first />
            <Pace label="Tempo" value={`${paceOf(p.steady[0], units)}–${paceOf(p.steady[1], units)} ${per}`} />
            <Pace label="Interval" value={`${paceOf(p.fast, units)} ${per}`} />
          </View>
          <Txt kind="tiny">From your race time, by Jack Daniels’ formula.</Txt>
        </>
      )}
    </View>
  );
}

/** A pace as a row, its name beside it: a range never breaks across lines, on any phone. */
function Pace({ value, label, first = false }: { value: string; label: string; first?: boolean }) {
  return (
    <View style={[styles.pace, first ? null : styles.line]}>
      <Txt kind="body" style={styles.grow}>{label}</Txt>
      <Txt kind="strong" style={styles.paceValue}>{value}</Txt>
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
  aheadWalk: { paddingHorizontal: 14, paddingVertical: 12, gap: 3 },
  box: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 16, gap: 8, alignItems: "flex-start" },
  paces: { alignSelf: "stretch", borderRadius: 14, backgroundColor: colours.raised },
  pace: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  paceValue: { fontVariant: ["tabular-nums"] },
  note: { paddingHorizontal: 4, lineHeight: 17 },
  change: { alignSelf: "center" },
});
