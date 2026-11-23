import { historyWorkoutSchema, recordValues, EFFORT_WORDS, type HistoryWorkout } from "@app/shared";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { PictureTop } from "../../look/PictureTop";
import { Txt } from "../../look/Txt";
import type { Units } from "../../library/records";
import { useSession } from "../../session/SessionProvider";
import { useNamed } from "../library/useLibrary";
import { pastWhen, workoutName } from "../progress/calendarRules";
import { dayKeyOf } from "../progress/progressRules";
import { blocksOf, kcalLine, recordRowOf, type ShownSet } from "./afterWords";
import { serverFirst } from "./pastWords";
import { HeartLine, RecordsBox, SetBlocks, Tile, Wall } from "./WorkoutParts";
import { clock } from "./words";

// One of the person's workouts, looked back on (ROADMAP Stage 5 64a-v, Kd's drawing of 2026-11-22): opened from a day
// of Progress's calendar, from Recent Activity on Today, and from My Workout's History. The same look as the screen
// after a workout (64a-iii): the wall timer with the time trained, calories and sets, the new records, then every set,
// exercise by exercise. A workout of any age opens, a free plan's older than its 90 days too, as 61b's read allows.

export const workoutPath = (workoutId: string): string => `/v1/training/workouts/${encodeURIComponent(workoutId)}`;

type Read = { kind: "loading" } | { kind: "ok"; workout: HistoryWorkout } | { kind: "gone" } | { kind: "failed" };

/** `workoutId` null: closed. */
export function PastWorkout({ workoutId, units, onClose }: { workoutId: string | null; units: Units; onClose: () => void }) {
  const { session } = useSession();
  const named = useNamed();
  const [read, setRead] = useState<Read>({ kind: "loading" });
  const [asked, setAsked] = useState(0);

  useEffect(() => {
    if (workoutId === null) return undefined;
    let live = true;
    setRead({ kind: "loading" });
    void session.signedIn({ method: "GET", path: workoutPath(workoutId) }, historyWorkoutSchema).then((answer) => {
      if (!live) return;
      if (answer.kind === "ok") setRead({ kind: "ok", workout: answer.data });
      else if (answer.kind === "refused" && answer.status === 404) setRead({ kind: "gone" });
      else setRead({ kind: "failed" });
    });
    return () => {
      live = false;
    };
  }, [workoutId, session, asked]);

  const w = read.kind === "ok" ? read.workout : null;
  const shown = useMemo(() => {
    if (w === null) return null;
    const sets: ShownSet[] = w.sets.map((s) => ({ ...s, place: s.position }));
    const records = recordValues(w);
    const name = serverFirst(named, new Map(w.sets.map((s) => [s.exercise, s.exerciseName])));
    return { blocks: blocksOf(sets, name, records, units), records: records.map((r) => recordRowOf(r, sets, units)) };
  }, [w, named, units]);

  const title = w === null ? "Workout" : workoutName(w.name);
  const hero = (
    <PictureTop picture="exhero" tall={0.7} {...(w === null ? {} : { eyebrow: pastWhen(new Date(w.startedAt), dayKeyOf(new Date())) })} {...(w === null ? {} : { title })} />
  );

  return (
    <CoverPage open={workoutId !== null} title={title} onClose={onClose} hero={hero}>
      {read.kind === "loading" ? (
        <Txt kind="small">Loading your workout…</Txt>
      ) : read.kind === "gone" ? (
        <Txt kind="body">This workout is no longer in your history.</Txt>
      ) : read.kind === "failed" || w === null || shown === null ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            Your workout couldn't load.
          </Txt>
          <Button label="Try again" kind="link" say="Try your workout again" onPress={() => { setAsked((n) => n + 1); }} />
        </View>
      ) : (
        <>
          <Wall>
            <Tile label="Time" text={w.durationMs === null ? "--:--" : clock(w.durationMs)} colour={w.durationMs === null ? "ledOff" : "ledAmber"} {...(w.durationMs === null ? { say: "not known" } : {})} />
            <Tile
              label="Kcal"
              text={w.kcalPoint === null ? "888" : String(w.kcalPoint)}
              colour={w.kcalPoint === null ? "ledOff" : "ledRed"}
              say={w.kcalPoint === null ? "not known" : `about ${String(w.kcalPoint)} calories`}
            />
            <Tile label="Sets" text={String(w.sets.length).padStart(2, "0")} colour="ledGreen" say={String(w.sets.length)} />
          </Wall>
          {w.kcalPoint === null ? null : (
            <Txt kind="small" style={styles.centre}>
              {kcalLine(w.kcalPoint, w.kcalWeightKg, units)}
            </Txt>
          )}
          {w.effort === null ? null : (
            <View style={styles.row} accessible accessibilityLabel={`How hard it was: ${String(w.effort)} of 5, ${EFFORT_WORDS[w.effort - 1] ?? ""}`}>
              <Txt kind="body" style={styles.grow}>
                How hard it was
              </Txt>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Icon key={n} name="star" size={16} colour={n <= (w.effort ?? 0) ? "ledAmber" : "textFaint"} filled={n <= (w.effort ?? 0)} />
                ))}
              </View>
              <Txt kind="small" colour="ledAmber">
                {EFFORT_WORDS[w.effort - 1] ?? ""}
              </Txt>
            </View>
          )}
          {w.heartAvg === null ? null : <HeartLine avg={w.heartAvg} max={w.heartMax} />}
          {shown.records.length === 0 ? null : <RecordsBox rows={shown.records} />}
          {shown.blocks.length === 0 ? <Txt kind="body">No sets were done in this workout.</Txt> : <SetBlocks blocks={shown.blocks} />}
        </>
      )}
    </CoverPage>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  centre: { textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  stars: { flexDirection: "row", gap: 2 },
});
