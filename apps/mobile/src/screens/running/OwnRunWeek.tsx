// My plan's week (ROADMAP Stage 5 item 37d-iii-b): a run or a rest day for each day, Monday to Sunday.
// Build my own starts from this week's suggested runs; a day opens a box from the bottom to pick its run,
// its distance, or another day to move it to. Nothing is kept until Save; the app never resizes a run,
// and says it beside one past the 10 % line.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  OWN_FAST_LEAST_M,
  OWN_RUN_LEAST_M,
  OWN_STEADY_LEAST_M,
  RUN_LONGEST_MOST_M,
  overCap,
  ownRunOf,
  ownSessionOf,
  ownWeekM,
  runPlanResponseSchema,
  type OwnRun,
  type OwnWeek,
  type RunPlanResponse,
  type Units,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Chip } from "../../look/Chip";
import { colours, sizes } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { PictureTop } from "../../look/PictureTop";
import { Ruler } from "../../look/Ruler";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { OWN_PLAN_PATH } from "./RunChoice";
import { OWN_KIND_WORDS, dayName, ownCount, planDistance, sessionDetail, sessionTitle, weekdayShort } from "./runPlanWords";
import { METRES_PER_MILE } from "./runWords";

const REST: OwnWeek = [null, null, null, null, null, null, null];
type Kind = OwnRun["kind"];
const KINDS: readonly Kind[] = ["easy", "long", "steady", "fast", "walk_run"];
export const OVER_CAP_SHORT = "More than 10% longer than your longest run in the last 30 days.";

/** Where Build my own starts: the week kept, else this week's suggested runs, else rest days. */
export function startingWeek(data: RunPlanResponse): OwnWeek {
  if (data.own !== null) return data.own.week;
  if (data.plan === null || data.plan.kind === "none") return REST;
  return data.plan.days.map((d) => (d.session === null ? null : ownRunOf(d.session)));
}

const C25K_ROWS: readonly number[] = Array.from({ length: 27 }, (_, i) => i);
/** "Week 5 · Run 1". */
export const c25kName = (index: number): string => `Week ${String(Math.floor(index / 3) + 1)} · Run ${String((index % 3) + 1)}`;

const leastFor = (kind: Exclude<Kind, "walk_run">): number => (kind === "steady" ? OWN_STEADY_LEAST_M : kind === "fast" ? OWN_FAST_LEAST_M : OWN_RUN_LEAST_M);

/** The distances offered: every half kilometre or half mile, each a whole 100 m, never under the kind's least. */
export function distanceRows(kind: Exclude<Kind, "walk_run">, units: Units): number[] {
  const step = units === "imperial" ? METRES_PER_MILE / 2 : 500;
  const rows: number[] = [];
  for (let i = 1; i * step <= RUN_LONGEST_MOST_M + 100; i += 1) {
    const m = Math.ceil((i * step) / 100) * 100;
    if (m >= leastFor(kind) && m <= RUN_LONGEST_MOST_M && rows.at(-1) !== m) rows.push(m);
  }
  return rows;
}

const nearestIndex = (rows: readonly number[], m: number): number => {
  let best = 0;
  rows.forEach((r, i) => {
    if (Math.abs(r - m) < Math.abs((rows[best] ?? 0) - m)) best = i;
  });
  return best;
};

/** A new kind of run keeps the distance it had where it can, else the kind's own first distance. */
function runAs(kind: Kind, before: OwnRun | null, units: Units): OwnRun {
  if (kind === "walk_run") return before?.kind === "walk_run" ? before : { kind, index: 0 };
  const rows = distanceRows(kind, units);
  const wanted = before !== null && before.kind !== "walk_run" ? before.m : kind === "long" ? 10_000 : 5_000;
  return { kind, m: rows[nearestIndex(rows, wanted)] ?? leastFor(kind) };
}

