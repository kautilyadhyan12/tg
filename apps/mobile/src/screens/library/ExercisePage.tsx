import type { PhoneLibraryEntry } from "@app/shared";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { Segments } from "../../look/Choice";
import { colours, shadows, sizes, stageGlow } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { PictureTop } from "../../look/PictureTop";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { DEEP_UNDER, litMuscles, sideFor, type Sex, type Side } from "../../library/figure";
import { exercisePicture } from "../../library/pictures";
import {
  COUNTED_WORDS,
  EFFORT_FLAMES,
  EFFORT_WORDS,
  COUNTED_TODAY,
  effortOf,
  equipmentLine,
  kindWord,
  levelPlates,
  levelWord,
  muscleLabel,
  muscleLine,
  splitMistake,
  targetLine,
} from "../../library/words";
import { Flames, KitMark, Plates } from "./Marks";
import { MuscleFigure, MuscleLeader } from "./MuscleFigure";

type Tab = "muscles" | "howto" | "mistakes";
const TABS = [
  { value: "muscles", label: "Muscles" },
  { value: "howto", label: "Instructions" },
  { value: "mistakes", label: "Mistakes" },
] as const;

/** An exercise's page, opened over the Library (63a, as drawn): its picture, one strip of facts, its cautions
 *  always in sight above the tabs, then Muscles, How to and Mistakes. */
export function ExercisePage({
  entry,
  sex,
  onClose,
}: {
  entry: PhoneLibraryEntry;
  sex: Sex | null;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("muscles");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const en = entry.text.en;
  const counted = COUNTED_WORDS[COUNTED_TODAY];

  const hero = (
    <PictureTop
      picture={exercisePicture(entry.id, entry.kind)}
      tall={0.9}
      above={
        <View style={styles.tagRow}>
          <View style={styles.tag}>
            <Icon name="timer" size={13} colour="textSoft" />
            <Txt kind="tiny" colour="textSoft">
              {counted}
            </Txt>
          </View>
        </View>
      }
      eyebrow={kindWord(entry.kind)}
      foot={
        <View style={styles.titles}>
          <Txt kind="hero">{en.name}</Txt>
          {en.otherNames.length === 0 ? null : <Txt kind="small">{en.otherNames.join(" · ")}</Txt>}
        </View>
      }
    />
  );
  return (
    <CoverPage open title={en.name} onClose={onClose} hero={hero}>
      <Strip entry={entry} />
      {en.cautions.map((c, i) => (
        <View key={`${String(i)}-${c}`} style={styles.caution} accessible accessibilityRole="alert" accessibilityLabel={`Caution: ${c}`}>
          <Icon name="warn" size={16} colour="badText" />
          <Txt kind="small" colour="text" style={styles.grow}>
            {c}
          </Txt>
        </View>
      ))}
      <Segments options={TABS} selected={tab} onPick={setTab} />
      {tab === "muscles" ? <Muscles entry={entry} sex={sex} /> : tab === "howto" ? <HowTo entry={entry} /> : <Mistakes entry={entry} />}
      {entry.sources.length === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sources"
          onPress={() => {
            setSourcesOpen(true);
          }}
          style={styles.sourcesLink}
          hitSlop={8}
        >
          <Icon name="info" size={16} colour="textFaint" />
          <Txt kind="tiny">Sources</Txt>
        </Pressable>
      )}
      <Sheet
        open={sourcesOpen}
        title="Sources"
        onClose={() => {
          setSourcesOpen(false);
        }}
      >
        <View style={styles.sources}>
          {entry.sources.map((s) => (
            <Txt key={s.name} kind="small">
              {s.name}
            </Txt>
          ))}
        </View>
      </Sheet>
    </CoverPage>
  );
}

