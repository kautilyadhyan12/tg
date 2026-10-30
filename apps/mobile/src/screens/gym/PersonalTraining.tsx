import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Modal } from "../../look/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  MEMBER_PT_WEEKS,
  PT_LATE_CANCEL_ERROR,
  memberPtResponseSchema,
  memberPtSessionResponseSchema,
  type GymClockFormat,
  type MemberPtResponse,
  type MemberPtSession,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { Chip } from "../../look/Chip";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NO_ANSWER } from "../SignIn";
import { newRequestKey, weekText } from "./classesView";
import {
  askedLate,
  bookedText,
  couldNotRead,
  emptyText,
  historyText,
  lateFee,
  ptBookAsk,
  ptCancelAsk,
  ptCancelledText,
  ptDay,
  ptDays,
  ptFeeText,
  ptZoneNote,
  sessionFeeLines,
  sessionText,
  type BookTime,
  type Pay,
} from "./ptView";

// A place's personal training for its member (spec Part 3 §13.5; ROADMAP Stage 5 item 16b): their own sessions
// with Cancel, the ones over or cancelled with what happened, and the trainers' free times a week at a time, a day
// at a time. The browser's screen (apps/web/src/components/gym/PersonalTraining.jsx), as a page over the Gym tab. A
// pressed time asks first, with what it uses and what a late cancel and a no-show cost. The server decides every
// one. Read when it opens, on a new week, after each answer and when the app comes back.

export interface PtPlace {
  id: string;
  name: string;
  orgType: string;
  clockFormat: GymClockFormat;
}