export function OwnRunWeek({ data, units, onClose, onSaved }: { data: RunPlanResponse | null; units: Units; onClose: () => void; onSaved: (reply: RunPlanResponse) => void }) {
  const { session } = useSession();
  const open = data !== null;
  const [draft, setDraft] = useState<OwnWeek>(REST);
  const [from, setFrom] = useState<OwnWeek>(REST);
  const [editing, setEditing] = useState<number | null>(null);
  const [said, setSaid] = useState<{ at: number; words: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (data === null) return;
    const start = startingWeek(data);
    setDraft(start);
    setFrom(start);
    setEditing(null);
    setSaid(null);
    setProblem(null);
    setLeaving(false);
    // Opened once; a read landing while the page is open leaves the week being written alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changed = JSON.stringify(draft) !== JSON.stringify(from);
  const weekM = ownWeekM(draft);
  const ownDays = draft.map((run, i) => ({ day: String(i), weekday: i + 1, session: run === null ? null : ownSessionOf(run, weekM), done: false }));
  const capM = data?.capM ?? null;
  const paces = data?.plan?.kind === "runner" ? data.plan.paces : null;
  const close = () => {
    if (changed) setLeaving(true);
    else onClose();
  };
  const setDay = (at: number, run: OwnRun | null) => {
    setDraft((w) => w.map((d, i) => (i === at ? run : d)));
    setSaid(null);
  };
  const move = (at: number, to: number) => {
    const here = draft[at] ?? null;
    const there = draft[to] ?? null;
    setDraft((w) => w.map((d, i) => (i === at ? there : i === to ? here : d)));
    setEditing(null);
    setSaid({ at: to, words: there === null ? `Moved from ${dayName(at + 1)}.` : `Swapped with ${dayName(at + 1)}.` });
  };
  const save = async () => {
    setSaving(true);
    setProblem(null);
    const answer = await session.signedIn({ method: "PUT", path: OWN_PLAN_PATH, body: { days: draft } }, runPlanResponseSchema);
    setSaving(false);
    if (answer.kind !== "ok") {
      setProblem("Couldn’t save your plan. Check your connection and try again.");
      return;
    }
    onSaved(answer.data);
  };

  const foot = <Button label="Save" wide busy={saving} onPress={() => void save()} />;
  return (
    <CoverPage
      open={open}
      title="My plan"
      onClose={close}
      foot={foot}
      hero={<PictureTop picture="runners" tall={0.62} eyebrow="Training plan" title="My plan" foot={<Txt kind="small" colour="textSoft">{ownCount(ownDays, units)}</Txt>} />}
    >
      <View style={styles.list}>
        {draft.map((run, i) => {
          const s = run === null ? null : ownSessionOf(run, weekM);
          return (
            <View key={dayName(i + 1)} style={i === 0 ? null : styles.line}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${dayName(i + 1)}: ${s === null ? "Rest day" : sessionTitle(s, units)}. Change`}
                onPress={() => { setEditing(i); setSaid(null); }}
                style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
              >
                <View style={styles.grow}>
                  <Txt kind="strong">{dayName(i + 1)}</Txt>
                  <Txt kind="small" colour={s === null ? "textFaint" : "textSoft"}>
                    {s === null ? "Rest day" : sessionTitle(s, units)}
                  </Txt>
                </View>
                <Icon name="pen" size={16} colour="textSoft" />
              </Pressable>
              {overCap(s, capM) ? (
                <Txt kind="tiny" colour="gold" style={styles.under}>
                  {OVER_CAP_SHORT}
                </Txt>
              ) : null}
              {said?.at === i ? (
                <Txt kind="tiny" colour="goodText" style={styles.under}>
                  {said.words}
                </Txt>
              ) : null}
            </View>
          );
        })}
      </View>
      {draft.some((d) => d !== null) ? (
        <Button kind="link" label="Clear week" say="Make every day a rest day" onPress={() => { setDraft(REST); setSaid(null); }} />
      ) : null}
      {problem === null ? null : (
        <Txt kind="small" colour="badText">
          {problem}
        </Txt>
      )}
      <DaySheet
        at={editing}
        run={editing === null ? null : (draft[editing] ?? null)}
        weekM={weekM}
        units={units}
        capM={capM}
        paces={paces}
        onPick={(run) => { if (editing !== null) setDay(editing, run); }}
        onMove={(to) => { if (editing !== null) move(editing, to); }}
        onClose={() => { setEditing(null); }}
      />
      <Sheet open={leaving} place="middle" title="Discard changes?" onClose={() => { setLeaving(false); }}>
        <View style={styles.ask}>
          <Txt kind="small">Your plan stays as it was.</Txt>
          <Button label="Discard" kind="danger" onPress={() => { setLeaving(false); onClose(); }} />
          <Button label="Keep editing" kind="link" onPress={() => { setLeaving(false); }} />
        </View>
      </Sheet>
    </CoverPage>
  );
}

function DaySheet({ at, run, weekM, units, capM, paces, onPick, onMove, onClose }: {
  at: number | null;
  run: OwnRun | null;
  /** The week's distance with this day's run as it is now: its tempo and interval share. */
  weekM: number;
  units: Units;
  capM: number | null;
  paces: Parameters<typeof sessionDetail>[1];
  onPick: (run: OwnRun | null) => void;
  onMove: (to: number) => void;
  onClose: () => void;
}) {
  const s = run === null ? null : ownSessionOf(run, weekM);
  const rows = run !== null && run.kind !== "walk_run" ? distanceRows(run.kind, units) : [];
  return (
    <Sheet open={at !== null} title={at === null ? "" : dayName(at + 1)} onClose={onClose}>
      <View style={styles.sheet}>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Run">
          <Chip label="Rest day" on={run === null} onPress={() => { onPick(null); }} />
          {KINDS.map((k) => (
            <Chip key={k} label={OWN_KIND_WORDS[k]} on={run?.kind === k} onPress={() => { onPick(runAs(k, run, units)); }} />
          ))}
        </View>
        {run !== null && run.kind !== "walk_run" ? (
          <Ruler
            label="Distance"
            rows={rows}
            index={nearestIndex(rows, run.m)}
            isSet
            shown={(m) => planDistance(m, units)}
            major={(m) => {
              const n = m / (units === "imperial" ? METRES_PER_MILE : 1000);
              return Math.abs(n - Math.round(n)) < 0.06 && Math.round(n) % 5 === 0 ? String(Math.round(n)) : null;
            }}
            mid={(m) => {
              const n = m / (units === "imperial" ? METRES_PER_MILE : 1000);
              return Math.abs(n - Math.round(n)) < 0.06;
            }}
            onPick={(i) => { const m = rows[i]; if (m !== undefined) onPick({ kind: run.kind, m }); }}
          />
        ) : null}
        {run?.kind === "walk_run" ? (
          <Ruler
            label="Couch to 5K"
            rows={C25K_ROWS}
            index={run.index}
            isSet
            shown={c25kName}
            major={(i) => (i % 3 === 0 ? `W${String(i / 3 + 1)}` : null)}
            onPick={(i) => { onPick({ kind: "walk_run", index: i }); }}
          />
        ) : null}
        {s === null ? null : <Txt kind="small">{sessionDetail(s, paces, units)}</Txt>}
        {overCap(s, capM) ? (
          <Txt kind="small" colour="gold">
            {OVER_CAP_SHORT}
          </Txt>
        ) : null}
        {run === null || at === null ? null : (
          <>
            <Txt kind="eyebrow">Move to another day</Txt>
            <View style={styles.chips}>
              {[0, 1, 2, 3, 4, 5, 6].filter((d) => d !== at).map((d) => (
                <Chip key={d} small label={weekdayShort(d + 1)} on={false} onPress={() => { onMove(d); }} />
              ))}
            </View>
          </>
        )}
        <Button label="Done" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, paddingHorizontal: 16 },
  line: { borderTopWidth: 1, borderTopColor: colours.line },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingVertical: 10 },
  pressed: { opacity: 0.8 },
  grow: { flex: 1, gap: 2 },
  under: { paddingBottom: 10, fontFamily: fonts.medium },
  sheet: { gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ask: { gap: 10 },
});
