// Your runs (ROADMAP Stage 5 37c-i): every run the person saved, newest first, under its month with
// the whole month's runs and distance; runs still on the phone at the top; more as the list is
// scrolled. The small calendar button picks a day, and the list opens there (Kd, 2026-11-07).
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { runPageSchema, type RunMonthTotal, type RunSummary, type Units } from "@app/shared";
import { Button } from "../../look/Button";
import { colours, sizes } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Icon } from "../../look/Icon";
import { PictureTop } from "../../look/PictureTop";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { RefusedRuns } from "./RefusedRuns";
import { RunCalendar, monthWords } from "./RunCalendar";
import { RunPage, RUNS_PATH } from "./RunPage";
import { RunRow } from "./RunRow";
import { useRunOutbox } from "./RunOutbox";
import { distance, runWhen, unitWord } from "./runWords";

const PAGE = 20;

interface Listed {
  items: RunSummary[];
  next: string | null;
  months: Map<string, RunMonthTotal>;
  total: { runs: number; distanceM: number } | null;
}
const EMPTY: Listed = { items: [], next: null, months: new Map(), total: null };

type Status = "loading" | "ok" | "failed";

const runsWords = (runs: number, metres: number, units: Units): string =>
  `${String(runs)} ${runs === 1 ? "run" : "runs"} · ${distance(metres, units)} ${unitWord(units)}`;

/** "Fri 6 Nov" for a day YYYY-MM-DD. */
const dayWords = (day: string): string => runWhen(new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))).split(" · ")[0] ?? day;