export const ptPath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/member-pt`;

const phoneZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

/** The page over the Gym tab; closed while `place` is null. */
export function PersonalTrainingPage({ place, onClose }: { place: PtPlace | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="pt-page" accessibilityViewIsModal style={[styles.page, { paddingTop: insets.top }]}>
        {place === null ? null : <PtBody key={place.id} place={place} onClose={onClose} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; view: MemberPtResponse };
type Said = { text: string; bad: boolean };
type Choosing = BookTime & { trainerId: string; sessionMinutes: number; pay: Pay | null };

function PtBody({ place, onClose, bottom }: { place: PtPlace; onClose: () => void; bottom: number }) {
  const { session } = useSession();
  const [week, setWeek] = useState(0);
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  // The day whose times are shown; null until one is pressed, and then the first with a time.
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  // The time pressed, waiting for the member's yes: nothing is booked by one press.
  const [choosing, setChoosing] = useState<Choosing | null>(null);
  // The session the box asks about, as it will be cancelled: its fee is the one the request says yes to.
  const [asking, setAsking] = useState<MemberPtSession | null>(null);
  // One key a time pressed: kept while its answer is unknown, until a read shows a session of theirs at that time that
  // was not there when the key was made, so a second press books once.
  const keys = useRef(new Map<string, { key: string; known: ReadonlySet<string> }>());
  // Reads are numbered as they start: an answer stands only if no later read has started.
  const started = useRef(0);
  const live = useRef(true);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: `${ptPath(place.id)}?week=${String(week)}` }, memberPtResponseSchema);
      if (!live.current || number !== started.current) return;
      if (answer.kind === "ok") {
        // A press is answered once a session of theirs, of any status, stands at its day and minute that was not there
        // when its key was made: a kept key outliving that would answer a session cancelled since. Any other key stays,
        // as its press may still be on its way: a new key for it would book a second session.
        const theirs = [...answer.data.sessions, ...answer.data.history];
        for (const [id, kept] of [...keys.current]) {
          const slot = id.slice(id.indexOf("|") + 1);
          if (theirs.some((s) => `${s.localDate}|${String(s.localStartMinute)}` === slot && !kept.known.has(s.id))) keys.current.delete(id);
        }
        setHeld({ kind: "ok", view: answer.data });
        // A read made by itself never takes the times away over a lost connection; a place that no longer shows them
        // (a 404) does.
      } else if (!quiet || (answer.kind === "refused" && answer.status === 404)) setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
    },
    [session, place.id, week],
  );

  // The read for the week on screen now: a press answered after Earlier or Later reads that week, not its own.
  const loadNow = useRef(load);
  useEffect(() => {
    loadNow.current = load;
  }, [load]);

  useEffect(() => {
    live.current = true;
    void load(false);
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") void load(true);
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [load]);

  // What happened is said at the top, over their sessions, where a new booking now is.
  const tell = (next: Said) => {
    setSaid(next);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };

  const book = async (c: Choosing) => {
    if (busy) return;
    const id = `${c.trainerId}|${c.localDate}|${String(c.minute)}`;
    const shown = held.kind === "ok" ? [...held.view.sessions, ...held.view.history] : [];
    const kept = keys.current.get(id) ?? { key: newRequestKey(), known: new Set(shown.map((s) => s.id)) };
    keys.current.set(id, kept);
    const key = kept.key;
    setBusy(true);
    setSaid(null);
    const answer = await session.signedIn(
      {
        method: "POST",
        path: `${ptPath(place.id)}/sessions`,
        body: { requestKey: key, trainerId: c.trainerId, localDate: c.localDate, startMinute: c.minute, minutes: c.sessionMinutes },
      },
      memberPtSessionResponseSchema,
    );
    if (!live.current) return;
    setBusy(false);
    setChoosing(null);
    if (answer.kind === "no_answer") {
      // No answer keeps its key: pressed again, the server books once.
      keys.current.set(id, kept);
      tell({ text: NO_ANSWER, bad: true });
      return;
    }
    keys.current.delete(id);
    tell(answer.kind === "ok" ? bookedText(answer.data.session, place.clockFormat) : { text: answer.message, bad: true });
    // The times are not as this page showed them: read them again.
    void loadNow.current(true);
  };

  const cancel = async (s: MemberPtSession) => {
    if (busy) return;
    const late = s.cancel === "late";
    setBusy(true);
    setSaid(null);
    // A late cancel says yes to the fee the box showed, so the server charges no other.
    const body = late ? { lateOk: true, feeMinor: lateFee(s) } : { lateOk: false };
    const answer = await session.signedIn(
      { method: "POST", path: `${ptPath(place.id)}/sessions/${encodeURIComponent(s.id)}/cancel`, body },
      memberPtSessionResponseSchema,
    );
    if (!live.current) return;
    setBusy(false);
    if (answer.kind === "refused" && answer.error === PT_LATE_CANCEL_ERROR) {
      // The free time ran out while the box was open, or the fee changed: asked again, with the fee the server
      // says it costs now.
      setAsking(askedLate(s, answer.body));
      // The page under the box says the same.
      void loadNow.current(true);
      return;
    }
    setAsking(null);
    if (answer.kind === "ok") tell({ text: ptCancelledText(answer.data.session), bad: false });
    else tell({ text: answer.kind === "refused" ? answer.message : NO_ANSWER, bad: true });
    void loadNow.current(true);
  };

  const go = (to: number) => {
    setHeld({ kind: "loading" });
    setPicked(null);
    setSaid(null);
    setWeek(to);
  };

  const view = held.kind === "ok" ? held.view : null;
  const row = view === null ? null : ptDays(view);
  const shown = row === null ? null : row.days.some((d) => d.localDate === picked) ? picked : row.first;
  const day = view === null || shown === null ? null : ptDay(view, shown, place.orgType, place.clockFormat, place.name);
  const shownLabel = row?.days.find((d) => d.localDate === shown)?.label ?? "";
  const empty = view === null ? null : emptyText(view, place.name, place.orgType);
  const note = view === null ? null : ptZoneNote(view.timezone, place.name, phoneZone(), new Date());
  const lastWeek = week === MEMBER_PT_WEEKS - 1 || (view !== null && view.to >= view.lastDay);
  const bookBox = choosing === null || view === null ? null : ptBookAsk(view, choosing, choosing.pay, place.clockFormat, Date.now(), place.name);
  const ask = asking === null || view === null ? null : ptCancelAsk(asking, view.timezone, place.clockFormat, place.name);

  return (
    <>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}>
          <Icon name="back" size={18} />
        </Pressable>
        <View style={styles.grow}>
          <Txt kind="h2">Personal training</Txt>
          <Txt kind="small" numberOfLines={1}>
            {place.name}
          </Txt>
        </View>
      </View>
      <ScrollView ref={scroll} style={styles.grow} contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}>
        {held.kind === "loading" ? (
          <Txt kind="small">Loading…</Txt>
        ) : held.kind === "failed" ? (
          <Card style={styles.box}>
            <Txt colour="badText">{couldNotRead(held.status, place.name)}</Txt>
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
          <>
            {said === null ? null : (
              <Txt colour={said.bad ? "badText" : "goodText"}>
                {said.text}
              </Txt>
            )}
            {held.view.sessions.length + held.view.history.length === 0 ? null : (
              <View style={styles.section}>
                <Txt kind="eyebrow" colour="textFaint">
                  Your sessions
                </Txt>
                {held.view.sessions.map((s) => (
                  <Card key={s.id} testID={`pt-session-${s.id}`} style={styles.box}>
                    <View style={styles.row}>
                      <View style={styles.stripe} />
                      <Txt kind="h3" style={styles.grow}>
                        {sessionText(s, place.clockFormat)}
                      </Txt>
                    </View>
                    {s.packCharged ? <Txt kind="small">1 session used from your pack</Txt> : null}
                    {sessionFeeLines(s, held.view.timezone, place.clockFormat, place.name).map((line) => (
                      <Txt key={line} kind="small">
                        {line}
                      </Txt>
                    ))}
                    {s.cancel === null ? null : (
                      <Button
                        label="Cancel session"
                        kind="plain"
                        small
                        wide
                        disabled={busy}
                        say={`Cancel session: ${sessionText(s, place.clockFormat)}`}
                        onPress={() => {
                          setAsking(s);
                        }}
                      />
                    )}
                  </Card>
                ))}
                {held.view.history.map((s) => {
                  const fee = ptFeeText(s);
                  return (
                    <Card key={s.id} testID={`pt-session-${s.id}`} style={styles.box}>
                      <Txt colour="textSoft">{sessionText(s, place.clockFormat)}</Txt>
                      <Txt kind="small">{historyText(s)}</Txt>
                      {fee === null ? null : (
                        <Txt kind="small" colour={s.fee?.state === "owed" ? "orange" : "textSoft"}>
                          {fee}
                        </Txt>
                      )}
                    </Card>
                  );
                })}
              </View>
            )}
            <View style={styles.weekRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Earlier"
                accessibilityState={{ disabled: week === 0 }}
                disabled={week === 0}
                onPress={() => {
                  go(week - 1);
                }}
                style={[styles.arrow, week === 0 ? styles.off : null]}
              >
                <Icon name="back" size={16} />
              </Pressable>
              <Txt kind="small" colour="text" style={styles.weekWords}>
                {week === 0 ? `Next 7 days · ${weekText(held.view)}` : weekText(held.view)}
              </Txt>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Later"
                accessibilityState={{ disabled: lastWeek }}
                disabled={lastWeek}
                onPress={() => {
                  go(week + 1);
                }}
                style={[styles.arrow, lastWeek ? styles.off : null]}
              >
                <Icon name="go" size={16} />
              </Pressable>
            </View>
            {empty !== null || day === null || row === null || shown === null ? (
              <Txt>{empty ?? ""}</Txt>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel="Pick a day">
                  {row.days.map((d) => (
                    <Chip
                      key={d.localDate}
                      label={d.label}
                      on={d.localDate === shown}
                      onPress={() => {
                        setPicked(d.localDate);
                      }}
                    />
                  ))}
                </ScrollView>
                {day.notOpen === null && day.pay !== null ? <Txt colour={day.pay.can ? "text" : "orange"}>{day.pay.text}</Txt> : null}
                {day.notOpen !== null ? (
                  <Txt kind="small">{day.notOpen}</Txt>
                ) : (
                  <Txt kind="small">{day.can ? "Available times. Press one to book it." : "Available times."}</Txt>
                )}
                {day.notOpen === null && day.fees !== null ? <Txt kind="small">{day.fees}</Txt> : null}
                {note === null ? null : (
                  <Txt kind="small" colour="orange">
                    {note}
                  </Txt>
                )}
                {(day.notOpen === null ? day.trainers : []).map((t) => (
                  <Card key={t.trainerId} testID={`pt-trainer-${t.trainerId}`} style={styles.box}>
                    <View>
                      <Txt kind="h3">{t.name}</Txt>
                      <Txt kind="small">{t.lengthText}</Txt>
                    </View>
                    {t.times.length === 0 ? (
                      <Txt kind="small">{t.later ?? "No available times on this day."}</Txt>
                    ) : (
                      <View style={styles.times}>
                        {t.times.map((time) =>
                          day.can ? (
                            <Button
                              key={time.minute}
                              label={time.text}
                              kind="soft"
                              small
                              disabled={busy}
                              say={`Book ${time.text} with ${t.name}, ${shownLabel}`}
                              onPress={() => {
                                setChoosing({
                                  trainerId: t.trainerId,
                                  trainerName: t.name,
                                  sessionMinutes: t.sessionMinutes,
                                  localDate: shown,
                                  dayLabel: shownLabel,
                                  minute: time.minute,
                                  timeText: time.text,
                                  pay: day.pay,
                                });
                              }}
                            />
                          ) : (
                            <View key={time.minute} style={styles.timeOff}>
                              <Txt kind="small">{time.text}</Txt>
                            </View>
                          ),
                        )}
                      </View>
                    )}
                    {t.times.length > 0 && t.later !== null ? <Txt kind="small">{t.later}</Txt> : null}
                  </Card>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
      <Sheet
        open={bookBox !== null}
        place="middle"
        title={bookBox?.title ?? ""}
        onClose={() => {
          if (!busy) setChoosing(null);
        }}
      >
        {bookBox === null || choosing === null ? null : (
          <View style={styles.ask}>
            {bookBox.lines.map((line) => (
              <Txt key={line} colour="text">
                {line}
              </Txt>
            ))}
            <Button label={bookBox.yes} wide busy={busy} onPress={() => void book(choosing)} />
            <Button
              label={bookBox.no}
              kind="quiet"
              style={styles.middle}
              disabled={busy}
              onPress={() => {
                setChoosing(null);
              }}
            />
          </View>
        )}
      </Sheet>
      <Sheet
        open={ask !== null}
        place="middle"
        title={ask?.title ?? ""}
        onClose={() => {
          if (!busy) setAsking(null);
        }}
      >
        {ask === null || asking === null ? null : (
          <View style={styles.ask}>
            {ask.lines.map((line) => (
              <Txt key={line} colour="text">
                {line}
              </Txt>
            ))}
            <Button label={ask.yes} kind="danger" wide busy={busy} onPress={() => void cancel(asking)} />
            <Button
              label={ask.no}
              kind="quiet"
              style={styles.middle}
              disabled={busy}
              onPress={() => {
                setAsking(null);
              }}
            />
          </View>
        )}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: sizes.edge, paddingTop: sizes.edge, paddingBottom: 8 },
  back: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  weekRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  arrow: {
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  off: { opacity: 0.35 },
  weekWords: { flex: 1, textAlign: "center" },
  list: { paddingHorizontal: sizes.edge, gap: sizes.gap },
  section: { gap: 10 },
  chips: { gap: 8, paddingVertical: 2 },
  box: { padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  stripe: { width: 4, alignSelf: "stretch", borderRadius: 999, backgroundColor: colours.orange },
  times: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeOff: {
    minHeight: sizes.press,
    paddingHorizontal: 14,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.line,
    justifyContent: "center",
  },
  ask: { gap: 12 },
  middle: { alignSelf: "center" },
});
