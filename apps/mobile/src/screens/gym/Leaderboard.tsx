import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  leaderboardCountedResponseSchema,
  leaderboardResponseSchema,
  leaderboardVisibilitySchema,
  userProfileResponseSchema,
  type GymClockFormat,
  type LeaderboardBoard,
  type LeaderboardCircle,
  type LeaderboardCountedResponse,
  type LeaderboardPeriod,
  type LeaderboardResponse,
  type LeaderboardRow,
  type LeaderboardVisibility,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import { Options } from "../../look/Choice";
import { colours, sizes } from "../../look/colours";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { PictureTop } from "../../look/PictureTop";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NO_ANSWER } from "../SignIn";
import { shortDay } from "./classesView";
import {
  PERIODS,
  boardInstead,
  boardTabs,
  datesLine,
  flameLabel,
  flamesLine,
  hiddenText,
  nextPlaceText,
  notCountedText,
  ordinal,
  statusText,
  valueText,
  visitText,
  weekLine,
  weekdayInitial,
  whatCounts,
  workoutNotCountedText,
  workoutText,
} from "./leaderboardView";

// A place's leaderboard for its member (spec Part 3 §15.5; ROADMAP Stage 5 item 17c-ii-a): three boards, each ranking one
// fact the desk, staff or the app recorded. The server takes hidden people out before it gives places, and says what
// Hide me is: the switch only ever shows its last answer. Read on opening and when the app comes back, with no timer,
// as a full gym on one wi-fi would use up the read limit.

export interface LeaderboardPlace {
  id: string;
  name: string;
  clockFormat: GymClockFormat;
}