export function RunsPage({ open, units, onClose, onStart }: { open: boolean; units: Units; onClose: () => void; onStart: () => void }) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const insets = useSafeAreaInsets();
  const { view } = useRunOutbox();
  const [listed, setListed] = useState<Listed>(EMPTY);
  const [status, setStatus] = useState<Status>("loading");
  const [more, setMore] = useState<"idle" | "loading" | "failed">("idle");
  const [upTo, setUpTo] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [changed, setChanged] = useState(0);
  // Each first read is numbered: an answer to an older one (a day picked since) is dropped.
  const reading = useRef(0);

  /** An answer drawn only for the person who asked, while it is still the newest read. */
  const stillMine = useCallback((number: number): boolean => {
    const now = session.state();
    return number === reading.current && now.kind === "in" && now.user.id === me;
  }, [session, me]);

  const first = useCallback(async () => {
    reading.current += 1;
    const mine = reading.current;
    const answer = await session.signedIn({ method: "GET", path: `${RUNS_PATH}?limit=${String(PAGE)}${upTo === null ? "" : `&upTo=${upTo}`}` }, runPageSchema);
    if (!stillMine(mine)) return;
    if (answer.kind !== "ok") {
      setStatus((was) => (was === "ok" ? "ok" : "failed"));
      return;
    }
    setListed({ items: answer.data.items, next: answer.data.nextCursor, months: new Map(answer.data.months.map((m) => [m.month, m])), total: answer.data.total });
    setStatus("ok");
    setMore("idle");
  }, [session, upTo, stillMine]);

  // Read when the page opens, when a day is picked, when a run is sent or changed.
  useEffect(() => {
    if (!open) return;
    void first();
  }, [open, first, view.sent, changed]);
  // Closed: nothing of the list is kept, so it is never drawn again before a new read lands.
  useEffect(() => {
    if (open) return;
    reading.current += 1;
    setListed(EMPTY);
    setUpTo(null);
    setSaid(null);
    setStatus("loading");
    setMore("idle");
  }, [open]);

  const loadMore = useCallback(async () => {
    const cursor = listed.next;
    if (cursor === null || more === "loading") return;
    setMore("loading");
    const mine = reading.current;
    const answer = await session.signedIn({ method: "GET", path: `${RUNS_PATH}?limit=${String(PAGE)}&cursor=${encodeURIComponent(cursor)}` }, runPageSchema);
    if (!stillMine(mine)) return;
    if (answer.kind !== "ok") {
      setMore("failed");
      return;
    }
    setListed((was) => {
      const months = new Map(was.months);
      for (const m of answer.data.months) months.set(m.month, m);
      const seen = new Set(was.items.map((r) => r.id));
      return { items: [...was.items, ...answer.data.items.filter((r) => !seen.has(r.id))], next: answer.data.nextCursor, months, total: was.total };
    });
    setMore("idle");
  }, [listed.next, more, session, stillMine]);

  // The runs under their months, in the list's order.
  const groups: { month: string; runs: RunSummary[] }[] = [];
  for (const run of listed.items) {
    const month = run.day.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.month === month) last.runs.push(run);
    else groups.push({ month, runs: [run] });
  }
  const total = listed.total;

  const hero = (
    <View>
      <PictureTop
        picture="runners"
        tall={0.62}
        title="Your runs"
        foot={
          <Txt kind="small" colour="textSoft">
            {total === null ? " " : total.runs === 0 ? "No runs yet" : runsWords(total.runs, total.distanceM, units)}
          </Txt>
        }
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Pick a day"
        onPress={() => {
          setPicking(true);
        }}
        style={[styles.calendar, { top: insets.top + 8 }]}
      >
        <Icon name="calendar" size={20} />
      </Pressable>
    </View>
  );

  return (
    <CoverPage open={open} title="Your runs" onClose={onClose} hero={hero} onNearEnd={() => void loadMore()}>
      {said === null ? null : (
        <Txt kind="small" colour="goodText">
          {said}
        </Txt>
      )}
      {upTo === null ? null : (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            {`Runs on ${dayWords(upTo)} and before`}
          </Txt>
          <Button label="Show newest" kind="link" onPress={() => { setUpTo(null); }} />
        </View>
      )}
      {view.waiting.map((r) => (
        <View key={r.runId} style={styles.waiting}>
          <View style={styles.waitingIcon}>
            <Icon name="cloud" size={18} colour="gold" />
          </View>
          <View style={styles.grow}>
            <Txt kind="strong">{r.name}</Txt>
            <Txt kind="small" colour="textSoft">
              Waiting to send. It goes when you're online.
            </Txt>
          </View>
        </View>
      ))}
      <RefusedRuns />
      {status === "loading" ? (
        <Txt kind="small">Loading your runs…</Txt>
      ) : status === "failed" ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            Your runs couldn't load.
          </Txt>
          <Button label="Try again" kind="link" say="Try your runs again" onPress={() => void first()} />
        </View>
      ) : listed.items.length === 0 ? (
        upTo === null ? (
          <View style={styles.empty}>
            <Txt kind="body">No runs yet. Your runs show here once you save one.</Txt>
            <Button label="Start a run" compact onPress={onStart} />
          </View>
        ) : (
          <Txt kind="body">{`No runs on ${dayWords(upTo)} or before.`}</Txt>
        )
      ) : (
        groups.map((g) => {
          const whole = listed.months.get(g.month);
          return (
            <View key={g.month} style={styles.group}>
              <View style={styles.monthRow}>
                <Txt style={styles.monthName}>{monthWords(g.month)}</Txt>
                {whole === undefined ? null : (
                  <Txt kind="small" colour="textFaint">
                    {runsWords(whole.runs, whole.distanceM, units)}
                  </Txt>
                )}
              </View>
              <View style={styles.box}>
                {g.runs.map((run, i) => (
                  <RunRow key={run.id} run={run} units={units} line={i > 0} onOpen={setOpened} />
                ))}
              </View>
            </View>
          );
        })
      )}
      {more === "failed" ? (
        <View style={styles.row}>
          <Txt kind="small" style={styles.grow}>
            More runs couldn't load.
          </Txt>
          <Button label="Try again" kind="link" say="Try more runs again" onPress={() => void loadMore()} />
        </View>
      ) : listed.next !== null && status === "ok" ? (
        <Button label={more === "loading" ? "Loading…" : "More runs"} kind="link" style={styles.centred} onPress={() => void loadMore()} />
      ) : null}
      <RunCalendar
        open={picking}
        start={upTo}
        units={units}
        onClose={() => {
          setPicking(false);
        }}
        onPick={(day) => {
          setPicking(false);
          setSaid(null);
          setStatus("loading");
          setUpTo(day);
        }}
      />
      <RunPage
        runId={opened}
        units={units}
        onClose={() => {
          setOpened(null);
        }}
        onChanged={() => {
          setChanged((n) => n + 1);
        }}
        onDeleted={(gone) => {
          // Taken out where it stood, its month and the total less it: the list stays where the person was.
          setListed((was) => {
            const run = was.items.find((r) => r.id === gone.id);
            if (run === undefined) return was;
            const months = new Map(was.months);
            const month = months.get(run.day.slice(0, 7));
            if (month !== undefined) months.set(month.month, { ...month, runs: Math.max(0, month.runs - 1), distanceM: Math.max(0, month.distanceM - run.distanceM) });
            const total = was.total === null ? null : { runs: Math.max(0, was.total.runs - 1), distanceM: Math.max(0, was.total.distanceM - run.distanceM) };
            return { ...was, items: was.items.filter((r) => r.id !== gone.id), months, total };
          });
          setSaid(`${gone.name} was deleted.`);
        }}
      />
    </CoverPage>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  centred: { alignSelf: "center" },
  calendar: {
    position: "absolute",
    right: 8,
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.round,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.veil,
    borderWidth: 1,
    borderColor: colours.lineStrong,
  },
  waiting: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 18, padding: 13, backgroundColor: colours.goldFill, borderWidth: 1, borderColor: colours.goldLine },
  waitingIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colours.goldFill },
  empty: { gap: 12, alignItems: "flex-start" },
  group: { gap: 8 },
  monthRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, paddingHorizontal: 4 },
  monthName: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, letterSpacing: 1.5, textTransform: "uppercase", color: colours.textSoft },
  box: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, paddingHorizontal: 14 },
});
