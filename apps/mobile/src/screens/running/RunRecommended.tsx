// Running in Recommended For You (ROADMAP Stage 5 item 37d-iii-a; spec Part 6 §16.6): today's run from
// the training plan beside the runner, Go to Running and See plan; on a rest day the next run; with no
// plan, Create plan; in Safe mode, why there is none. Go to Running opens the Running page, where today's
// run is started (Kd, 2026-11-11: never started from the Dashboard at once).
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { runPlanResponseSchema, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { colours, raisedArtFadeAcross, raisedArtFadeDown } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { Txt } from "../../look/Txt";
import { SoftBar } from "../../look/Waiting";
import { useKindTabs } from "../dashboard/KindTabs";
import { useRead } from "../dashboard/useRead";
import { ART_SIZE, EmptyBox, Eyebrow, FromRow } from "../food/MealCard";
import { useLookOpen } from "../setupFirst";
import { useRunLayer } from "./RunLayer";
import { useRunOutbox } from "./RunOutbox";
import { RunPlanAsk } from "./RunPlanAsk";
import { ClearedSheet, dayName, heldLine, nextRun, RUN_PLAN_PATH, todayGuide, weekLine, type PlanRead } from "./RunPlanBox";
import { RunPlanPage } from "./RunPlanPage";
import { sessionDetail, sessionTitle } from "./runPlanWords";

export const SAFE_MODE_WORDS = "No training plan until a professional has cleared you to exercise. You can still record a run.";

/** onOpenRunning: the Workout tab on Running, where today's run is started. */
export function RunRecommended({ units, onOpenRunning }: { units: Units; onOpenRunning: () => void }) {
  const tabs = useKindTabs("running");
  // While the person looks at the app before setup (14d), a run or a plan waits for setup.
  const look = useLookOpen();
  const layer = useRunLayer();
  const { view } = useRunOutbox();
  const [changed, setChanged] = useState(0);
  // Read again when a run lands: it ticks today's run and moves the box to the next.
  const planRead = useRead(RUN_PLAN_PATH, runPlanResponseSchema, view.sent + changed);
  const read: PlanRead = planRead.read.kind === "ok" ? { kind: "ok", data: planRead.read.data } : planRead.read.kind === "failed" ? { kind: "failed", again: planRead.again } : { kind: "loading" };
  const [asking, setAsking] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const guide = todayGuide(read, units);
  const going = layer.run !== null;

  const create = () => {
    if (look !== null) look();
    else setAsking(true);
  };

  let body;
  let rest = null;
  const plan = read.kind === "ok" ? read.data.plan : null;
  const shown = plan !== null && plan.kind !== "none" ? plan : null;
  if (read.kind === "loading") {
    body = <SoftBar width="70%" />;
  } else if (read.kind === "failed") {
    body = (
      <View style={styles.row}>
        <Txt kind="small" style={styles.grow}>
          Your training plan couldn’t load.
        </Txt>
        <Button kind="link" label="Try again" say="Try your training plan again" onPress={read.again} />
      </View>
    );
  } else if (plan?.kind === "none" && plan.why === "safe_mode") {
    // Safe mode shows no run from any choice until a professional's clearance (spec Part 6 §16.6).
    body = <Txt kind="small">{SAFE_MODE_WORDS}</Txt>;
    rest = <Button kind="link" compact label="I’ve been cleared" say="Change your health answer" style={styles.start} onPress={() => { setClearing(true); }} />;
  } else if (shown === null) {
    body = <EmptyBox icon="footprints" title={plan?.kind === "none" ? "No training plan for now." : "No training plan yet."} line="A weekly plan built from your current running." />;
    rest = <Button label="Create plan" compact style={styles.start} onPress={create} />;
  } else {
    const today = read.data.today;
    const next = nextRun(shown.days, today);
    const held = heldLine(shown);
    const paces = shown.kind === "runner" ? shown.paces : null;
    const seePlan = <Button kind="link" compact label="See plan" say="See your training plan" onPress={() => { setPlanOpen(true); }} />;
    body = (
      <>
        <FromRow badge={{ icon: "sparkles" }} title="Picked for you" sub={weekLine(shown, units)} />
        {next === null || next.day.session === null ? (
          <EmptyBox icon="footprints" title={shown.days.some((d) => d.done) ? "All runs done this week." : "No more runs this week."} line={null} />
        ) : (
          <View style={styles.words}>
            <Eyebrow words={next.today ? "Today’s run" : `Next run · ${dayName(next.day.weekday)}`} />
            <Txt kind="strong">{sessionTitle(next.day.session, units)}</Txt>
            <Txt kind="small">{sessionDetail(next.day.session, paces, units)}</Txt>
          </View>
        )}
      </>
    );
    rest = (
      <>
        {held === null ? null : (
          <Txt kind="tiny" colour="gold">
            {held}
          </Txt>
        )}
        <View style={styles.actions}>
          {going ? (
            <Button label="Open run" compact say="Open your run" onPress={layer.open} />
          ) : guide !== null ? (
            <Button label="Go to Running" icon="footprints" compact say="Go to Running to start today’s run" onPress={onOpenRunning} />
          ) : null}
          {seePlan}
        </View>
      </>
    );
  }

  return (
    <Card raised style={styles.card} testID="recommended-box">
      <View style={styles.titleRow}>
        <Icon name="target" size={16} colour="orange" />
        <Txt kind="h3" style={styles.boxTitle}>
          Recommended For You
        </Txt>
      </View>
      {tabs}
      {/* The run beside the picture, never under it; the buttons across the box. */}
      <View style={styles.beside}>
        <View style={styles.leftWords}>{body}</View>
        {/* The drawing melts into the box on every side, never a box of its own (Kd, 2026-11-11). */}
        <View style={styles.art} pointerEvents="none">
          <Image source={pictures.runner} resizeMode="cover" style={[styles.artFill, plan?.kind === "none" && plan.why === "safe_mode" ? styles.faint : null]} accessible={false} />
          <View style={[StyleSheet.absoluteFill, styles.fadeAcross]} />
          <View style={[StyleSheet.absoluteFill, styles.fadeDown]} />
        </View>
      </View>
      {rest}
      <RunPlanAsk
        open={asking}
        units={units}
        before={read.kind === "ok" ? read.data.answers : null}
        onClose={() => {
          setAsking(false);
        }}
        onSaved={() => {
          setAsking(false);
          setPlanOpen(false);
          setChanged((n) => n + 1);
        }}
      />
      <RunPlanPage
        plan={planOpen ? shown : null}
        today={read.kind === "ok" ? read.data.today : ""}
        units={units}
        onClose={() => {
          setPlanOpen(false);
        }}
        onChange={() => {
          setPlanOpen(false);
          setAsking(true);
        }}
      />
      <ClearedSheet
        open={clearing}
        onClose={() => {
          setClearing(false);
        }}
        onSaved={() => {
          setClearing(false);
          setChanged((n) => n + 1);
        }}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  boxTitle: { fontSize: 14, lineHeight: 18, color: colours.textSoft },
  beside: { flexDirection: "row", gap: 8 },
  leftWords: { flex: 1, gap: 10 },
  art: { width: ART_SIZE, height: ART_SIZE },
  artFill: { width: "100%", height: "100%" },
  fadeAcross: { experimental_backgroundImage: raisedArtFadeAcross },
  fadeDown: { experimental_backgroundImage: raisedArtFadeDown },
  faint: { opacity: 0.45 },
  words: { gap: 3 },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
  start: { alignSelf: "flex-start" },
});
