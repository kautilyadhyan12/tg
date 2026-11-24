import type { PhoneLibraryEntry } from "@app/shared";
import { Pressable, StyleSheet, View } from "react-native";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import { litMuscles, sideFor, type Sex } from "../../library/figure";
import { EFFORT_FLAMES, EFFORT_WORDS, effortOf, kindWord, levelPlates, levelWord, muscleNames, targetLine } from "../../library/words";
import { Flames, Plates } from "./Marks";
import { ExerciseThumb, useOwnPicture } from "./ExerciseImage";
import { MuscleFigure } from "./MuscleFigure";

/** One exercise in the Library's list, as drawn (63a): its picture with a small body lit where it works, its
 *  name, level as plates, main muscles, the starting target and the effort as flames. */
export function ExerciseCard({ entry, sex, onOpen }: { entry: PhoneLibraryEntry; sex: Sex | null; onOpen: () => void }) {
  const en = entry.text.en;
  const effort = effortOf(entry.met);
  const target = targetLine(entry);
  const level = levelWord(entry.level);
  const muscles = muscleNames(entry.muscles.main);
  // Its own picture (62a) is fitted whole beside the small muscle box, never under it, on the picture's own colour.
  const own = useOwnPicture(entry.picture) !== null;
  const say = [en.name, level, muscles, target, effort === null ? null : EFFORT_WORDS[effort]].filter((s) => s !== null && s !== "").join(", ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say} onPress={onOpen} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.top}>
        {own && entry.picture !== null ? <View style={[StyleSheet.absoluteFill, { backgroundColor: entry.picture.ground }]} /> : null}
        <ExerciseThumb id={entry.id} kind={entry.kind} picture={entry.picture} style={own && sex !== null ? styles.photoBeside : styles.photo} />
        {/* The person's own figure only: none until their setup answer is known, never the other one. */}
        {sex === null ? null : (
          <View style={styles.mini}>
            <MuscleFigure sex={sex} side={sideFor(entry.muscles.main)} lit={litMuscles(entry.muscles)} width={36} />
          </View>
        )}
        <Txt kind="tiny" colour="text" style={[styles.kind, own ? styles.kindBacked : null]}>
          {kindWord(entry.kind)}
        </Txt>
      </View>
      <View style={styles.body}>
        <Txt kind="strong" numberOfLines={2}>
          {en.name}
        </Txt>
        <View style={styles.level}>
          <Plates lit={levelPlates(entry.level)} />
          <Txt kind="small" colour="gold" style={styles.levelWord}>
            {level}
          </Txt>
        </View>
        {muscles === "" ? null : (
          <Txt kind="small" numberOfLines={1}>
            {muscles}
          </Txt>
        )}
        <View style={styles.meta}>
          {target === null ? <View /> : (
            <View style={styles.target}>
              <Icon name={entry.set.measuredIn === "time" ? "timer" : "clock"} size={12} colour="textFaint" />
              <Txt kind="tiny">{target}</Txt>
            </View>
          )}
          {effort === null ? null : <Flames lit={EFFORT_FLAMES[effort]} size={12} />}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: sizes.boxRadius, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box, overflow: "hidden" },
  pressed: { opacity: 0.85 },
  // The whole picture fits inside the box (Kd: never cut, never faded). An absolute Image keeps its own height on
  // Android: it is given the box's whole size.
  top: { height: 124, overflow: "hidden" },
  photo: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" },
  // Its own picture leaves the small muscle box's width free on the right (36 + its padding, edge and gap).
  photoBeside: { position: "absolute", top: 0, left: 0, bottom: 0, right: 58 },
  mini: { position: "absolute", right: 6, top: 6, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.overPicture },
  // Over the picture with no fade, so the picture keeps its own colours: the word carries its own shadow.
  kind: { position: "absolute", left: 10, bottom: 8, textShadowColor: colours.wordShadow, textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  // White words do not read on a light picture's own colour: they get a dark backing there.
  kindBacked: { left: 8, bottom: 7, paddingVertical: 3, paddingHorizontal: 8, borderRadius: sizes.round, overflow: "hidden", backgroundColor: colours.overWords, textShadowRadius: 0 },
  body: { gap: 7, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  level: { flexDirection: "row", alignItems: "center", gap: 7 },
  levelWord: { fontFamily: fonts.semibold },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colours.line },
  target: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
});
