// A saved run's own page (ROADMAP Stage 5 37c-i): the summary as it was after Finish, its numbers the
// server's; its name, how it felt and its note changed and saved with Save changes; Delete run, which
// asks first. Leaving with changes not saved asks "Save your changes?".
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { decodePolyline, runDetailResponseSchema, type RunDetail, type Units } from "@app/shared";
import type { Shape } from "../../session/calls";
import { Button } from "../../look/Button";
import { colours, sizes } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { PictureTop } from "../../look/PictureTop";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { BestEffortsCard } from "./RecordParts";
import { FeelCard, NoteCard, RouteCard, RunFigures, SplitsCard } from "./RunParts";
import { distance, runWhen, unitWord } from "./runWords";

export const RUNS_PATH = "/v1/geo/runs";
const NO_CONNECTION = "No connection. Try again.";
const nothing: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

type Read = { kind: "loading" } | { kind: "ok"; run: RunDetail } | { kind: "gone"; message: string } | { kind: "failed" };

/** What the person has typed or picked, against the run as saved. */
interface Draft {
  name: string;
  effort: number | null;
  note: string;
}
const draftOf = (run: RunDetail): Draft => ({ name: run.name, effort: run.effort, note: run.note ?? "" });

/** What Save changes sends: only what differs from the run as saved. An emptied name keeps the saved one. */
export function changesOf(run: RunDetail, draft: Draft): { name?: string; effort?: number | null; note?: string | null } {
  const name = draft.name.trim();
  const note = draft.note.trim();
  return {
    ...(name !== "" && name !== run.name ? { name: name.slice(0, 60) } : {}),
    ...(draft.effort !== run.effort ? { effort: draft.effort } : {}),
    ...(note !== (run.note ?? "") ? { note: note === "" ? null : note.slice(0, 1000) } : {}),
  };
}

/** `runId` null: closed. `onChanged`: the run was changed, so lists of runs read again. `onDeleted`: it
 *  was deleted, and the page it was opened from says so; without it, `onChanged`. */
