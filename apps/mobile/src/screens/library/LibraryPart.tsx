import { EXERCISE_KINDS, type PhoneLibraryEntry } from "@app/shared";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import { colours, sizes, stageGlow } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Page } from "../../look/Page";
import { PictureTop } from "../../look/PictureTop";
import { fonts, Txt } from "../../look/Txt";
import type { Lit, Sex } from "../../library/figure";
import { applyFilters, FILTER_GROUPS, muscleGroup, NO_FILTERS, pickedCount, pickedShapes, toggle, type Filters } from "../../library/filters";
import { searchExercises } from "../../library/search";
import { offered, type LibraryFile } from "../../library/store";
import { kindWord } from "../../library/words";
import { ExerciseCard } from "./ExerciseCard";
import { ExercisePage } from "./ExercisePage";
import { choiceWord, FindExercises, Tag } from "./FindExercises";
import { MuscleFigure } from "./MuscleFigure";
import { useFigureSex, useLibrary } from "./useLibrary";

const NOTHING_LIT: ReadonlyMap<string, Lit> = new Map<string, Lit>();

/** Workout → Exercises (ROADMAP Stage 5 63a, spec Part 2 §13.6): the Exercise Library kept on the phone,
 *  searched there, narrowed by Find exercises (63b) or a kind, each exercise's page opened over the tab. The kind
 *  chips and Find exercises' Kind are one choice. `parts`: Exercises · My Workout · Running, under the picture. */
