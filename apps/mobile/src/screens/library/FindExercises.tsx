import type { PhoneLibraryEntry } from "@app/shared";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Button } from "../../look/Button";
import { Segments } from "../../look/Choice";
import { colours, sizes, stageGlow } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { fonts, Txt } from "../../look/Txt";
import { centreOf, figureName, type Sex, type Side } from "../../library/figure";
import {
  applyFilters,
  choicesOf,
  countWith,
  emptyShapes,
  muscleGroup,
  NO_EQUIPMENT,
  NO_FILTERS,
  pickedCount,
  pickedShapes,
  shapesOf,
  toggle,
  type FilterGroup,
  type Filters,
} from "../../library/filters";
import { exercisePicture } from "../../library/pictures";
import { countedWord, equipmentWord, kindWord, levelPlates, levelWord } from "../../library/words";
import { KitMark, Plates } from "./Marks";
import { MuscleFigure, MuscleLeader } from "./MuscleFigure";

const SIDES = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
] as const;

const exercisesWord = (n: number) => `${String(n)} ${n === 1 ? "exercise" : "exercises"}`;

/** What a choice is called, on this page and on the Library's tags alike. */
export function choiceWord(group: FilterGroup, value: string): string {
  switch (group) {
    case "muscle":
      return value;
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

/** Find exercises (63b, Kd's second drawing): the person's own body to tap, then equipment, level, how it is
 *  counted and kind, each choice with how many exercises it would show. Changed here and shown on the Library only
 *  by Show; the ✕ leaves the Library as it was. `list`: the exercises the Library would show before these filters
 *  (its search kept), so every number here is the number the Library then shows. */
export function FindExercises({
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
  const [side, setSide] = useState<Side>("front");
  const [last, setLast] = useState<string | null>(null);
  // Each opening starts from what the Library shows now.
  useEffect(() => {
    if (open) {
      setDraft(applied);
      setLast(null);
    }
  }, [open, applied]);

  const shown = applyFilters(list, draft).length;
  const pick = (group: FilterGroup, value: string) => {
    setDraft((d) => toggle(d, group, value));
  };

  return (
    <CoverPage
      open={open}
      title="Find exercises"
      onClose={onClose}
      action={
        <Button
          label="Clear all"
          kind="link"
          disabled={pickedCount(draft) === 0}
          onPress={() => {
            setDraft(NO_FILTERS);
            setLast(null);
          }}
        />
      }
      foot={
        <Button
          label={shown === 0 ? "No exercises match" : `Show ${exercisesWord(shown)}`}
          raised
          wide
          disabled={shown === 0}
          onPress={() => {
            onShow(draft);
          }}
        />
      }
    >
      {sex === null ? (
        <Section title="Muscle">
          <Tiles list={list} draft={draft} group="muscle" onPick={pick} art={() => null} />
        </Section>
      ) : (
        <Body
          list={list}
          draft={draft}
          sex={sex}
          side={side}
          last={last}
          onSide={setSide}
          onTap={(muscle) => {
            const group = muscleGroup(muscle);
            setLast(draft.muscle.includes(group) ? null : group);
            pick("muscle", group);
          }}
        />
      )}
      {draft.muscle.length === 0 || sex === null ? null : (
        <View style={styles.tags}>
          {draft.muscle.map((m) => (
            <Tag key={m} label={m} onRemove={() => { pick("muscle", m); if (last === m) setLast(null); }} />
          ))}
        </View>
      )}
      <Section title="Equipment">
        <Tiles list={list} draft={draft} group="equipment" onPick={pick} art={(v) => <KitMark item={v === NO_EQUIPMENT ? undefined : v} size={0.9} />} />
      </Section>
      <Section title="Level">
        <Tiles list={list} draft={draft} group="level" onPick={pick} art={(v) => <Plates lit={levelPlates(v)} scale={1.25} />} />
      </Section>
      <Section title="How it is counted">
        <Tiles list={list} draft={draft} group="counted" onPick={pick} art={(v) => <Icon name={v === "hand" ? "timer" : "camera"} size={22} colour="orange" />} />
      </Section>
      <Section title="Kind">
        <Kinds list={list} draft={draft} onPick={pick} />
      </Section>
    </CoverPage>
  );
}

/** The figure to tap: the person's own, front or back, the picked muscles lit and those no exercise here works dimmed
 *  (and not pressed). The last muscle tapped is named, with how many exercises it would show. */
function Body({
  list,
  draft,
  sex,
  side,
  last,
  onSide,
  onTap,
}: {
  list: readonly PhoneLibraryEntry[];
  draft: Filters;
  sex: Sex;
  side: Side;
  last: string | null;
  onSide: (side: Side) => void;
  onTap: (muscle: string) => void;
}) {
  const { width } = useWindowDimensions();
  const figure = Math.min(220, Math.floor((width - sizes.edge * 2) * 0.55));
  const lit = useMemo(() => pickedShapes(draft), [draft]);
  const off = useMemo(() => emptyShapes(list, draft), [list, draft]);
  const shape = last === null ? undefined : shapesOf(last).find((s) => centreOf(figureName(sex, side), s) !== null);
  return (
    <View style={styles.stage} accessible={false}>
      <View style={styles.stageHead}>
        <Txt kind="eyebrow" colour="textFaint">
          Tap a muscle
        </Txt>
      </View>
      <View style={styles.figure}>
        <View style={{ width: figure }}>
          <MuscleFigure sex={sex} side={side} lit={lit} off={off} width={figure} onTap={onTap} />
          {last === null || shape === undefined ? null : (
            <MuscleLeader sex={sex} side={side} muscle={shape} name={last} note={exercisesWord(countWith(list, draft, "muscle", last))} width={figure} from={0.56} room={figure * 0.44 + (width - sizes.edge * 2 - figure) / 2 - 12} />
          )}
        </View>
      </View>
      <View style={styles.sides}>
        <Segments options={SIDES} selected={side} onPick={onSide} />
      </View>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Txt kind="eyebrow">{title}</Txt>
      {children}
    </View>
  );
}

/** One group's choices, two to a row, each with its count. A choice that would show nothing is faint and not
 *  pressed, unless it is already picked (so it can be let go). */
function Tiles({
  list,
  draft,
  group,
  onPick,
  art,
}: {
  list: readonly PhoneLibraryEntry[];
  draft: Filters;
  group: FilterGroup;
  onPick: (group: FilterGroup, value: string) => void;
  art: (value: string) => ReactNode;
}) {
  const half = useHalf();
  return (
    <View style={styles.tiles}>
      {choicesOf(list, group).map((v) => {
        const on = draft[group].includes(v);
        const n = countWith(list, draft, group, v);
        const word = choiceWord(group, v);
        const shownArt = art(v);
        return (
          <Pressable
            key={v === "" ? "none" : v}
            accessibilityRole="checkbox"
            accessibilityLabel={`${word}, ${exercisesWord(n)}`}
            accessibilityState={{ checked: on, disabled: n === 0 && !on }}
            disabled={n === 0 && !on}
            onPress={() => {
              onPick(group, v);
            }}
            style={({ pressed }) => [styles.tile, half, on ? styles.tileOn : null, n === 0 && !on ? styles.tileNone : null, pressed ? styles.pressed : null]}
          >
            {shownArt === null ? null : <View style={styles.art}>{shownArt}</View>}
            <Txt kind="strong" numberOfLines={2} style={styles.tileWord}>
              {word}
            </Txt>
            <View style={[styles.count, on ? styles.countOn : null]}>
              <Txt kind="tiny" colour={on ? "onOrange" : "textSoft"} style={styles.countWord}>
                {String(n)}
              </Txt>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The kinds as pictures, each with its count. */
function Kinds({ list, draft, onPick }: { list: readonly PhoneLibraryEntry[]; draft: Filters; onPick: (group: FilterGroup, value: string) => void }) {
  const half = useHalf();
  return (
    <View style={styles.tiles}>
      {choicesOf(list, "kind").map((k) => {
        const on = draft.kind.includes(k);
        const n = countWith(list, draft, "kind", k);
        const word = kindWord(k);
        return (
          <Pressable
            key={k}
            accessibilityRole="checkbox"
            accessibilityLabel={`${word}, ${exercisesWord(n)}`}
            accessibilityState={{ checked: on, disabled: n === 0 && !on }}
            disabled={n === 0 && !on}
            onPress={() => {
              onPick("kind", k);
            }}
            style={({ pressed }) => [styles.kind, half, on ? styles.tileOn : null, n === 0 && !on ? styles.tileNone : null, pressed ? styles.pressed : null]}
          >
            <Image source={pictures[exercisePicture("", k)]} resizeMode="cover" style={styles.kindPicture} accessible={false} />
            <View style={styles.kindShade} />
            <Txt kind="strong" style={styles.kindWord}>
              {word}
            </Txt>
            <View style={[styles.count, on ? styles.countOn : null]}>
              <Txt kind="tiny" colour={on ? "onOrange" : "textSoft"} style={styles.countWord}>
                {String(n)}
              </Txt>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Two choices a row, as drawn: a lone one keeps its half. */
function useHalf() {
  const { width } = useWindowDimensions();
  return { width: Math.floor((width - sizes.edge * 2 - GAP) / 2) };
}
const GAP = 10;

/** A picked choice with its ✕, on this page and on the Library. */
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
  pressed: { opacity: 0.85 },
  stage: { borderRadius: 24, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box, experimental_backgroundImage: stageGlow, paddingBottom: 14 },
  stageHead: { alignItems: "flex-end", paddingHorizontal: 16, paddingTop: 14 },
  figure: { alignItems: "center", paddingTop: 14 },
  sides: { alignSelf: "center", width: 200, marginTop: 14 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: 14, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.orangeLine, backgroundColor: colours.orangeFill },
  tagWord: { fontFamily: fonts.semibold },
  section: { gap: 10 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  tile: { minHeight: 92, gap: 8, alignItems: "center", justifyContent: "center", paddingVertical: 14, paddingHorizontal: 12, borderRadius: sizes.boxRadius, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box },
  tileOn: { borderColor: colours.orange, backgroundColor: colours.orangeFill },
  tileNone: { opacity: 0.45 },
  tileWord: { textAlign: "center" },
  art: { minHeight: 28, alignItems: "center", justifyContent: "center" },
  count: { position: "absolute", top: 8, right: 8, minWidth: 22, minHeight: 22, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", borderRadius: sizes.round, backgroundColor: colours.fill },
  countOn: { backgroundColor: colours.orange },
  countWord: { fontFamily: fonts.bold },
  kind: { minHeight: 96, justifyContent: "flex-end", padding: 12, borderRadius: sizes.boxRadius, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box, overflow: "hidden" },
  // Held by all four edges: a share of the height means nothing in a box that only has a least height.
  kindPicture: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: undefined, height: undefined },
  kindShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colours.scrim },
  kindWord: { color: colours.text },
});
