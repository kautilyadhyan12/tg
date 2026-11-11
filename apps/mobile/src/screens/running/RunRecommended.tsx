// Running in Recommended For You (ROADMAP Stage 5 item 37d-iii-a; spec Part 6 §16.6): today's run from
// the training plan beside the runner, Go to Running and See plan; on a rest day the next run; with no
// plan, Create plan; in Safe mode, why there is none. Go to Running opens the Running page, where today's
// run is started (Kd, 2026-11-11: never started from the Dashboard at once). Suggested or My plan under
// the tabs (37d-iii-b): My plan shows the person's own week, Build my own and Edit plan.
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import type { PlanDay, Units } from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { colours, raisedArtFadeAcross, raisedArtFadeDown } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { Txt } from "../../look/Txt";
import { SoftBar } from "../../look/Waiting";
import { useKindTabs } from "../dashboard/KindTabs";
import { ART_SIZE, EmptyBox, Eyebrow, FromRow } from "../food/MealCard";
import { useLookOpen } from "../setupFirst";
import { useRunLayer } from "./RunLayer";
import { useRunOutbox } from "./RunOutbox";
import { RunPlanAsk } from "./RunPlanAsk";
import { OwnRunWeek } from "./OwnRunWeek";
import { RunChoiceRow, isSafeMode, useRunChoice, useRunPlan } from "./RunChoice";
import { ClearedSheet, dayName, heldLine, nextRun, todayGuide, weekLine } from "./RunPlanBox";
import { RunPlanPage } from "./RunPlanPage";
import { ownCount, overCapLine, sessionDetail, sessionTitle } from "./runPlanWords";

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
  const { read, took } = useRunPlan(view.sent + changed);
  const choice = useRunChoice(read, took);
  const [asking, setAsking] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [building, setBuilding] = useState(false);
  const picked = choice.shown ?? (read.kind === "ok" ? read.data.choice : "suggested");
  const guide = todayGuide(read, units, picked);
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
  } else if (picked === "mine" && read.data.own === null) {
    body = <EmptyBox icon="footprints" title="No plan of your own yet." line="Choose a run or a rest day for each day." />;
    rest = <Button label="Build my own" compact style={styles.start} onPress={() => { setBuilding(true); }} />;
  } else if (picked === "mine" && read.data.own !== null) {
    const own = read.data.own;
    const caution = overCapLine(own.days, read.data.capM, units);
    body = (
      <>
        <FromRow badge={{ icon: "user" }} title="My plan" sub={ownCount(own.days, units)} />
        <NextRun days={own.days} today={read.data.today} paces={plan?.kind === "runner" ? plan.paces : null} units={units} />
      </>
    );
    rest = (
      <>
        {caution === null ? null : (
          <Txt kind="tiny" colour="gold">
            {caution}
          </Txt>
        )}
        <View style={styles.actions}>
          {going ? (
            <Button label="Open run" compact say="Open your run" onPress={layer.open} />
          ) : guide !== null ? (
            <Button label="Go to Running" icon="footprints" compact say="Go to Running to start today’s run" onPress={onOpenRunning} />
          ) : null}
          <Button kind="link" compact label="Edit plan" say="Edit your own run plan" onPress={() => { setBuilding(true); }} />
        </View>
      </>
    );
  } else if (shown === null) {
    body = <EmptyBox icon="footprints" title={plan?.kind === "none" ? "No training plan for now." : "No training plan yet."} line="A weekly plan built from your current running." />;
    rest = <Button label="Create plan" compact style={styles.start} onPress={create} />;
  } else {
    const held = heldLine(shown);
    const paces = shown.kind === "runner" ? shown.paces : null;
    const seePlan = <Button kind="link" compact label="See plan" say="See your training plan" onPress={() => { setPlanOpen(true); }} />;
    body = (
      <>
        <FromRow badge={{ icon: "sparkles" }} title="Picked for you" sub={weekLine(shown, units)} />
        <NextRun days={shown.days} today={read.data.today} paces={paces} units={units} />
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
      {/* Safe mode shows no run from any plan, so there is nothing to pick between (spec Part 6 §16.6). */}
      {read.kind === "ok" && !isSafeMode(read.data) ? <RunChoiceRow shown={picked} pick={choice.pick} trouble={choice.trouble} /> : null}
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
      <OwnRunWeek
        data={building && read.kind === "ok" ? read.data : null}
        units={units}
        onClose={() => {
          setBuilding(false);
        }}
        onSaved={(reply) => {
          setBuilding(false);
          took(reply);
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

/** The day's run, or the next one this week. */
function NextRun({ days, today, paces, units }: { days: readonly PlanDay[]; today: string; paces: Parameters<typeof sessionDetail>[1]; units: Units }) {
  const next = nextRun(days, today);
  if (next === null || next.day.session === null) return <EmptyBox icon="footprints" title={days.some((d) => d.done) ? "All runs done this week." : "No more runs this week."} line={null} />;
  return (
    <View style={styles.words}>
      <Eyebrow words={next.today ? "Today’s run" : `Next run · ${dayName(next.day.weekday)}`} />
      <Txt kind="strong">{sessionTitle(next.day.session, units)}</Txt>
      <Txt kind="small">{sessionDetail(next.day.session, paces, units)}</Txt>
    </View>
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