/** The facts strip over the picture's foot: target, level, effort, equipment. */
function Strip({ entry }: { entry: PhoneLibraryEntry }) {
  const target = targetLine(entry);
  const effort = effortOf(entry.met);
  const level = levelWord(entry.level);
  const kit = equipmentLine(entry);
  return (
    <View style={styles.strip}>
      {target === null ? null : (
        <View style={styles.fact} accessible accessibilityLabel={`To start, ${targetLine(entry, false) ?? target}`}>
          <Txt style={styles.factBig} numberOfLines={1} fit>
            {target.replace(" × ", "×").replace(" reps", "").replace(" s", "s").replace(" min", "m")}
          </Txt>
          <Txt kind="tiny" numberOfLines={1} fit>
            {entry.set.measuredIn === "reps" ? "Sets × reps" : "Sets × time"}
          </Txt>
        </View>
      )}
      <View style={[styles.fact, styles.factLine]} accessible accessibilityLabel={`Level, ${level}`}>
        <View style={styles.factArt}>
          <Plates lit={levelPlates(entry.level)} scale={1.25} />
        </View>
        {/* One word: it grows smaller on a narrow phone, never broken in two ("Intermediat / e"). */}
        <Txt kind="tiny" numberOfLines={1} fit>
          {level}
        </Txt>
      </View>
      {effort === null ? null : (
        <View style={[styles.fact, styles.factLine]} accessible accessibilityLabel={EFFORT_WORDS[effort]}>
          <View style={styles.factArt}>
            <Flames lit={EFFORT_FLAMES[effort]} size={17} />
          </View>
          <Txt kind="tiny" numberOfLines={2} style={styles.centre}>
            {EFFORT_WORDS[effort]}
          </Txt>
        </View>
      )}
      <View style={[styles.fact, styles.factLine]} accessible accessibilityLabel={kit}>
        <View style={styles.factArt}>
          <KitMark item={entry.equipment[0]} size={0.8} />
        </View>
        <Txt kind="tiny" numberOfLines={2} style={styles.centre}>
          {kit}
        </Txt>
      </View>
    </View>
  );
}

