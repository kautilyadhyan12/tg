// Today's planned run on the run's own screen (ROADMAP Stage 5 item 37d-ii): the step the person is
// on, what is left of it, the next one, and the whole session as a bar, as the NHS Couch to 5K app
// and Runna show it. The recorder keeps where the run is; the screen works it out again each second
// from the same maths, so it never waits for the next point.
import { StyleSheet, View } from "react-native";
import type { KeptRunGuide, Units } from "@app/shared";
import { Button } from "../../look/Button";
import { colours, sizes } from "../../look/colours";
import { Txt } from "../../look/Txt";
import { guideAdvance, guideBar, guideDone, leftWords, nextWords, stepName } from "./runGuide";

/** Where the guide is at `movingMs`, with the run's distance as the screen shows it. */
export const guideShown = (guide: KeptRunGuide, movingMs: number, metres: number): KeptRunGuide => guideAdvance(guide, movingMs, () => metres).guide;

/** onSkip: Skip step (37d-iii-a), as Runna and Garmin offer it; the plan's own minutes never change. */
export function RunGuideCard({ guide, movingMs, metres, units, paused, onSkip = null }: { guide: KeptRunGuide; movingMs: number; metres: number; units: Units; paused: boolean; onSkip?: (() => void) | null }) {
  const shown = guideShown(guide, movingMs, metres);
  const done = guideDone(shown);
  const step = shown.steps[shown.at.index];
  const bar = guideBar(shown);
  return (
    <View style={styles.card} testID="run-guide">
      <View style={styles.head}>
        <Txt kind="tiny" colour="textSoft" numberOfLines={1} style={styles.grow}>
          {shown.title}
        </Txt>
        {done || step === undefined || onSkip === null ? null : <Button kind="link" compact label="Skip step" say={`Skip ${stepName(step)}`} onPress={onSkip} />}
      </View>
      {done || step === undefined ? (
        <View style={styles.words} accessible accessibilityLabel="Today's run is complete. Pause, then Finish to save it.">
          <Txt kind="h2" colour="goodText">
            Today’s run is complete
          </Txt>
          <Txt kind="small">Pause, then Finish to save it.</Txt>
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.grow}>
            <Txt kind="h2" colour={paused ? "textSoft" : step.kind === "walk" || step.kind === "warm_walk" || step.kind === "cool_walk" || step.kind === "recover" ? "text" : "orange"} numberOfLines={1} fit>
              {stepName(step)}
            </Txt>
            <Txt kind="small" numberOfLines={1} fit>
              {nextWords(shown, units)}
            </Txt>
          </View>
          <Txt kind="big" colour={paused ? "textSoft" : "text"} style={styles.left} numberOfLines={1}>
            {leftWords(shown, movingMs, metres, units)}
          </Txt>
        </View>
      )}
      <View style={styles.bar} accessible accessibilityLabel={`Step ${String(Math.min(shown.at.index + 1, shown.steps.length))} of ${String(shown.steps.length)}`}>
        {bar.map((part, i) => (
          <View
            key={i}
            style={[
              styles.part,
              { flexGrow: part.weight },
              part.running ? styles.partRun : styles.partWalk,
              i < shown.at.index ? (part.running ? styles.partRunDone : styles.partWalkDone) : null,
              i === shown.at.index ? styles.partNow : null,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.orangeLine, paddingVertical: 12, paddingHorizontal: 14, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 34 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  grow: { flex: 1, gap: 2 },
  words: { gap: 2 },
  left: { flexShrink: 0 },
  bar: { flexDirection: "row", gap: 2, height: 8, marginTop: 4 },
  part: { flexBasis: 0, minWidth: 2, borderRadius: 2 },
  partRun: { backgroundColor: colours.orangeLine },
  partWalk: { backgroundColor: colours.lineStrong },
  partRunDone: { backgroundColor: colours.orange },
  partWalkDone: { backgroundColor: colours.textFaint },
  partNow: { borderWidth: 1, borderColor: colours.gold },
});
