import { PLANNED_WORKOUT_LIMITS, type PhoneLibraryEntry } from "@app/shared";
import { useEffect, useState } from "react";
import { AppState, Image, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { Button } from "../../look/Button";
import { colours, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { pictures } from "../../look/pictures";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { fromSaved, NAME_MOST, nameOf as cleanName, plannedOf } from "../../library/myWorkout";
import { exercisePicture } from "../../library/pictures";
import { rebased, savedState, type Planned, type ShownSaved } from "../../library/savedWorkouts";
import { planOf } from "../../library/workoutSetup";
import type { MyWorkoutHook } from "./useLibrary";
import { useWorkoutLayer } from "../workout/WorkoutLayer";

// Saved workouts on My Workout (ROADMAP Stage 5 64a-iv, as drawn): Save workout under Start workout, the person's saved
// workouts under it, the newest three and See all; a press loads one, asking first where My Workout holds what is not
// saved; the bin deletes one, asking first.

/** Shown on the page; the rest are under See all. */
export const SAVED_SHOWN = 3;
const SETS_MOST = PLANNED_WORKOUT_LIMITS.setsMost;

const plural = (n: number, one: string): string => `${String(n)} ${n === 1 ? one : `${one}s`}`;

/** `leave`: My Workout holds what is not saved, and the person pressed a saved workout (`to`, its id) or Create workout
 *  (`to` null): save it first, or not. `new`: the name of a new workout. */
type Box = { kind: "save" } | { kind: "leave"; to: string | null } | { kind: "new" } | { kind: "delete"; id: string } | { kind: "all"; asking: string | null };
type Said = { text: string; bad: boolean } | null;

interface Props {
  mine: MyWorkoutHook;
  planned: Planned;
  entryOf: (id: string) => PhoneLibraryEntry | null;
}

/** The line under Start workout, the saved workouts under it, and their boxes. */
export function SavedPart({ mine, planned, entryOf }: Props) {
  const saved = useWorkoutLayer()?.saved ?? null;
  const { height } = useWindowDimensions();
  const [box, setBox] = useState<Box | null>(null);
  const [said, setSaid] = useState<Said>(null);
  const [boxSaid, setBoxSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  // The person's list is read when My Workout opens and when the app comes back to it.
  const reading = saved?.store ?? null;
  useEffect(() => {
    if (reading === null) return undefined;
    void reading.refresh();
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") void reading.refresh();
    });
    return () => {
      heard.remove();
    };
  }, [reading]);
  // My Workout takes the time the account keeps for this phone's own save (re-check, L3).
  const moved = saved === null ? null : rebased(mine.workout, saved.view.list);
  useEffect(() => {
    if (moved !== null && mine.workout.from !== null) mine.link(mine.workout.from, moved);
  }, [moved, mine]);
  if (saved === null) return null;
  const { view, store } = saved;
  const list = view.list;
  const count = mine.workout.items.length;
  const startOf = (id: string) => planOf({ id, plan: null }, entryOf(id));
  const { linked, same, newer } = savedState(mine.workout, list, startOf);
  const unsaved = count > 0 && !same;
  const nameOf = (id: string) => list.find((e) => e.id === id)?.name ?? "This workout";

  const close = () => {
    setBox(null);
    setBoxSaid(null);
  };

  /** Saves My Workout (over `savedId`, or as a new one); false where it could not be kept, said in the box. */
  const keep = async (savedId: string | null): Promise<boolean> => {
    setBusy(true);
    const result = await store.save({ savedId, name: mine.workout.name, exercises: planned.exercises });
    setBusy(false);
    if (result.kept === "lost") {
      setBoxSaid("This workout couldn't be kept on this phone. Try again in a moment.");
      return false;
    }
    mine.link(result.savedId, { editedAt: result.editedAt, name: mine.workout.name.trim(), exercises: plannedOf(mine.workout, startOf) });
    setSaid(null);
    return true;
  };

  /** A new, empty workout: its name asked first. */
  const askName = () => {
    setNewName("");
    setBoxSaid(null);
    setBox({ kind: "new" });
  };

  const load = async (id: string) => {
    const name = nameOf(id);
    setBusy(true);
    const got = await store.whole(id);
    setBusy(false);
    close();
    if (got.kind === "ok") {
      mine.load(fromSaved(id, got.name, got.exercises, got.editedAt));
      setSaid({ text: `${got.name} is in My Workout.`, bad: false });
    } else if (got.kind === "gone") setSaid({ text: `${name} is no longer in your saved workouts.`, bad: true });
    else setSaid({ text: `Couldn't load ${name}. Check your internet connection and try again.`, bad: true });
  };

  const pressRow = (id: string) => {
    if (linked?.id === id && same) setSaid({ text: `${nameOf(id)} is in My Workout.`, bad: false });
    else if (unsaved) setBox({ kind: "leave", to: id });
    else void load(id);
  };

  const goTo = (to: string | null) => {
    if (to === null) askName();
    else void load(to);
  };

  const pressNew = () => {
    setSaid(null);
    if (unsaved) setBox({ kind: "leave", to: null });
    else askName();
  };

  const create = () => {
    const name = cleanName(newName).trim();
    if (name === "") return;
    mine.load({ name, items: [], from: null, base: null });
    close();
    setSaid({ text: `${name} is ready. Add exercises from the Library.`, bad: false });
  };

  const remove = async (id: string) => {
    const name = nameOf(id);
    setBusy(true);
    const kept = await store.remove(id);
    setBusy(false);
    const inAll = box?.kind === "all";
    if (kept === "lost") {
      setSaid({ text: `${name} couldn't be deleted on this phone. Try again in a moment.`, bad: true });
    } else {
      if (mine.workout.from === id) mine.link(null, null);
      setSaid({ text: `${name} was deleted.`, bad: false });
    }
    if (inAll) setBox({ kind: "all", asking: null });
    else close();
  };

  const rows = (shown: readonly ShownSaved[]) => (
    <View style={styles.rows}>
      {shown.map((e) => (
        <SavedRow key={e.id} entry={e} inMine={linked?.id === e.id} entryOf={entryOf} busy={busy} onLoad={() => { pressRow(e.id); }} onDelete={() => { setBox(box?.kind === "all" ? { kind: "all", asking: e.id } : { kind: "delete", id: e.id }); }} />
      ))}
    </View>
  );

  const saidLine = (s: Said) =>
    s === null ? null : (
      <View style={[styles.said, s.bad ? styles.saidBad : null]}>
        <Txt kind="body" colour={s.bad ? "badText" : "text"}>
          {s.text}
        </Txt>
      </View>
    );

  return (
    <>
      {count === 0 ? (
        <Button label="Create workout" kind="link" icon="plus" style={styles.self} onPress={pressNew} />
      ) : (
        <SaveLine
          linked={linked}
          same={same}
          newer={newer}
          held={view.held}
          onSave={() => {
            setSaid(null);
            setBox({ kind: "save" });
          }}
          onNew={pressNew}
          onNewer={() => {
            if (linked !== null) void load(linked.id);
          }}
        />
      )}
      {view.refused.map((r) => (
        <View key={r.id} style={styles.refused}>
          <Icon name="warn" size={18} colour="badText" />
          <Txt kind="body" colour="badText" style={styles.grow}>
            {`${r.name === "" ? "A workout" : r.name} couldn't be saved. ${r.message === "This workout couldn't be saved." ? "" : r.message}`.trim()}
          </Txt>
          <Button label="OK" kind="link" onPress={() => { store.dismiss(r.id); }} />
        </View>
      ))}
      {list.length === 0 && said === null ? null : (
        <View style={styles.section}>
          {list.length === 0 ? null : (
            <View style={styles.head}>
              <Txt kind="h3">Saved workouts</Txt>
              {list.length > SAVED_SHOWN ? <Button label={`See all ${String(list.length)}`} kind="link" onPress={() => { setSaid(null); setBox({ kind: "all", asking: null }); }} /> : null}
            </View>
          )}
          {saidLine(said)}
          {rows(list.slice(0, SAVED_SHOWN))}
        </View>
      )}

      <Sheet open={box?.kind === "save"} title={linked === null ? "Save workout" : "Save changes?"} onClose={close}>
        {box?.kind === "save" ? (
          <SaveBox
            mine={mine}
            planned={planned}
            linked={linked}
            newer={newer}
            full={list.length >= view.most && view.most > 0}
            most={view.most}
            busy={busy}
            said={boxSaid}
            onSave={(savedId) => {
              void keep(savedId).then((ok) => {
                if (ok) close();
              });
            }}
            onSeeAll={() => {
              setBoxSaid(null);
              setBox({ kind: "all", asking: null });
            }}
          />
        ) : null}
      </Sheet>

      <Sheet open={box?.kind === "leave"} title={box?.kind === "leave" ? leaveTitle(linked, mine.workout.name) : ""} onClose={close}>
        {box?.kind === "leave" ? (
          <LeaveAsk
            mine={mine}
            planned={planned}
            linked={linked}
            newer={newer}
            to={box.to === null ? null : nameOf(box.to)}
            full={linked === null && list.length >= view.most && view.most > 0}
            most={view.most}
            busy={busy}
            said={boxSaid}
            onSave={() => {
              const to = box.to;
              void keep(linked?.id ?? null).then((ok) => {
                if (!ok) return;
                close();
                goTo(to);
              });
            }}
            onDontSave={() => {
              const to = box.to;
              close();
              goTo(to);
            }}
            onCancel={close}
          />
        ) : null}
      </Sheet>

      <Sheet open={box?.kind === "new"} title="Create workout" onClose={close}>
        {box?.kind === "new" ? (
          <View style={styles.boxBody}>
            <Field label="Name" value={newName} onChange={setNewName} placeholder="Push day, Legs, Full body" maxLength={NAME_MOST} ready onDone={create} />
            <Button label="Create" wide raised disabled={newName.trim() === ""} onPress={create} />
          </View>
        ) : null}
      </Sheet>

      <Sheet open={box?.kind === "delete"} title={box?.kind === "delete" ? `Delete ${nameOf(box.id)}?` : ""} onClose={close}>
        {box?.kind === "delete" ? <DeleteAsk id={box.id} inMine={mine.workout.from === box.id} busy={busy} onKeep={close} onDelete={() => { void remove(box.id); }} /> : null}
      </Sheet>

      <Sheet
        open={box?.kind === "all"}
        title={box?.kind === "all" && box.asking !== null ? `Delete ${nameOf(box.asking)}?` : "Saved workouts"}
        onClose={close}
        onBack={() => {
          if (box?.kind !== "all" || box.asking === null) return false;
          setBox({ kind: "all", asking: null });
          return true;
        }}
      >
        {box?.kind !== "all" ? null : box.asking !== null ? (
          <DeleteAsk
            id={box.asking}
            inMine={mine.workout.from === box.asking}
            busy={busy}
            onKeep={() => { setBox({ kind: "all", asking: null }); }}
            onDelete={() => { void remove(box.asking ?? ""); }}
          />
        ) : (
          <ScrollView style={{ maxHeight: height * 0.7 }} contentContainerStyle={styles.boxBody}>
            {saidLine(said)}
            {rows(list)}
            <Txt kind="small" style={styles.centre}>{`${plural(list.length, "saved workout")} of ${String(view.most)}`}</Txt>
          </ScrollView>
        )}
      </Sheet>
    </>
  );
}

/** Under Start workout: Save workout, Save changes, or that it is saved; and Create workout beside it. */
function SaveLine(props: { linked: ShownSaved | null; same: boolean; newer: boolean; held: boolean; onSave: () => void; onNew: () => void; onNewer: () => void }) {
  const { linked, same, newer, held, onSave, onNew, onNewer } = props;
  // Untouched here, and changed on another device since: nothing to save; the newer one can be loaded (round one H1).
  if (linked !== null && same && newer) {
    return (
      <View style={styles.saveArea}>
        <Txt kind="small" style={styles.centre}>{`${linked.name} was changed on another device.`}</Txt>
        <View style={styles.saveRow}>
          <Button label="Load the newer one" kind="link" onPress={onNewer} />
          <Button label="Create workout" kind="link" icon="plus" onPress={onNew} />
        </View>
      </View>
    );
  }
  const isSaved = linked !== null && same;
  const onPhone = isSaved && linked.onPhone && held;
  return (
    <View style={styles.saveArea}>
      <View style={styles.saveRow}>
        {isSaved ? (
          <View style={styles.savedRow} accessible accessibilityLabel={onPhone ? "Saved on this phone. It goes to your account as soon as it can." : "Saved"}>
            <Icon name="check" size={15} colour="good" />
            <Txt kind="small" colour="good" style={styles.bold}>
              {onPhone ? "Saved on this phone." : "Saved"}
            </Txt>
          </View>
        ) : (
          <Button label={linked === null ? "Save workout" : "Save changes"} kind="link" icon="save" onPress={onSave} />
        )}
        <Button label="Create workout" kind="link" icon="plus" onPress={onNew} />
      </View>
      {onPhone ? <Txt kind="small" style={styles.centre}>It goes to your account as soon as it can.</Txt> : null}
    </View>
  );
}

/** The title of the question asked before My Workout's unsaved changes give way. */
function leaveTitle(linked: ShownSaved | null, name: string): string {
  if (linked !== null) return `Save changes to ${linked.name}?`;
  return name.trim() === "" ? "Save this workout?" : `Save ${name.trim()}?`;
}

interface LeaveProps {
  mine: MyWorkoutHook;
  planned: Planned;
  linked: ShownSaved | null;
  newer: boolean;
  /** The name of the saved workout pressed; null for Create workout. */
  to: string | null;
  full: boolean;
  most: number;
  busy: boolean;
  said: string | null;
  onSave: () => void;
  onDontSave: () => void;
  onCancel: () => void;
}

/** My Workout holds what is not saved and is about to give way: save it first, don't, or cancel, as any app asks. */
function LeaveAsk({ mine, planned, linked, newer, to, full, most, busy, said, onSave, onDontSave, onCancel }: LeaveProps) {
  const name = mine.workout.name.trim();
  const what = linked !== null ? `Your changes to ${linked.name} aren't saved.` : name === "" ? "This workout isn't saved." : `${name} isn't saved.`;
  const then = to === null ? "A new workout then takes its place in My Workout." : `${to} then takes its place in My Workout.`;
  const tooMany = planned.sets > SETS_MOST;
  const can = name !== "" && !tooMany && planned.exercises.length > 0 && !full && !busy;
  return (
    <View style={styles.boxBody}>
      <Txt kind="body">{`${what} ${then}`}</Txt>
      {linked === null && name === "" ? <Field label="Name" value={mine.workout.name} onChange={mine.rename} placeholder="Name this workout" maxLength={NAME_MOST} /> : null}
      <Notes planned={planned} linked={linked} newer={newer} />
      {full ? <Txt kind="small">{`You have ${String(most)} saved workouts, the most you can keep. Delete one to save this one.`}</Txt> : null}
      {tooMany ? <Txt kind="small" colour="badText">{`A saved workout holds up to ${String(SETS_MOST)} sets. This one has ${String(planned.sets)}.`}</Txt> : null}
      {said === null ? null : <Txt kind="small" colour="badText">{said}</Txt>}
      <Button label={to === null ? "Save and create workout" : `Save and load ${to}`} wide raised disabled={!can} onPress={onSave} />
      <Button label="Don't save" kind="plain" wide disabled={busy} onPress={onDontSave} />
      <Button label="Cancel" kind="link" style={styles.self} onPress={onCancel} />
    </View>
  );
}

interface SaveBoxProps {
  mine: MyWorkoutHook;
  planned: Planned;
  linked: ShownSaved | null;
  newer: boolean;
  full: boolean;
  most: number;
  busy: boolean;
  said: string | null;
  onSave: (savedId: string | null) => void;
  onSeeAll: () => void;
}

/** The box Save workout opens: the name, once, and what is saved. */
function SaveBox({ mine, planned, linked, newer, full, most, busy, said, onSave, onSeeAll }: SaveBoxProps) {
  const named = mine.workout.name.trim() !== "";
  const tooMany = planned.sets > SETS_MOST;
  const can = named && !tooMany && planned.exercises.length > 0 && !busy;
  const fullLine = `You have ${String(most)} saved workouts, the most you can keep. Delete one to save this one.`;
  return (
    <View style={styles.boxBody}>
      <Field label="Name" value={mine.workout.name} onChange={mine.rename} placeholder="Name this workout" maxLength={NAME_MOST} />
      <Txt kind="body">{`${plural(planned.exercises.length, "exercise")} · ${plural(planned.sets, "set")}`}</Txt>
      {named ? null : <Txt kind="small">Name this workout to save it.</Txt>}
      <Notes planned={planned} linked={linked} newer={newer} />
      {tooMany ? <Txt kind="small" colour="badText">{`A saved workout holds up to ${String(SETS_MOST)} sets. This one has ${String(planned.sets)}.`}</Txt> : null}
      {said === null ? null : <Txt kind="small" colour="badText">{said}</Txt>}
      {linked !== null ? (
        <>
          <Button label={`Save changes to ${linked.name}`} wide raised disabled={!can} onPress={() => { onSave(linked.id); }} />
          {full ? <Txt kind="small">{fullLine}</Txt> : null}
          <Button label="Save as a new workout" kind="link" style={styles.self} disabled={!can || full} onPress={() => { onSave(null); }} />
        </>
      ) : full ? (
        <>
          <Txt kind="body">{fullLine}</Txt>
          <Button label="Save" wide disabled onPress={() => undefined} />
          <Button label="See saved workouts" kind="link" style={styles.self} onPress={onSeeAll} />
        </>
      ) : (
        <Button label="Save" wide raised disabled={!can} onPress={() => { onSave(null); }} />
      )}
    </View>
  );
}

/** What a save leaves out, and what it replaces: an exercise no longer in the Library; a change made on another device. */
function Notes({ planned, linked, newer }: { planned: Planned; linked: ShownSaved | null; newer: boolean }) {
  return (
    <>
      {planned.left.length === 0 ? null : (
        <Txt kind="small">{`${plural(planned.left.length, "exercise")} no longer in the Library ${planned.left.length === 1 ? "isn't" : "aren't"} saved.`}</Txt>
      )}
      {linked !== null && newer ? <Txt kind="small" colour="badText">{`${linked.name} was changed on another device. Saving replaces that change.`}</Txt> : null}
    </>
  );
}

function DeleteAsk({ inMine, busy, onKeep, onDelete }: { id: string; inMine: boolean; busy: boolean; onKeep: () => void; onDelete: () => void }) {
  return (
    <View style={styles.boxBody}>
      <Txt kind="body">{`It's removed from your saved workouts.${inMine ? " My Workout keeps its exercises." : ""}`}</Txt>
      <View style={styles.two}>
        <Button label="Keep it" kind="plain" style={styles.half} onPress={onKeep} />
        <Button label="Delete" kind="danger" icon="trash" style={styles.half} disabled={busy} onPress={onDelete} />
      </View>
    </View>
  );
}

interface RowProps {
  entry: ShownSaved;
  inMine: boolean;
  entryOf: (id: string) => PhoneLibraryEntry | null;
  busy: boolean;
  onLoad: () => void;
  onDelete: () => void;
}

/** One saved workout: its first exercise's picture, its name, how many exercises and sets, their names. A press loads
 *  it; the one My Workout holds says so. */
function SavedRow({ entry, inMine, entryOf, busy, onLoad, onDelete }: RowProps) {
  const first = entry.exercises[0] === undefined ? null : entryOf(entry.exercises[0]);
  const names = entry.exercises.map((id) => entryOf(id)?.text.en.name ?? id).join(", ");
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Load ${entry.name}, ${plural(entry.exercises.length, "exercise")}, ${plural(entry.setsCount, "set")}${inMine ? ", in My Workout" : ""}`}
        disabled={busy}
        onPress={onLoad}
        style={({ pressed }) => [styles.rowMain, pressed ? styles.pressed : null]}
      >
        <View style={styles.thumb}>
          {first === null ? (
            <Icon name="dumbbell" size={20} colour="textFaint" />
          ) : (
            <Image source={pictures[exercisePicture(first.id, first.kind)]} resizeMode="contain" style={styles.thumbPicture} accessible={false} />
          )}
        </View>
        <View style={styles.grow}>
          <Txt kind="strong" numberOfLines={1}>
            {entry.name}
          </Txt>
          <Txt kind="small" numberOfLines={1}>
            {`${plural(entry.exercises.length, "exercise")} · ${plural(entry.setsCount, "set")}`}
          </Txt>
          {/* The one My Workout holds says so under its words, never beside them, so a small phone keeps them whole; its
              exercises are just above, in My Workout. */}
          {inMine ? (
            <View style={styles.tag}>
              <Txt kind="tiny" colour="orange" style={styles.bold}>
                In My Workout
              </Txt>
            </View>
          ) : (
            <Txt kind="small" colour="textFaint" numberOfLines={1}>
              {names}
            </Txt>
          )}
        </View>
        {inMine ? null : (
          <Txt kind="body" colour="orange" style={styles.bold}>
            Load
          </Txt>
        )}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${entry.name}`} onPress={onDelete} style={styles.icon} hitSlop={6}>
        <Icon name="trash" size={18} colour="textSoft" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.85 },
  bold: { fontFamily: fonts.semibold },
  centre: { textAlign: "center" },
  self: { alignSelf: "center" },
  // Under Start workout, closer to it than the page's own gap.
  saveArea: { alignItems: "center", gap: 2, marginTop: -8 },
  saveRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 28, minHeight: sizes.press },
  savedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  section: { gap: 10, marginTop: 10 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: sizes.press },
  said: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.fill },
  saidBad: { borderColor: colours.badLine, backgroundColor: colours.badFill },
  refused: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colours.badLine, backgroundColor: colours.badFill },
  rows: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 8, paddingLeft: 10, paddingRight: 4, borderRadius: 16, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  thumb: { width: 52, height: 52, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colours.box },
  thumbPicture: { width: "100%", height: "100%" },
  tag: { alignSelf: "flex-start", marginTop: 3, paddingVertical: 3, paddingHorizontal: 8, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.orangeLine, backgroundColor: colours.orangeFill },
  icon: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center" },
  boxBody: { gap: 12 },
  two: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
});