export function RunPage({ runId, units, onClose, onChanged, onDeleted }: {
  runId: string | null;
  units: Units;
  onClose: () => void;
  onChanged: () => void;
  onDeleted?: (run: { id: string; name: string }) => void;
}) {
  const { session } = useSession();
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [draft, setDraft] = useState<Draft>({ name: "", effort: null, note: "" });
  const [naming, setNaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (runId === null) return undefined;
    let live = true;
    setRead({ kind: "loading" });
    setSaid(null);
    setTrouble(null);
    setNaming(false);
    setLeaving(false);
    setDeleting(false);
    void session.signedIn({ method: "GET", path: `${RUNS_PATH}/${runId}` }, runDetailResponseSchema).then((answer) => {
      if (!live) return;
      if (answer.kind === "ok") {
        setRead({ kind: "ok", run: answer.data.run });
        setDraft(draftOf(answer.data.run));
      } else if (answer.kind === "refused" && answer.status === 404) setRead({ kind: "gone", message: answer.message });
      else setRead({ kind: "failed" });
    });
    return () => {
      live = false;
    };
  }, [runId, session, asked]);

  const run = read.kind === "ok" ? read.run : null;
  const changes = useMemo(() => (run === null ? {} : changesOf(run, draft)), [run, draft]);
  const dirty = Object.keys(changes).length > 0;
  const track = useMemo(() => (run?.polyline == null ? [] : decodePolyline(run.polyline)), [run]);

  const change = (next: Partial<Draft>) => {
    setSaid(null);
    setTrouble(null);
    setDraft((was) => ({ ...was, ...next }));
  };

  const save = useCallback(async (): Promise<boolean> => {
    if (runId === null || busy || !dirty) return !dirty;
    setBusy(true);
    setTrouble(null);
    const answer = await session.signedIn({ method: "PATCH", path: `${RUNS_PATH}/${runId}`, body: changes }, runDetailResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") {
      setRead({ kind: "ok", run: answer.data.run });
      setDraft(draftOf(answer.data.run));
      setSaid("Changes saved.");
      onChanged();
      return true;
    }
    if (answer.kind === "refused" && answer.status === 404) {
      setRead({ kind: "gone", message: answer.message });
      onChanged();
      return false;
    }
    setTrouble(answer.kind === "no_answer" || answer.message === "" ? NO_CONNECTION : answer.message);
    return false;
  }, [runId, busy, dirty, session, changes, onChanged]);

  const remove = async () => {
    if (runId === null || run === null || busy) return;
    setBusy(true);
    setTrouble(null);
    const answer = await session.signedIn({ method: "DELETE", path: `${RUNS_PATH}/${runId}` }, nothing);
    setBusy(false);
    // Deleted now, or already, on this phone or another: gone either way.
    if (answer.kind === "ok" || (answer.kind === "refused" && answer.status === 404)) {
      setDeleting(false);
      if (onDeleted === undefined) onChanged();
      else onDeleted({ id: run.id, name: run.name });
      onClose();
      return;
    }
    setTrouble(answer.kind === "no_answer" || answer.message === "" ? NO_CONNECTION : answer.message);
  };

  const close = () => {
    if (dirty && read.kind === "ok") {
      setLeaving(true);
      return;
    }
    onClose();
  };

  const when = run === null ? "" : runWhen(new Date(run.startedAt));
  const hero = (
    <PictureTop
      picture="greekrun"
      tall={0.7}
      {...(run === null ? {} : { eyebrow: when })}
      foot={
        run === null ? undefined : naming ? (
          <View style={styles.nameBox}>
            <TextInput
              accessibilityLabel="Run name"
              value={draft.name}
              onChangeText={(name) => {
                change({ name });
              }}
              maxLength={60}
              autoFocus
              onSubmitEditing={() => {
                setNaming(false);
              }}
              onBlur={() => {
                setNaming(false);
              }}
              style={styles.nameInput}
              selectionColor={colours.orange}
            />
          </View>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Rename ${draft.name.trim() === "" ? run.name : draft.name}`} onPress={() => { setNaming(true); }} style={styles.nameRow}>
            <Txt kind="hero" numberOfLines={2} style={styles.nameText}>
              {draft.name.trim() === "" ? run.name : draft.name}
            </Txt>
            <View style={styles.pen}>
              <Icon name="pen" size={14} />
            </View>
          </Pressable>
        )
      }
    />
  );

  const foot =
    run === null || (!dirty && said === null && trouble === null) || leaving || deleting ? undefined : (
      <>
        {trouble === null ? null : (
          <Txt kind="small" colour="badText" style={styles.centred}>
            {trouble}
          </Txt>
        )}
        {dirty ? (
          <Button label="Save changes" wide busy={busy} onPress={() => void save()} />
        ) : said === null ? null : (
          <Txt kind="small" colour="goodText" style={styles.centred}>
            {said}
          </Txt>
        )}
      </>
    );

  return (
    <CoverPage open={runId !== null} title={run?.name ?? "Run"} onClose={close} hero={hero} {...(foot === undefined ? {} : { foot })}>
      {read.kind === "loading" ? (
        <Txt kind="small">Loading your run…</Txt>
      ) : read.kind === "failed" ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            Your run couldn't load.
          </Txt>
          <Button label="Try again" kind="link" say="Try your run again" onPress={() => { setAsked((n) => n + 1); }} />
        </View>
      ) : read.kind === "gone" ? (
        <Txt kind="body">{read.message}</Txt>
      ) : (
        <>
          <RunFigures
            distanceM={read.run.distanceM}
            movingS={read.run.durationS}
            elapsedS={read.run.elapsedS}
            leftOutM={read.run.leftOutM}
            leftOutS={read.run.leftOutS}
            kcal={read.run.kcalPoint ?? 0}
            climb={read.run.climbM === null ? { kind: "none" } : { kind: "done", m: read.run.climbM }}
            units={units}
          />
          <RouteCard track={track} starts={read.run.trackStarts} units={units} name={read.run.name} distanceM={read.run.distanceM} movingS={read.run.durationS} testID="run-map" />
          <SplitsCard splits={units === "imperial" ? read.run.splitsMi : read.run.splitsKm} units={units} />
          <BestEffortsCard bests={read.run.bests} held={read.run.records} units={units} />
          <FeelCard effort={draft.effort} onPick={(effort) => { change({ effort }); }} />
          <NoteCard note={draft.note} onChange={(note) => { change({ note }); }} />
          <Button kind="dangerLink" label="Delete run" style={styles.centredButton} onPress={() => { setTrouble(null); setDeleting(true); }} />
        </>
      )}
      <Sheet
        open={leaving}
        title="Save your changes?"
        onClose={() => {
          setLeaving(false);
        }}
      >
        <Txt kind="body" colour="textSoft">
          You changed this run and haven't saved it.
        </Txt>
        {trouble === null ? null : (
          <Txt kind="small" colour="badText">
            {trouble}
          </Txt>
        )}
        <Button
          label="Save changes"
          wide
          busy={busy}
          onPress={() => {
            void save().then((saved) => {
              if (saved) {
                setLeaving(false);
                onClose();
              }
            });
          }}
        />
        <Button
          kind="link"
          label="Leave without saving"
          style={styles.centredButton}
          onPress={() => {
            setLeaving(false);
            if (run !== null) setDraft(draftOf(run));
            onClose();
          }}
        />
      </Sheet>
      <Sheet
        open={deleting}
        title="Delete this run?"
        onClose={() => {
          setDeleting(false);
        }}
      >
        <Txt kind="body" colour="textSoft">
          {run === null ? "" : `${run.name}, ${distance(run.distanceM, units)} ${unitWord(units)} on ${when.split(" · ")[0] ?? ""}, will be deleted with its route. You can't undo this.`}
        </Txt>
        {trouble === null ? null : (
          <Txt kind="small" colour="badText">
            {trouble}
          </Txt>
        )}
        <Button kind="danger" label="Delete run" wide busy={busy} onPress={() => void remove()} />
        <Button
          kind="link"
          label="Keep run"
          style={styles.centredButton}
          onPress={() => {
            setDeleting(false);
          }}
        />
      </Sheet>
    </CoverPage>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  centred: { textAlign: "center" },
  centredButton: { alignSelf: "center" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  nameText: { flexShrink: 1 },
  pen: { width: 32, height: 32, borderRadius: sizes.round, alignItems: "center", justifyContent: "center", backgroundColor: colours.veil, borderWidth: 1, borderColor: colours.grab },
  nameBox: { borderRadius: 14, backgroundColor: colours.overWords, borderWidth: 1, borderColor: colours.fieldOnLine, paddingHorizontal: 12, minHeight: 48, justifyContent: "center" },
  nameInput: { fontFamily: fonts.bold, fontSize: 24, color: colours.text, paddingVertical: 8 },
});