const boardBase = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/leaderboard`;
export const leaderboardPath = (gymId: string, board: LeaderboardBoard, period: LeaderboardPeriod) => `${boardBase(gymId)}?board=${board}&period=${period}`;
const countedPath = (gymId: string, board: LeaderboardBoard, period: LeaderboardPeriod) => `${boardBase(gymId)}/mine?board=${board}&period=${period}`;
export const HIDE_ME_PATH = "/v1/users/me/leaderboard";

/** The page over the Gym tab or the Dashboard; closed while `place` is null. */
export function LeaderboardPage({ place, onClose }: { place: LeaderboardPlace | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="leaderboard-page" accessibilityViewIsModal style={styles.page}>
        {place === null ? null : <Body key={place.id} place={place} onClose={onClose} top={insets.top} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; board: LeaderboardResponse };
type Hide = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; now: LeaderboardVisibility };

function Body({ place, onClose, top, bottom }: { place: LeaderboardPlace; onClose: () => void; top: number; bottom: number }) {
  const { session } = useSession();
  const [boardId, setBoardId] = useState<LeaderboardBoard>("gym_days");
  const [period, setPeriod] = useState<LeaderboardPeriod>("this_week");
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [hide, setHide] = useState<Hide>({ kind: "loading" });
  const [hideBusy, setHideBusy] = useState(false);
  const [hideSaid, setHideSaid] = useState<string | null>(null);
  const [box, setBox] = useState<"info" | "period" | "counted" | "name" | null>(null);
  // The person has picked a tab: a gym that checks nobody in no longer moves them off Visits.
  const picked = useRef(false);
  // Reads are numbered as they start: an answer stands only if no later read has started, so a slow answer to an
  // earlier tab is never drawn under a later one.
  const started = useRef(0);
  const hideStarted = useRef(0);
  const live = useRef(true);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: leaderboardPath(place.id, boardId, period) }, leaderboardResponseSchema);
      if (!live.current || number !== started.current) return;
      if (answer.kind === "ok" && answer.data.gymId === place.id && answer.data.board === boardId) {
        const instead = boardInstead(answer.data, picked.current);
        if (instead !== null && instead !== boardId) {
          if (answer.data.status === "no_checkins") picked.current = true;
          setBoardId(instead);
          return;
        }
        setHeld({ kind: "ok", board: answer.data });
      } else if (!quiet || (answer.kind === "refused" && answer.status === 404)) {
        // A read made by itself never takes the board away over a lost connection; a 404 does.
        setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
      }
    },
    [session, place.id, boardId, period],
  );

  const loadHide = useCallback(async () => {
    hideStarted.current += 1;
    const number = hideStarted.current;
    const answer = await session.signedIn({ method: "GET", path: HIDE_ME_PATH }, leaderboardVisibilitySchema);
    if (!live.current || number !== hideStarted.current) return;
    if (answer.kind === "ok") setHide({ kind: "ok", now: answer.data });
    else setHide((was) => (was.kind === "ok" ? was : { kind: "failed" }));
  }, [session]);

  useEffect(() => {
    live.current = true;
    setHeld({ kind: "loading" });
    void load(false);
    const back = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void load(true);
      void loadHide();
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [load, loadHide]);

  useEffect(() => {
    void loadHide();
  }, [loadHide]);

  const setHidden = async (hidden: boolean) => {
    if (hideBusy) return;
    setHideBusy(true);
    setHideSaid(null);
    // A read that started before this press may not hold what the press does.
    hideStarted.current += 1;
    const answer = await session.signedIn({ method: "PUT", path: HIDE_ME_PATH, body: { hidden } }, leaderboardVisibilitySchema);
    if (!live.current) return;
    setHideBusy(false);
    if (answer.kind === "ok") {
      setHide({ kind: "ok", now: answer.data });
    } else {
      setHideSaid(answer.kind === "refused" ? answer.message : NO_ANSWER);
      // The save may have reached the server: the switch shows what the server holds.
      void loadHide();
    }
    void load(true);
  };

  const board = held.kind === "ok" ? held.board : null;
  const noBoard = board === null ? null : statusText(board);
  const tabs = boardTabs(board === null ? [] : board.boardsOff);
  const showMe = board !== null && board.status !== "no_checkins" && board.status !== "paused" && board.status !== "switched_off";
  const flames = board === null ? null : flamesLine(board.board, board.period);
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? "";
  const closeBox = () => {
    setBox(null);
  };

  const header = (
    <View>
      <PictureTop picture="rank" tall={0.6} eyebrow={place.name} title="Leaderboard" />
      <View style={styles.controls}>
        <View style={styles.tabs}>
          {tabs.map((t) => (
            <Chip
              key={t.id}
              label={t.label}
              on={boardId === t.id}
              onPress={() => {
                picked.current = true;
                setBoardId(t.id);
              }}
            />
          ))}
        </View>
        <View style={styles.between}>
          {boardId === "streak" || tabs.length === 0 ? (
            <View />
          ) : (
            <Button
              label={periodLabel}
              kind="link"
              icon="calendar"
              say={`Period: ${periodLabel}. Change`}
              onPress={() => {
                setBox("period");
              }}
            />
          )}
          <Button
            label="What counts"
            kind="quiet"
            say="What this board counts"
            onPress={() => {
              setBox("info");
            }}
          />
        </View>
        <HideMe
          hide={hide}
          busy={hideBusy}
          said={hideSaid}
          onChange={(hidden) => void setHidden(hidden)}
          onAgain={() => void loadHide()}
        />
        {board === null ? null : <Txt kind="tiny">{datesLine(board)}</Txt>}
        {flames === null || noBoard !== null ? null : <Txt kind="tiny">{flames}</Txt>}
      </View>
    </View>
  );

  const empty =
    held.kind === "loading" ? (
      <Txt kind="small">Loading…</Txt>
    ) : held.kind === "failed" ? (
      <Card style={styles.box}>
        <Txt colour="badText">{held.status === 404 ? "This leaderboard isn’t available." : "Couldn’t load the leaderboard."}</Txt>
        <Button
          label="Try again"
          kind="soft"
          small
          onPress={() => {
            setHeld({ kind: "loading" });
            void load(false);
          }}
        />
      </Card>
    ) : (
      <Txt colour="text">{noBoard}</Txt>
    );

  return (
    <>
      <FlatList
        style={styles.grow}
        contentContainerStyle={styles.list}
        data={board === null || noBoard !== null ? [] : board.rows}
        keyExtractor={(r) => r.userId}
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={styles.edge}>{empty}</View>}
        renderItem={({ item }) => (
          <Row
            row={item}
            days={board?.circleDays ?? null}
            boardId={boardId}
            onMine={() => {
              setBox("counted");
            }}
          />
        )}
      />
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={[styles.back, { top: top + 12 }]}>
        <Icon name="back" size={18} />
      </Pressable>
      {!showMe ? null : (
        <View style={[styles.mine, { paddingBottom: bottom + 10 }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`You: ${valueText(board.me.value, board.board)}. See what counted.`}
            onPress={() => {
              setBox("counted");
            }}
            style={[styles.mineRow, board.me.hidden === null ? null : styles.faded]}
          >
            <Txt kind="h3" colour="textSoft" style={styles.place}>
              {board.me.place === null ? "–" : ordinal(board.me.place)}
            </Txt>
            <View style={styles.grow}>
              <Txt kind="h3">You</Txt>
              <Txt kind="small" colour="orange">
                What counted
              </Txt>
            </View>
            <Txt kind="h3" style={styles.value}>
              {String(board.me.value)}
            </Txt>
          </Pressable>
          {board.me.hidden !== null ? <Txt kind="small">{hiddenText(board.me.hidden, board.gymName)}</Txt> : null}
          {board.me.hidden === "no_name" ? (
            <Button
              label="Add your name"
              kind="link"
              style={styles.start}
              onPress={() => {
                setBox("name");
              }}
            />
          ) : null}
          {board.me.hidden === null && nextPlaceText(board.me, board.board) !== null ? <Txt kind="small">{nextPlaceText(board.me, board.board)}</Txt> : null}
          {board.me.hidden === null && board.me.place !== null && !board.rows.some((r) => r.isMe) ? <Txt kind="small">Members see the top 100. Your place is here.</Txt> : null}
        </View>
      )}

      <Sheet open={box === "info"} title="What this board counts" onClose={closeBox}>
        <View style={styles.lines}>
          {whatCounts(boardId, place.name).map((line) => (
            <Txt key={line} colour="text">
              {line}
            </Txt>
          ))}
        </View>
      </Sheet>
      <Sheet open={box === "period"} title="Period" onClose={closeBox}>
        <Options
          options={PERIODS}
          selected={period}
          solid
          onPick={(value) => {
            setPeriod(value);
            closeBox();
          }}
        />
      </Sheet>
      <Sheet open={box === "counted"} title="What counted" onClose={closeBox}>
        {box === "counted" ? <Counted place={place} boardId={boardId} period={period} /> : null}
      </Sheet>
      <Sheet open={box === "name"} title="Your full name" onClose={closeBox}>
        {box === "name" ? (
          <NameBox
            onSaved={() => {
              closeBox();
              void load(true);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

interface HideMeProps {
  hide: Hide;
  busy: boolean;
  said: string | null;
  onChange: (hidden: boolean) => void;
  onAgain: () => void;
}

/** Drawn only from the server's answer: not known, there is no switch to read wrongly. */
function HideMe({ hide, busy, said, onChange, onAgain }: HideMeProps) {
  if (hide.kind === "loading") return null;
  if (hide.kind === "failed") {
    return (
      <View style={styles.between}>
        <Txt kind="small" style={styles.grow}>
          Couldn’t load Hide me.
        </Txt>
        <Button label="Try again" kind="link" say="Try Hide me again" onPress={onAgain} />
      </View>
    );
  }
  const { now } = hide;
  return (
    <View style={styles.hide}>
      <View style={styles.between}>
        <View style={styles.grow}>
          <Txt kind="h3">Hide me</Txt>
          <Txt kind="small">{now.under18 && now.hidden ? "You’re under 18, so you’re hidden until you switch this off." : "Only staff will see you on the boards."}</Txt>
        </View>
        <Switch
          accessibilityLabel="Hide me on leaderboards"
          value={now.hidden}
          disabled={busy}
          onValueChange={onChange}
          trackColor={{ false: colours.lineStrong, true: colours.orange }}
          thumbColor={colours.text}
        />
      </View>
      {said === null ? null : (
        <Txt kind="small" colour="badText">
          {said}
        </Txt>
      )}
    </View>
  );
}

function Flames({ circles, days, boardId }: { circles: readonly LeaderboardCircle[] | null; days: readonly string[]; boardId: LeaderboardBoard }) {
  if (circles === null) return null;
  return (
    <View style={styles.flames}>
      {circles.map((c, i) => {
        const day = days[i] ?? String(i);
        return (
          <View
            key={day}
            accessible
            accessibilityRole="image"
            accessibilityLabel={flameLabel(c, day, boardId)}
            style={[styles.flame, c === "yes" ? styles.lit : null, c === "open" ? styles.open : null, c === "skipped" ? styles.skipped : null]}
          >
            <Icon name="flame" size={14} colour={c === "yes" || c === "open" ? "orange" : "textFaint"} filled={c === "yes"} />
            {boardId === "streak" ? null : (
              <Txt kind="tiny">
                {weekdayInitial(day)}
              </Txt>
            )}
          </View>
        );
      })}
    </View>
  );
}

function Row({ row, days, boardId, onMine }: { row: LeaderboardRow; days: readonly string[] | null; boardId: LeaderboardBoard; onMine: () => void }) {
  const inside = (
    <>
      <Txt kind="h3" colour={row.place <= 3 ? "orange" : "textSoft"} style={styles.place}>
        {ordinal(row.place)}
      </Txt>
      <View style={styles.initials}>
        <Txt kind="small" colour="orange" numberOfLines={1}>
          {row.initials}
        </Txt>
      </View>
      <View style={styles.grow}>
        <Txt kind="h3" numberOfLines={1}>
          {row.name}
        </Txt>
        {days === null ? null : <Flames circles={row.circles} days={days} boardId={boardId} />}
      </View>
      <Txt kind="h3" style={styles.value}>
        {String(row.value)}
      </Txt>
    </>
  );
  if (!row.isMe) {
    return (
      <View testID={`row-${row.userId}`} style={styles.rowBox}>
        {inside}
      </View>
    );
  }
  return (
    <Pressable testID={`row-${row.userId}`} accessibilityRole="button" accessibilityLabel={`${ordinal(row.place)}, you. See what counted.`} onPress={onMine} style={[styles.rowBox, styles.rowMine]}>
      {inside}
    </Pressable>
  );
}

function Counted({ place, boardId, period }: { place: LeaderboardPlace; boardId: LeaderboardBoard; period: LeaderboardPeriod }) {
  const { session } = useSession();
  const [held, setHeld] = useState<{ kind: "loading" } | { kind: "failed" } | { kind: "ok"; data: LeaderboardCountedResponse }>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let live = true;
    void session.signedIn({ method: "GET", path: countedPath(place.id, boardId, period) }, leaderboardCountedResponseSchema).then((answer) => {
      if (live) setHeld(answer.kind === "ok" ? { kind: "ok", data: answer.data } : { kind: "failed" });
    });
    return () => {
      live = false;
    };
  }, [session, place.id, boardId, period, round]);

  if (held.kind === "loading") return <Txt kind="small">Loading…</Txt>;
  if (held.kind === "failed") {
    return (
      <View style={styles.lines}>
        <Txt colour="badText">Couldn’t load what counted.</Txt>
        <Button
          label="Try again"
          kind="soft"
          small
          onPress={() => {
            setHeld({ kind: "loading" });
            setRound((n) => n + 1);
          }}
        />
      </View>
    );
  }
  const { data } = held;
  const clock = place.clockFormat;
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.lines}>
      <Txt kind="h3">{valueText(data.value, boardId)}</Txt>
      {boardId === "gym_days" ? (
        <>
          {data.days.length === 0 ? <Txt kind="small">No visits in this period yet.</Txt> : null}
          {data.days.map((d) => (
            <Card key={d.day} style={styles.dayBox}>
              <Txt colour="text">{shortDay(d.day)}</Txt>
              {d.visits.map((v) => (
                <Txt key={`${v.at}${v.how}`} kind="small">
                  {visitText(v, data.timezone, clock)}
                </Txt>
              ))}
            </Card>
          ))}
          {data.notCounted.length === 0 ? null : <Txt kind="eyebrow">Didn’t count</Txt>}
          {data.notCounted.map((n) => (
            <Txt key={n.at} kind="small">
              {`${shortDay(n.day)} · ${notCountedText(n)}`}
            </Txt>
          ))}
        </>
      ) : boardId === "workout_days" ? (
        <>
          {data.workoutDays.length === 0 ? <Txt kind="small">No workout days in this period yet.</Txt> : null}
          {data.workoutDays.map((d) => (
            <Card key={d.day} style={styles.dayBox}>
              <Txt colour="text">{shortDay(d.day)}</Txt>
              {d.workouts.map((w, i) => (
                <Txt key={`${w.at}${String(i)}`} kind="small">
                  {workoutText(w, data.timezone, clock)}
                </Txt>
              ))}
            </Card>
          ))}
          {data.workoutsNotCounted.length === 0 ? null : <Txt kind="eyebrow">Didn’t count</Txt>}
          {data.workoutsNotCounted.map((n, i) => (
            <Txt key={`${n.at}${String(i)}`} kind="small">
              {`${shortDay(n.day)} · ${workoutNotCountedText(n, data.gymName)}`}
            </Txt>
          ))}
        </>
      ) : (
        data.weeks.map((w) => {
          const line = weekLine(w, data.gymName);
          return (
            <View key={w.weekStart}>
              <Txt colour="text">{line.label}</Txt>
              <Txt kind="small" colour={w.state === "counted" ? "orange" : "textSoft"}>
                {line.text}
              </Txt>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

function NameBox({ onSaved }: { onSaved: () => void }) {
  const { session } = useSession();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const save = async () => {
    const displayName = name.trim();
    if (displayName === "" || busy) return;
    setBusy(true);
    setSaid(null);
    const answer = await session.signedIn({ method: "PATCH", path: "/v1/users/me", body: { displayName } }, userProfileResponseSchema);
    setBusy(false);
    if (answer.kind === "ok") {
      await session.keepName(answer.data.user.displayName);
      onSaved();
    } else {
      setSaid(answer.kind === "refused" ? answer.message : NO_ANSWER);
    }
  };
  return (
    <View style={styles.lines}>
      <Field label="Your full name" value={name} onChange={setName} name ready maxLength={100} onDone={() => void save()} />
      {said === null ? null : (
        <Txt kind="small" colour="badText">
          {said}
        </Txt>
      )}
      <Button label="Save" wide busy={busy} disabled={name.trim() === ""} onPress={() => void save()} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  grow: { flex: 1 },
  list: { gap: 6, paddingBottom: 16 },
  edge: { paddingHorizontal: sizes.edge, paddingTop: 8 },
  back: {
    position: "absolute",
    left: sizes.edge,
    width: sizes.press,
    height: sizes.press,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.box,
    alignItems: "center",
    justifyContent: "center",
  },
  controls: { paddingHorizontal: sizes.edge, paddingTop: 12, paddingBottom: 8, gap: 10 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  start: { alignSelf: "flex-start" },
  hide: { gap: 6 },
  box: { padding: 16, gap: 10 },
  rowBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: sizes.press,
    marginHorizontal: sizes.edge - 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 14,
  },
  rowMine: { backgroundColor: colours.orangeFill },
  place: { minWidth: 40, textAlign: "right" },
  value: { minWidth: 28, textAlign: "right" },
  initials: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.orangeFill,
    borderWidth: 1,
    borderColor: colours.orangeLine,
  },
  flames: { flexDirection: "row", flexWrap: "wrap", gap: 3, marginTop: 2 },
  flame: { alignItems: "center", width: 16 },
  lit: { filter: [{ dropShadow: { offsetX: 0, offsetY: 0, standardDeviation: 3, color: colours.orange } }] },
  open: { opacity: 0.45 },
  skipped: { opacity: 0.4 },
  mine: { borderTopWidth: 1, borderTopColor: colours.lineStrong, backgroundColor: colours.box, paddingHorizontal: sizes.edge - 8, paddingTop: 10, gap: 4 },
  mineRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: sizes.press },
  faded: { opacity: 0.6 },
  lines: { gap: 10 },
  scroll: { flexShrink: 1 },
  dayBox: { padding: 12, gap: 4 },
});
