// Your run plan on the Running page (ROADMAP Stage 5 item 37d-i): Make my plan before any answers;
// this week as seven footprints (Kd, 2026-11-10: footprints, not circles), lit where a run was
// recorded, today's run under them, and See plan; in Safe mode, why there is none.
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { CHECK_FIRST_OPTIONS, healthScreeningResponseSchema, type CheckFirst, type PlanDay, type RunPlan, type RunPlanResponse, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { Options } from "../../look/Choice";
import { colours, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { HEALTH_PATH } from "../setup/useHealthStep";
import { GOAL_WORDS, planDistance, sessionDetail, sessionTitle, weekdayLetter } from "./runPlanWords";

export const RUN_PLAN_PATH = "/v1/geo/run-plan";

export type PlanRead = { kind: "loading" } | { kind: "failed"; again: () => void } | { kind: "ok"; data: RunPlanResponse };

/** "10K plan · Week 3 · 24 km"; "Couch to 5K · Week 1 of 9". */
export function weekLine(plan: Exclude<RunPlan, { kind: "none" }>, units: Units): string {
  if (plan.kind === "c25k") return `Couch to 5K · Week ${String(plan.week)} of 9`;
  const easier = plan.easier ? " · recovery week" : "";
  return `${GOAL_WORDS[plan.goal]} plan · Week ${String(plan.week)} · ${planDistance(plan.weekM, units)}${easier}`;
}

/** Today's run, or the next one this week, or null. */
export function nextRun(days: readonly PlanDay[], today: string): { day: PlanDay; today: boolean } | null {
  const todays = days.find((d) => d.day === today && d.session !== null && !d.done);
  if (todays !== undefined) return { day: todays, today: true };
  const later = days.find((d) => d.day > today && d.session !== null);
  return later === undefined ? null : { day: later, today: false };
}

/** Today in the phone's own time, YYYY-MM-DD. */
export const phoneToday = (now: Date = new Date()): string =>
  `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

/** This week: a footprint a day, lit when its run is done, outlined where one is planned, the day's
 *  letter gold today. */
export function FootprintWeek({ days, today }: { days: readonly PlanDay[]; today: string }) {
  return (
    <View style={styles.week} accessibilityRole="summary">
      {days.map((d) => {
        const isToday = d.day === today;
        const planned = d.session !== null;
        const said = `${weekdayLetter(d.weekday)}: ${d.done ? "run done" : planned ? "run planned" : "rest"}${isToday ? ", today" : ""}`;
        return (
          <View key={d.day} style={styles.day} accessible accessibilityLabel={said}>
            <Txt kind="tiny" colour={isToday ? "gold" : "textFaint"} style={styles.letter}>
              {weekdayLetter(d.weekday)}
            </Txt>
            <View style={[styles.print, d.done ? styles.printDone : planned ? styles.printPlanned : null, isToday ? styles.printToday : null]}>
              <Icon name="footprints" size={17} colour={d.done ? "onOrange" : planned ? (isToday ? "gold" : "orange") : "textFaint"} filled={d.done} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

export function RunPlanBox({ read, units, onMake, onOpen, onCleared }: { read: PlanRead; units: Units; onMake: () => void; onOpen: () => void; onCleared: () => void }) {
  const [clearing, setClearing] = useState(false);
  if (read.kind === "loading") return null;
  if (read.kind === "failed") {
    return (
      <View style={[styles.box, styles.row]}>
        <Txt kind="small" style={styles.grow}>
          Your training plan couldn’t load.
        </Txt>
        <Button kind="link" label="Try again" say="Try your run plan again" onPress={read.again} />
      </View>
    );
  }
  const plan = read.data.plan;
  if (plan === null || plan.kind === "none") {
    const safe = plan?.why === "safe_mode";
    return (
      <View style={[styles.box, styles.withArt]} testID="run-plan-box">
        <View style={styles.art} pointerEvents="none">
          <Image source={pictures.runners} style={[styles.artPicture, safe ? styles.artFaint : null]} resizeMode="cover" />
        </View>
        <View style={styles.words}>
          <Txt kind="h3">Training plan</Txt>
          <Txt kind="small">
            {safe
              ? "No training plan until a professional has cleared you to exercise. You can still record a run."
              : plan?.why === "not_for_me"
                ? "No training plan for now. Create one any time."
                : "A weekly plan built from your current running."}
          </Txt>
          {safe ? (
            <Button kind="link" label="I’ve been cleared" say="Change your health answer" onPress={() => { setClearing(true); }} />
          ) : (
            <Button label="Create plan" compact style={styles.make} onPress={onMake} />
          )}
        </View>
        <ClearedSheet open={clearing} onClose={() => { setClearing(false); }} onSaved={() => { setClearing(false); onCleared(); }} />
      </View>
    );
  }
  const today = phoneToday();
  const next = nextRun(plan.days, today);
  const paces = plan.kind === "runner" ? plan.paces : null;
  return (
    <View style={styles.box} testID="run-plan-box">
      <View style={styles.head}>
        <Txt kind="h3">Training plan</Txt>
        <Button kind="link" label="View plan" say="View your training plan" onPress={onOpen} />
      </View>
      <Txt kind="tiny" colour="textSoft">
        {weekLine(plan, units)}
      </Txt>
      <FootprintWeek days={plan.days} today={today} />
      <View style={styles.next}>
        {next === null || next.day.session === null ? (
          <Txt kind="small">{plan.days.some((d) => d.done) ? "All runs done this week." : "No more runs this week."}</Txt>
        ) : (
          <>
            <Txt kind="eyebrow">{next.today ? "Today’s run" : `Next run · ${dayName(next.day.weekday)}`}</Txt>
            <Txt kind="strong">{sessionTitle(next.day.session, units)}</Txt>
            <Txt kind="small">{sessionDetail(next.day.session, paces, units)}</Txt>
          </>
        )}
      </View>
    </View>
  );
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
export const dayName = (weekday: number): string => DAY_NAMES[weekday - 1] ?? "";

/** Safe mode's way out: the health answer's second question, asked again here. */
function ClearedSheet({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { session } = useSession();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const pick = async (checkFirst: CheckFirst) => {
    setSaving(true);
    setProblem(null);
    const answer = await session.signedIn({ method: "PUT", path: HEALTH_PATH, body: { hasCondition: true, checkFirst } }, healthScreeningResponseSchema);
    setSaving(false);
    if (answer.kind !== "ok") {
      setProblem("Couldn’t save that answer. Check your connection and try again.");
      return;
    }
    onSaved();
  };
  return (
    <Sheet open={open} title="Has a professional cleared you?" onClose={onClose}>
      <View style={styles.sheet}>
        <Options
          options={(["cleared", "not_yet"] as const).map((value) => ({ value, label: CHECK_FIRST_OPTIONS[value].label, desc: CHECK_FIRST_OPTIONS[value].detail }))}
          selected="not_yet"
          disabled={saving}
          onPick={(value) => void pick(value)}
        />
        {problem === null ? null : (
          <Txt kind="small" colour="badText">
            {problem}
          </Txt>
        )}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 16, gap: 8 },
  withArt: { overflow: "hidden", minHeight: 132 },
  art: { position: "absolute", top: 0, bottom: 0, right: 0, width: "44%" },
  artPicture: { width: "100%", height: "100%", opacity: 0.9 },
  artFaint: { opacity: 0.45 },
  words: { width: "58%", gap: 6, alignItems: "flex-start" },
  make: { marginTop: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  week: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  day: { alignItems: "center", gap: 6, minWidth: 34 },
  letter: { fontFamily: fonts.semibold },
  print: { width: 34, height: 34, borderRadius: sizes.round, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colours.lineStrong },
  printPlanned: { borderColor: colours.orangeLine, backgroundColor: colours.orangeFill },
  printDone: { borderColor: colours.orange, backgroundColor: colours.orange, boxShadow: shadows.button },
  printToday: { borderColor: colours.gold },
  next: { marginTop: 6, paddingTop: 12, borderTopWidth: 1, borderTopColor: colours.line, gap: 3 },
  sheet: { gap: 12 },
});
