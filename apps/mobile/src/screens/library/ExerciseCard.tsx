import type { PhoneLibraryEntry } from "@app/shared";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { artShade, colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { fonts, Txt } from "../../look/Txt";
import { litMuscles, sideFor, type Sex } from "../../library/figure";
import { exercisePicture } from "../../library/pictures";
import { EFFORT_FLAMES, EFFORT_WORDS, effortOf, kindWord, levelPlates, levelWord, muscleNames, targetLine } from "../../library/words";
import { Flames, Plates } from "./Marks";
import { MuscleFigure } from "./MuscleFigure";

/** One exercise in the Library's list, as drawn (63a): its picture with a small body lit where it works, its
 *  name, level as plates, main muscles, the starting target and the effort as flames. */
export function ExerciseCard({ entry, sex, onOpen }: { entry: PhoneLibraryEntry; sex: Sex; onOpen: () => void }) {
  const en = entry.text.en;
  const effort = effortOf(entry.met);
  const target = targetLine(entry);
  const level = levelWord(entry.level);
  const muscles = muscleNames(entry.muscles.main);
  const say = [en.name, level, muscles, target, effort === null ? null : EFFORT_WORDS[effort]].filter((s) => s !== null && s !== "").join(", ");
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={say} onPress={onOpen} style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.top}>
        <Image source={pictures[exercisePicture(entry.id, entry.kind)]} resizeMode="cover" style={styles.photo} accessible={false} />
        <View style={[StyleSheet.absoluteFill, styles.shade]} />
        <View style={styles.mini}>
          <MuscleFigure sex={sex} side={sideFor(entry.muscles.main)} lit={litMuscles(entry.muscles)} width={36} />
        </View>
        <Txt kind="tiny" colour="textSoft" style={styles.kind}>
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
  // An absolute Image keeps its own height on Android: it is given the box's whole size, and the box clips it.
  top: { height: 124, overflow: "hidden" },
  photo: { position: "absolute", top: 0, left: 0, width: "100%", height: "100%" },
  shade: { experimental_backgroundImage: artShade },
  mini: { position: "absolute", right: 6, top: 6, paddingVertical: 5, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1, borderColor: colours.lineStrong, backgroundColor: colours.overPicture },
  kind: { position: "absolute", left: 10, bottom: 8 },
  body: { gap: 7, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  level: { flexDirection: "row", alignItems: "center", gap: 7 },
  levelWord: { fontFamily: fonts.semibold },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: colours.line },
  target: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
});