export function LibraryPart({ parts, file }: { parts: ReactNode; file?: LibraryFile }) {
  const { state, again } = useLibrary(file);
  const sex = useFigureSex();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [finding, setFinding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const library = state.kind === "ready" ? state.library : null;
  const live = useMemo(() => (library === null ? [] : offered(library)), [library]);
  const kinds = useMemo(() => {
    const present = new Set(live.map((e) => e.kind));
    const known: string[] = EXERCISE_KINDS.filter((k) => present.has(k));
    return [...known, ...[...present].filter((k) => !known.includes(k)).sort()];
  }, [live]);
  // What search alone shows: Find exercises counts within it, so its numbers are the list's.
  const searched = useMemo(() => searchExercises(live, search), [live, search]);
  const shown = useMemo(() => {
    const kept = new Set(applyFilters(searched, filters));
    return searched.filter((e) => kept.has(e));
  }, [searched, filters]);
  const opened = library?.exercises.find((e) => e.id === open) ?? null;
  const searching = search.trim() !== "";
  const picked = pickedCount(filters);
  // The choices beside the kind, shown as tags: the kind has its own chips.
  const tags = FILTER_GROUPS.filter((g) => g !== "kind").flatMap((g) => filters[g].map((v) => ({ group: g, value: v })));
  const clearAll = () => {
    setSearch("");
    setFilters(NO_FILTERS);
  };

  const top = (
    <PictureTop
      picture="exhero"
      tall={0.62}
      eyebrow="Exercise Library"
      foot={
        <Txt kind="hero" numberOfLines={1}>
          {library === null ? "Exercises" : `${String(live.length)} ${live.length === 1 ? "Exercise" : "Exercises"}`}
        </Txt>
      }
    />
  );

  return (
    <Page top={top}>
      {parts}
      {state.kind === "failed" || state.kind === "none" ? (
        <Card style={styles.middle}>
          <View style={styles.badge}>
            <Icon name={state.kind === "none" ? "dumbbell" : "wifioff"} size={24} colour="orange" />
          </View>
          <Txt kind="h3">{state.kind === "none" ? "Exercises aren’t available yet" : "Couldn’t load the exercises"}</Txt>
          {state.kind === "none" ? null : <Txt kind="small">Check your connection.</Txt>}
          <Button label="Try again" kind="plain" small style={styles.self} onPress={again} />
        </Card>
      ) : state.kind === "loading" ? (
        <Txt kind="small" style={styles.centre}>
          Loading exercises…
        </Txt>
      ) : (
        <>
          <View style={styles.searchRow}>
            <View style={styles.grow}>
              <Field label="Search exercises" bare icon="search" iconBare value={search} onChange={setSearch} placeholder="Search exercises" maxLength={60} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={picked === 0 ? "Find exercises" : `Find exercises, ${String(picked)} ${picked === 1 ? "filter" : "filters"} on`}
              onPress={() => { setFinding(true); }}
              style={({ pressed }) => [styles.filter, picked === 0 ? null : styles.filterOn, pressed ? styles.pressed : null]}
            >
              <Icon name="sliders" size={20} colour={picked === 0 ? "text" : "orange"} />
              {picked === 0 ? null : (
                <View style={styles.badgeCount}>
                  <Txt kind="tiny" colour="onOrange" style={styles.bold}>
                    {String(picked)}
                  </Txt>
                </View>
              )}
            </Pressable>
          </View>
          {searching || tags.length > 0 || sex === null ? null : <FindByMuscle sex={sex} library={live} onOpen={() => { setFinding(true); }} />}
          {tags.length === 0 ? null : (
            <View style={styles.tags}>
              {tags.map((t) => (
                <Tag key={`${t.group}-${t.value}`} label={choiceWord(t.group, t.value)} onRemove={() => { setFilters((f) => toggle(f, t.group, t.value)); }} />
              ))}
              <Button label="Clear all" kind="link" small onPress={() => { setFilters(NO_FILTERS); }} />
            </View>
          )}
          {kinds.length === 0 ? null : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds} style={styles.kindsRow}>
              <Chip label="All" on={filters.kind.length === 0} onPress={() => { setFilters((f) => ({ ...f, kind: [] })); }} />
              {kinds.map((k) => (
                <Chip key={k} label={kindWord(k)} on={filters.kind.includes(k)} onPress={() => { setFilters((f) => ({ ...f, kind: [k] })); }} />
              ))}
            </ScrollView>
          )}
          {shown.length === 0 ? (
            <View style={styles.none}>
              {sex === null ? null : (
                <View style={styles.faint}>
                  <MuscleFigure sex={sex} side="front" lit={NOTHING_LIT} width={64} />
                </View>
              )}
              <Txt kind="h3" style={styles.centre}>
                {searching ? `No exercises match “${search.trim()}”` : picked > 0 ? "No exercises match these filters" : "No exercises here yet"}
              </Txt>
              <Txt kind="small" style={styles.centre}>
                Try another word, or clear your search and filters.
              </Txt>
              <Button
                label="Clear search and filters"
                kind="plain"
                small
                style={styles.self}
                onPress={clearAll}
              />
            </View>
          ) : (
            <>
              <Txt kind="small" colour="textFaint">
                {`${String(shown.length)} ${shown.length === 1 ? "exercise" : "exercises"}${searching ? "" : " · A to Z"}`}
              </Txt>
              <Grid entries={shown} sex={sex} onOpen={setOpen} />
            </>
          )}
        </>
      )}
      <FindExercises
        open={finding}
        list={searched}
        applied={filters}
        sex={sex}
        onShow={(next) => {
          setFilters(next);
          setFinding(false);
        }}
        onClose={() => {
          setFinding(false);
        }}
      />
      {opened === null || library === null ? null : (
        <ExercisePage
          entry={opened}
          sex={sex}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </Page>
  );
}

/** The card that opens Find exercises at the body (as drawn): the person's own figure, front and back, lit where
 *  the Library's exercises work most. */
function FindByMuscle({ sex, library, onOpen }: { sex: Sex; library: readonly PhoneLibraryEntry[]; onOpen: () => void }) {
  const lit = useMemo(() => pickedShapes({ ...NO_FILTERS, muscle: [...new Set(library.flatMap((e) => e.muscles.main).map(muscleGroup))] }), [library]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Find by muscle. Tap a muscle on the body." onPress={onOpen} style={({ pressed }) => [styles.muscleCard, pressed ? styles.pressed : null]}>
      <View style={[styles.grow, styles.muscleWords]}>
        <Txt kind="eyebrow">Find by muscle</Txt>
        <Txt kind="strong">Tap a muscle on the body</Txt>
        <Txt kind="small">Front and back</Txt>
      </View>
      <MuscleFigure sex={sex} side="front" lit={lit} width={34} />
      <MuscleFigure sex={sex} side="back" lit={lit} width={34} />
    </Pressable>
  );
}

/** Two cards a row; an odd last one keeps its half. */
function Grid({ entries, sex, onOpen }: { entries: readonly PhoneLibraryEntry[]; sex: Sex | null; onOpen: (id: string) => void }) {
  const rows: PhoneLibraryEntry[][] = [];
  for (let i = 0; i < entries.length; i += 2) rows.push(entries.slice(i, i + 2));
  return (
    <View style={styles.grid}>
      {rows.map((row) => (
        <View key={row.map((e) => e.id).join("+")} style={styles.row}>
          {row.map((e) => (
            <ExerciseCard key={e.id} entry={e} sex={sex} onOpen={() => { onOpen(e.id); }} />
          ))}
          {row.length === 1 ? <View style={styles.gap} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.85 },
  bold: { fontFamily: fonts.bold },
  searchRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  filter: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: sizes.round, borderWidth: 1, borderColor: colours.fieldLine, backgroundColor: colours.field },
  filterOn: { borderColor: colours.orangeLine, backgroundColor: colours.orangeFill },
  badgeCount: { position: "absolute", top: -2, right: -2, minWidth: 20, minHeight: 20, paddingHorizontal: 5, alignItems: "center", justifyContent: "center", borderRadius: sizes.round, backgroundColor: colours.orange },
  muscleCard: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 16, borderRadius: sizes.boxRadius, borderWidth: 1, borderColor: colours.orangeLine, backgroundColor: colours.box, experimental_backgroundImage: stageGlow },
  muscleWords: { gap: 4 },
  tags: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  kindsRow: { marginHorizontal: -sizes.edge },
  kinds: { gap: 10, paddingHorizontal: sizes.edge },
  grid: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  gap: { flex: 1 },
  none: { alignItems: "center", gap: 10, paddingTop: 24, paddingHorizontal: 8 },
  faint: { opacity: 0.6 },
  centre: { textAlign: "center" },
  self: { alignSelf: "center" },
  middle: { alignItems: "center", gap: 10 },
  badge: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colours.orangeFill, borderWidth: 1, borderColor: colours.orangeLine },
});
