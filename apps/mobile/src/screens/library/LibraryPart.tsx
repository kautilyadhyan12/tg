import { EXERCISE_KINDS, type PhoneLibraryEntry } from "@app/shared";
import { useMemo, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import { colours, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Page } from "../../look/Page";
import { PictureTop } from "../../look/PictureTop";
import { Txt } from "../../look/Txt";
import type { Lit, Sex } from "../../library/figure";
import { searchExercises } from "../../library/search";
import { offered, type LibraryFile } from "../../library/store";
import { kindWord } from "../../library/words";
import { ExerciseCard } from "./ExerciseCard";
import { ExercisePage } from "./ExercisePage";
import { MuscleFigure } from "./MuscleFigure";
import { useFigureSex, useLibrary } from "./useLibrary";

const ALL = "all";
const NOTHING_LIT: ReadonlyMap<string, Lit> = new Map<string, Lit>();

/** Workout → Exercises (ROADMAP Stage 5 63a, spec Part 2 §13.6): the Exercise Library kept on the phone,
 *  searched there, a kind picked, each exercise's page opened over the tab. `parts`: Exercises · My
 *  Workout · Running, under the picture. */
export function LibraryPart({ parts, file }: { parts: ReactNode; file?: LibraryFile }) {
  const { state, again } = useLibrary(file);
  const sex = useFigureSex();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>(ALL);
  const [open, setOpen] = useState<string | null>(null);

  const library = state.kind === "ready" ? state.library : null;
  const live = useMemo(() => (library === null ? [] : offered(library)), [library]);
  const kinds = useMemo(() => {
    const present = new Set(live.map((e) => e.kind));
    const known: string[] = EXERCISE_KINDS.filter((k) => present.has(k));
    return [...known, ...[...present].filter((k) => !known.includes(k)).sort()];
  }, [live]);
  const shown = useMemo(() => searchExercises(kind === ALL ? live : live.filter((e) => e.kind === kind), search), [live, kind, search]);
  const opened = library?.exercises.find((e) => e.id === open) ?? null;
  const searching = search.trim() !== "";

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
          <Field label="Search exercises" bare icon="search" iconBare value={search} onChange={setSearch} placeholder="Search exercises" maxLength={60} />
          {kinds.length === 0 ? null : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kinds} style={styles.kindsRow}>
              <Chip label="All" on={kind === ALL} onPress={() => { setKind(ALL); }} />
              {kinds.map((k) => (
                <Chip key={k} label={kindWord(k)} on={kind === k} onPress={() => { setKind(k); }} />
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
                {searching ? `No exercises match “${search.trim()}”` : "No exercises here yet"}
              </Txt>
              <Txt kind="small" style={styles.centre}>
                Try another word, or clear your search and filters.
              </Txt>
              <Button
                label="Clear search and filters"
                kind="plain"
                small
                style={styles.self}
                onPress={() => {
                  setSearch("");
                  setKind(ALL);
                }}
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
