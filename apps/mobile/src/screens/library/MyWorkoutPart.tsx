import type { PhoneLibraryEntry } from "@app/shared";
import { useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { Badge, Card } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Page } from "../../look/Page";
import { pictures } from "../../look/pictures";
import { PictureTop } from "../../look/PictureTop";
import { Txt } from "../../look/Txt";
import { exercisePicture } from "../../library/pictures";
import type { Units } from "../../library/records";
import type { LibraryFile } from "../../library/store";
import { equipmentLine, targetLine } from "../../library/words";
import { COMING_SOON } from "../Soon";
import { ExercisePage } from "./ExercisePage";
import { useLibrary, useMyWorkout, useSetupFacts } from "./useLibrary";

/** Workout → My Workout (ROADMAP Stage 5 63c, as drawn): the exercises the person added from the Library, in the
 *  order they added them, each opening its page, each with its ✕. Starting it comes with job 64a. */
export function MyWorkoutPart({ parts, units, onBrowse, file }: { parts: ReactNode; units: Units; onBrowse: () => void; file?: LibraryFile }) {
  const { state } = useLibrary(file);
  const facts = useSetupFacts();
  const mine = useMyWorkout();
  const [open, setOpen] = useState<string | null>(null);
  const library = state.kind === "ready" ? state.library : null;
  const list = mine?.list ?? [];
  const opened = library?.exercises.find((e) => e.id === open) ?? null;

  const top = (
    <PictureTop
      picture="exhero"
      tall={0.62}
      eyebrow="My Workout"
      foot={
        <Txt kind="hero" numberOfLines={1}>
          {`${String(list.length)} ${list.length === 1 ? "Exercise" : "Exercises"}`}
        </Txt>
      }
    />
  );
  return (
    <Page top={top}>
      {parts}
      {list.length === 0 ? (
        <Card style={styles.middle}>
          <Badge icon="dumbbell" />
          <Txt kind="h3">No exercises yet</Txt>
          <Txt kind="small">Add exercises from the Library.</Txt>
          <Button label="Browse exercises" kind="plain" small style={styles.self} onPress={onBrowse} />
        </Card>
      ) : (
        <>
          <View style={styles.rows}>
            {list.map((id) => (
              <Row
                key={id}
                id={id}
                entry={library?.exercises.find((e) => e.id === id) ?? null}
                onOpen={() => {
                  setOpen(id);
                }}
                onRemove={() => {
                  mine?.remove(id);
                }}
              />
            ))}
          </View>
          <View style={styles.start}>
            <Button label="Start workout" wide disabled onPress={() => undefined} />
            <Txt kind="small" style={styles.centre}>
              {COMING_SOON}
            </Txt>
          </View>
        </>
      )}
      {opened === null ? null : (
        <ExercisePage
          entry={opened}
          sex={facts.sex}
          units={units}
          weightKg={facts.weightKg}
          onWeighed={facts.again}
          onOpenMine={() => {
            setOpen(null);
          }}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </Page>
  );
}

/** One exercise: its picture, name and starting target; one no longer in the Library says so, and can still go. */
function Row({ id, entry, onOpen, onRemove }: { id: string; entry: PhoneLibraryEntry | null; onOpen: () => void; onRemove: () => void }) {
  const name = entry?.text.en.name ?? id;
  const live = entry !== null && entry.status === "live";
  const line = entry === null ? null : live ? [targetLine(entry), equipmentLine(entry)].filter((x) => x !== null).join(" · ") : null;
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={live ? `${name}. Open its page` : name}
        disabled={!live}
        onPress={onOpen}
        style={({ pressed }) => [styles.rowMain, pressed ? styles.pressed : null]}
      >
        <View style={styles.thumb}>
          {entry === null ? (
            <Icon name="dumbbell" size={20} colour="textFaint" />
          ) : (
            <Image source={pictures[exercisePicture(entry.id, entry.kind)]} resizeMode="contain" style={styles.thumbPicture} accessible={false} />
          )}
        </View>
        <View style={styles.grow}>
          <Txt kind="strong" numberOfLines={1}>
            {name}
          </Txt>
          <Txt kind="small" numberOfLines={1}>
            {line ?? "No longer in the Library"}
          </Txt>
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${name}`} onPress={onRemove} style={styles.remove} hitSlop={6}>
        <Icon name="x" size={18} colour="textSoft" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.85 },
  centre: { textAlign: "center" },
  self: { alignSelf: "center" },
  middle: { alignItems: "center", gap: 10 },
  rows: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingLeft: 10, paddingRight: 4, borderRadius: 16, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 52, height: 52, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colours.box },
  thumbPicture: { width: "100%", height: "100%" },
  remove: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center" },
  start: { gap: 6, marginTop: 6 },
});