function Muscles({ entry, sex }: { entry: PhoneLibraryEntry; sex: Sex | null }) {
  const { width } = useWindowDimensions();
  const lit = litMuscles(entry.muscles);
  const figure = Math.min(150, Math.floor((width - sizes.edge * 2 - 32 - 26) / 2));
  const labelled = entry.muscles.main[0];
  const labelSide: Side = sideFor(entry.muscles.main);
  const rows = [
    { key: "main", title: "Primary", swatch: styles.swMain, words: entry.muscles.main },
    { key: "also", title: "Secondary", swatch: styles.swAlso, words: entry.muscles.also },
    { key: "steady", title: "Stabilisers", swatch: styles.swSteady, words: entry.muscles.steady },
  ].filter((r) => r.words.length > 0);
  return (
    <>
      {/* The person's own figure only: none until their setup answer is known, never the other one. */}
      {sex === null ? null : (
        <View style={styles.stage}>
          <View style={styles.stageHead}>
            <Txt kind="eyebrow">Muscles worked</Txt>
          </View>
          <View style={styles.figures}>
            {(["front", "back"] as const).map((side) => (
              <View key={side} style={styles.figureCol}>
                <View style={{ width: figure }}>
                  <MuscleFigure sex={sex} side={side} lit={lit} width={figure} />
                  {labelled !== undefined && side === labelSide ? <MuscleLeader sex={sex} side={side} muscle={DEEP_UNDER[labelled] ?? labelled} name={muscleLabel(labelled).name} width={figure} /> : null}
                </View>
                <Txt kind="tiny">{side === "front" ? "FRONT" : "BACK"}</Txt>
              </View>
            ))}
          </View>
        </View>
      )}
      <View style={styles.legend}>
        {rows.map((r) => (
          <View key={r.key} style={styles.legendRow}>
            <View style={[styles.swatch, r.swatch]} />
            <View style={styles.grow}>
              <Txt kind="tiny">{r.title}</Txt>
              <Txt kind="strong">{muscleLine(r.words)}</Txt>
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function HowTo({ entry }: { entry: PhoneLibraryEntry }) {
  const { width } = useWindowDimensions();
  const steps = entry.text.en.steps;
  const card = width - sizes.edge * 2 - 44;
  const step = card + 12;
  const [at, setAt] = useState(0);
  const landed = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setAt(Math.max(0, Math.min(steps.length - 1, Math.round(e.nativeEvent.contentOffset.x / step))));
  };
  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        onMomentumScrollEnd={landed}
        style={styles.steps}
        contentContainerStyle={styles.stepsInner}
      >
        {steps.map((s, i) => (
          <View key={s} style={[styles.stepCard, { width: card }, i === at ? null : styles.stepAway]} accessible accessibilityLabel={`Step ${String(i + 1)} of ${String(steps.length)}. ${s}`}>
            <Txt style={styles.stepNumber}>{String(i + 1).padStart(2, "0")}</Txt>
            <Txt kind="tiny">{`Step ${String(i + 1)} of ${String(steps.length)}`}</Txt>
            <Txt kind="strong" style={styles.stepWords}>
              {s}
            </Txt>
            <View style={styles.dots}>
              {steps.map((_, d) => (
                <View key={d} style={[styles.dot, d === i ? styles.dotOn : null]} />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.about}>
        <Txt kind="eyebrow">About</Txt>
        <Txt>{entry.text.en.about}</Txt>
      </View>
    </>
  );
}

/** Each mistake as what goes wrong (its first sentence) above how to put it right (the rest). */
function Mistakes({ entry }: { entry: PhoneLibraryEntry }) {
  return (
    <View style={styles.mistakes}>
      {entry.text.en.mistakes.map((m) => {
        const { wrong, fix } = splitMistake(m.says);
        return (
          <View key={m.id} style={styles.mistake}>
            <View style={styles.wrong}>
              <View style={[styles.mark, styles.markBad]}>
                <Icon name="x" size={13} colour="badText" />
              </View>
              <Txt kind="strong" style={styles.grow}>
                {wrong}
              </Txt>
            </View>
            {fix === null ? null : (
              <View style={styles.fix}>
                <View style={[styles.mark, styles.markGood]}>
                  <Icon name="check" size={13} colour="goodText" />
                </View>
                <Txt kind="small" style={styles.grow}>
                  {fix}
                </Txt>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  centre: { textAlign: "center" },
  tagRow: { alignItems: "flex-end" },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 30, paddingHorizontal: 12, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.overPicture },
  titles: { gap: 4, paddingBottom: 44 },
  strip: {
    flexDirection: "row",
    marginTop: -44,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.overWords,
    boxShadow: shadows.lift,
  },
  fact: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 4 },
  factLine: { borderLeftWidth: 1, borderLeftColor: colours.line },
  factBig: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26, color: colours.text },
  factArt: { minHeight: 26, alignItems: "center", justifyContent: "center" },
  caution: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 11, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: colours.badLine, backgroundColor: colours.badFill },
  stage: { borderRadius: 24, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box, experimental_backgroundImage: stageGlow, paddingBottom: 10 },
  stageHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, paddingHorizontal: 14, paddingTop: 12 },
  sourcesLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", minHeight: sizes.press },
  sources: { gap: 10 },
  figures: { flexDirection: "row", justifyContent: "center", gap: 26, paddingTop: 22 },
  figureCol: { alignItems: "center", gap: 8 },
  legend: { gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box },
  legendRow: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  swatch: { width: 14, height: 14, borderRadius: 4, marginTop: 2 },
  swMain: { backgroundColor: colours.orange, boxShadow: `0 0 8px ${colours.orange}` },
  swAlso: { backgroundColor: colours.muscleAlso },
  swSteady: { backgroundColor: colours.muscleSteady, borderWidth: 1.5, borderStyle: "dashed", borderColor: colours.orangeLight },
  steps: { marginHorizontal: -sizes.edge },
  stepsInner: { gap: 12, paddingHorizontal: sizes.edge },
  stepCard: { minHeight: 230, gap: 8, padding: 20, borderRadius: 24, borderWidth: 1, borderColor: colours.orangeLine, backgroundColor: colours.raised },
  stepAway: { opacity: 0.5, borderColor: colours.line },
  stepNumber: { fontFamily: fonts.bold, fontSize: 56, lineHeight: 60, color: colours.orangeLight },
  stepWords: { marginTop: 4 },
  dots: { flexDirection: "row", gap: 6, marginTop: "auto", paddingTop: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colours.lineStrong },
  dotOn: { width: 22, backgroundColor: colours.orange },
  about: { gap: 6, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box },
  mistakes: { gap: 10 },
  mistake: { borderRadius: 18, borderWidth: 1, borderColor: colours.line, overflow: "hidden" },
  wrong: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 12, paddingHorizontal: 14, backgroundColor: colours.badFill },
  fix: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 11, paddingHorizontal: 14, backgroundColor: colours.goodFill, borderTopWidth: 1, borderTopColor: colours.line },
  mark: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  markBad: { backgroundColor: colours.badFill },
  markGood: { backgroundColor: colours.goodFill },
});
