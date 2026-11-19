import type { PhoneLibraryEntry } from "@app/shared";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { fonts, Txt } from "../../look/Txt";
import type { Sex } from "../../library/figure";
import { applyFilters, choicesOf, countWith, NO_EQUIPMENT, NO_FILTERS, pickedCount, toggle, type FilterGroup, type Filters } from "../../library/filters";
import { countedWord, equipmentWord, kindWord, levelWord, muscleTitle } from "../../library/words";
import { FindByMuscle } from "./FindByMuscle";

const exercisesWord = (n: number) => `${String(n)} ${n === 1 ? "exercise" : "exercises"}`;

/** What a choice is called, on Filters and on the Library's tags alike. */
export function choiceWord(group: FilterGroup, value: string): string {
  switch (group) {
    case "muscle":
      return muscleTitle(value);
    case "equipment":
      return value === NO_EQUIPMENT ? "No equipment" : equipmentWord(value);
    case "level":
      return levelWord(value);
    case "counted":
      return countedWord(value);
    case "kind":
      return kindWord(value);
  }
}

const GROUPS: readonly { group: FilterGroup; title: string }[] = [
  { group: "equipment", title: "Equipment" },
  { group: "level", title: "Level" },
  { group: "counted", title: "How it is counted" },
  { group: "kind", title: "Kind" },
];

/** Filters (63b, the second drawing): the muscle as one row that opens the body, then equipment, level, how it is
 *  counted and kind as choices with how many exercises each would show. Shown on the Library only by Show; the ✕
 *  leaves it as it was. `list`: the exercises the Library would show before these filters (its search kept), so every
 *  number here is the number the Library then shows. */
export function FiltersPage({
  open,
  list,
  applied,
  sex,
  onShow,
  onClose,
}: {
  open: boolean;
  list: readonly PhoneLibraryEntry[];
  applied: Filters;
  sex: Sex | null;
  onShow: (filters: Filters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(applied);
  const [shown, setShown] = useState(open);
  const [choosing, setChoosing] = useState(false);
  // Each opening starts from what the Library shows now.
  if (open !== shown) {
    setShown(open);
    if (open) setDraft(applied);
  }
  const count = applyFilters(list, draft).length;
  const muscle = draft.muscle[0];

  return (
    <CoverPage
      open={open}
      title="Filters"
      onClose={onClose}
      action={<Button label="Clear all" kind="link" disabled={pickedCount(draft) === 0} onPress={() => { setDraft(NO_FILTERS); }} />}
      foot={
        <Button
          label={count === 0 ? "No exercises match" : `Show ${exercisesWord(count)}`}
          raised
          wide
          disabled={count === 0}
          onPress={() => {
            onShow(draft);
          }}
        />
      }
    >
      {/* The person's own figure only: until the setup answer is known there is no body to choose on. */}
      {sex === null ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={muscle === undefined ? "Muscle, any. Choose on the body." : `Muscle, ${muscleTitle(muscle)}. Change on the body.`}
          onPress={() => {
            setChoosing(true);
          }}
          style={({ pressed }) => [styles.muscle, pressed ? styles.pressed : null]}
        >
          <View style={styles.grow}>
            <Txt kind="eyebrow">Muscle</Txt>
            <Txt kind="strong">{muscle === undefined ? "Any muscle" : muscleTitle(muscle)}</Txt>
            <Txt>{muscle === undefined ? "Choose on the body" : "Picked on the body"}</Txt>
          </View>
          {muscle === undefined ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${muscleTitle(muscle)}`}
              hitSlop={10}
              onPress={() => {
                setDraft((d) => ({ ...d, muscle: [] }));
              }}
              style={styles.remove}
            >
              <Icon name="x" size={16} colour="textSoft" />
            </Pressable>
          )}
          <Icon name="go" size={18} colour="textFaint" />
        </Pressable>
      )}
      {GROUPS.map(({ group, title }) => (
        <View key={group} style={styles.group}>
          <Txt kind="eyebrow">{title}</Txt>
          <View style={styles.chips}>
            {choicesOf(list, group, draft[group]).map((v) => {
              const on = draft[group].includes(v);
              const n = countWith(list, draft, group, v);
              const word = choiceWord(group, v);
              return (
                <Pressable
                  key={v === NO_EQUIPMENT ? "none" : v}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${word}, ${exercisesWord(n)}`}
                  accessibilityState={{ checked: on, disabled: n === 0 && !on }}
                  disabled={n === 0 && !on}
                  onPress={() => {
                    setDraft((d) => toggle(d, group, v));
                  }}
                  style={({ pressed }) => [styles.chip, on ? styles.chipOn : null, n === 0 && !on ? styles.chipNone : null, pressed ? styles.pressed : null]}
                >
                  <Txt colour={on ? "onOrange" : "textSoft"} style={on ? styles.wordOn : styles.word}>
                    {word}
                  </Txt>
                  <Txt kind="tiny" colour={on ? "onOrange" : "textFaint"} style={styles.count}>
                    {String(n)}
                  </Txt>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      {sex === null ? null : (
        <FindByMuscle
          open={choosing}
          sex={sex}
          list={applyFilters(list, { ...draft, muscle: [] })}
          first={muscle ?? null}
          act="Use this muscle"
          onAct={(m) => {
            setDraft((d) => ({ ...d, muscle: [m] }));
            setChoosing(false);
          }}
          onClose={() => {
            setChoosing(false);
          }}
        />
      )}
    </CoverPage>
  );
}

/** A picked choice with its ✕, on the Library. */
export function Tag({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${label}`} onPress={onRemove} hitSlop={6} style={({ pressed }) => [styles.tag, pressed ? styles.pressed : null]}>
      <Txt kind="small" colour="orange" style={styles.tagWord}>
        {label}
      </Txt>
      <Icon name="x" size={14} colour="orange" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
  muscle: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: sizes.boxRadius, borderWidth: 1, borderColor: colours.orangeLine, backgroundColor: colours.box },
  remove: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: sizes.round, backgroundColor: colours.fill },
  group: { gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 14, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.fill },
  chipOn: { borderColor: "transparent", backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.chip },
  chipNone: { opacity: 0.45 },
  word: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  wordOn: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  count: { fontFamily: fonts.bold, fontSize: 12 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.orangeLine, backgroundColor: colours.orangeFill },
  tagWord: { fontFamily: fonts.semibold },
});
