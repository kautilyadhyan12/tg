import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  CLASS_LATE_CANCEL_ERROR,
  MEMBER_CLASSES_WEEKS,
  classBookingResponseSchema,
  memberClassesResponseSchema,
  type ClassBookingView,
  type GymClockFormat,
  type MemberClassesResponse,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card, Pill } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NO_ANSWER } from "../SignIn";
import {
  MORE_CLASSES,
  actionsOf,
  askedLate,
  byDay,
  cancelAsk,
  cancelledText,
  couldNotRead,
  dayHeading,
  emptyWeek,
  bookAsk,
  feeLines,
  lateFee,
  mineText,
  newRequestKey,
  nextReadAt,
  onlineText,
  placesText,
  weekText,
  whenText,
  whyText,
  zoneNote,
  type Take,
} from "./classesView";

// A place's classes for its member (spec Part 3 §13.4 and §13.6; ROADMAP Stage 5 item 16a): the coming
// classes a week at a time, under their days, with Book, Join waitlist, Claim place and Cancel. The
// browser's screen (apps/web/src/components/gym/Classes.jsx), as a page over the Gym tab; what a late
// cancel and a no-show cost is said before Book, and Book asks first where any cancel would cost. The server
// decides every one; a class shows what the server last said about it. Read when it opens, on a new
// week, after each answer, when the app comes back, and when an online class's link is due or ends.

export interface ClassesPlace {
  id: string;
  name: string;
  clockFormat: GymClockFormat;
}

export const classesPath = (gymId: string, week: number) => `/v1/orgs/${encodeURIComponent(gymId)}/member-classes?week=${String(week)}`;
export const bookingPath = (gymId: string, sessionId: string) =>
  `/v1/orgs/${encodeURIComponent(gymId)}/class-sessions/${encodeURIComponent(sessionId)}/booking`;

const phoneZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

/** The page over the Gym tab; closed while `place` is null. */
export function ClassesPage({ place, onClose }: { place: ClassesPlace | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="classes-page" accessibilityViewIsModal style={[styles.page, { paddingTop: insets.top }]}>
        {place === null ? null : <ClassesBody key={place.id} place={place} onClose={onClose} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; list: MemberClassesResponse };
type Said = { text: string; bad: boolean };

function ClassesBody({ place, onClose, bottom }: { place: ClassesPlace; onClose: () => void; bottom: number }) {
  const { session } = useSession();
  const [week, setWeek] = useState(0);
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  // What the server last said about a class, by its id, over the list as it was read.
  const [said, setSaid] = useState<Record<string, Said | undefined>>({});
  // The class the box asks about, as it will be cancelled: its fee is the one the request says yes to.
  const [asking, setAsking] = useState<ClassBookingView | null>(null);
  // The class and the press that Book's own box asks about, before anything is sent.
  const [confirming, setConfirming] = useState<{ c: ClassBookingView; action: Take } | null>(null);
  // One key a tap: kept while its answer is unknown, so a second press books once.
  const keys = useRef(new Map<string, string>());
  // Reads are numbered as they start: an answer stands only if no later read has started.
  const started = useRef(0);
  const live = useRef(true);
  // When a read the page made by itself last failed; null once a read has answered.
  const [missedAt, setMissedAt] = useState<number | null>(null);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: classesPath(place.id, week) }, memberClassesResponseSchema);
      if (!live.current || number !== started.current) return;
      if (answer.kind === "ok") {
        // A class they hold needs no kept key: the press it was for has plainly been answered.
        for (const c of answer.data.classes) if (c.mine?.status === "booked" || c.mine?.status === "waitlisted") keys.current.delete(c.sessionId);
        setMissedAt(null);
        setHeld({ kind: "ok", list: answer.data });
      } else if (quiet) {
        // A read made by itself never takes the classes away; it is tried again.
        setMissedAt(Date.now());
      } else {
        setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
      }
    },
    [session, place.id, week],
  );

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

  // Read again when an online class's link is due, and when a class with a link ends.
  const list = held.kind === "ok" ? held.list : null;
  useEffect(() => {
    const at = missedAt !== null ? missedAt + 20_000 : nextReadAt(list?.classes ?? [], Date.now());
    if (at === null) return undefined;
    const timer = setTimeout(() => void load(true), Math.max(0, at - Date.now()));
    return () => {
      clearTimeout(timer);
    };
  }, [list, missedAt, load]);

  const put = (c: ClassBookingView) => {
    setHeld((h) => (h.kind !== "ok" ? h : { ...h, list: { ...h.list, classes: h.list.classes.map((x) => (x.sessionId === c.sessionId ? c : x)) } }));
  };
  const say = (sessionId: string, next: Said | undefined) => {
    setSaid((all) => ({ ...all, [sessionId]: next }));
  };

  const take = async (c: ClassBookingView, action: Take) => {
    if (busyId !== null) return;
    const key = keys.current.get(c.sessionId) ?? newRequestKey();
    keys.current.set(c.sessionId, key);
    setBusyId(c.sessionId);
    say(c.sessionId, undefined);
    const answer = await session.signedIn(
      { method: "POST", path: bookingPath(place.id, c.sessionId), body: { requestKey: key, joinWaitlist: action.joinWaitlist } },
      classBookingResponseSchema,
    );
    if (!live.current) return;
    setBusyId(null);
    if (answer.kind === "no_answer") {
      // No answer keeps its key: pressed again, the server books once.
      say(c.sessionId, { text: NO_ANSWER, bad: true });
      return;
    }
    keys.current.delete(c.sessionId);
    if (answer.kind === "ok") put(answer.data.booking);
    else say(c.sessionId, { text: answer.message, bad: true });
    // One booking changes what the others say (a week's bookings, a pack's last class).
    void load(true);
  };

  const give = async (c: ClassBookingView) => {
    if (busyId !== null) return;
    const late = c.can.cancel === "late";
    setBusyId(c.sessionId);
    say(c.sessionId, undefined);
    // A late cancel says yes to the fee the box showed, so the server charges no other.
    const body = late ? { lateOk: true, feeMinor: lateFee(c) } : { lateOk: false };
    const answer = await session.signedIn({ method: "POST", path: `${bookingPath(place.id, c.sessionId)}/cancel`, body }, classBookingResponseSchema);
    if (!live.current) return;
    setBusyId(null);
    if (answer.kind === "refused" && answer.error === CLASS_LATE_CANCEL_ERROR) {
      // The free time ran out while the box was open, or the fee changed: asked again, with the fee the
      // server says it costs now.
      setAsking(askedLate(c, answer.body));
      return;
    }
    setAsking(null);
    if (answer.kind === "ok") {
      put(answer.data.booking);
      say(c.sessionId, { text: cancelledText(answer.data.booking), bad: false });
    } else {
      say(c.sessionId, { text: answer.kind === "refused" ? answer.message : NO_ANSWER, bad: true });
    }
    void load(true);
  };

  const go = (to: number) => {
    setHeld({ kind: "loading" });
    setSaid({});
    setWeek(to);
  };

  const days = list === null ? [] : byDay(list.classes);
  const note = list === null ? null : zoneNote(list.classes, place.name, phoneZone());
  const ask = asking === null ? null : cancelAsk(asking, place.clockFormat);
  const bookBox = confirming === null ? null : bookAsk(confirming.c, confirming.action, place.clockFormat, Date.now());

  return (
    <>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}>
          <Icon name="back" size={18} />
        </Pressable>
        <View style={styles.grow}>
          <Txt kind="h2">Classes</Txt>
          <Txt kind="small" numberOfLines={1}>
            {place.name}
          </Txt>
        </View>
      </View>
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
          {list === null ? " " : week === 0 ? `Next 7 days · ${weekText(list)}` : weekText(list)}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Later"
          accessibilityState={{ disabled: week === MEMBER_CLASSES_WEEKS - 1 }}
          disabled={week === MEMBER_CLASSES_WEEKS - 1}
          onPress={() => {
            go(week + 1);
          }}
          style={[styles.arrow, week === MEMBER_CLASSES_WEEKS - 1 ? styles.off : null]}
        >
          <Icon name="go" size={16} />
        </Pressable>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}>
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
        ) : days.length === 0 ? (
          <Txt>{emptyWeek(week, place.name)}</Txt>
        ) : (
          <>
            {note === null ? null : (
              <Txt kind="small" colour="orange">
                {note}
              </Txt>
            )}
            {days.map((d) => (
              <View key={d.day} style={styles.day}>
                <Txt kind="eyebrow" colour="textFaint">
                  {dayHeading(d.day, week === 0 ? held.list.from : null)}
                </Txt>
                {d.classes.map((c) => (
                  <ClassBox
                    key={c.sessionId}
                    c={c}
                    clock={place.clockFormat}
                    busy={busyId === c.sessionId}
                    said={said[c.sessionId]}
                    onTake={(action) => {
                      if (bookAsk(c, action, place.clockFormat, Date.now()) === null) void take(c, action);
                      else setConfirming({ c, action });
                    }}
                    onGive={() => {
                      setAsking(c);
                    }}
                  />
                ))}
              </View>
            ))}
            {held.list.more ? (
              <Txt kind="small" colour="orange">
                {MORE_CLASSES}
              </Txt>
            ) : null}
          </>
        )}
      </ScrollView>
      <Sheet
        open={bookBox !== null}
        place="middle"
        title={bookBox?.title ?? ""}
        onClose={() => {
          setConfirming(null);
        }}
      >
        {bookBox === null || confirming === null ? null : (
          <View style={styles.ask}>
            {bookBox.lines.map((line) => (
              <Txt key={line} colour="text">
                {line}
              </Txt>
            ))}
            <Button
              label={bookBox.yes}
              wide
              onPress={() => {
                const { c, action } = confirming;
                setConfirming(null);
                void take(c, action);
              }}
            />
            <Button
              label={bookBox.no}
              kind="quiet"
              style={styles.middle}
              onPress={() => {
                setConfirming(null);
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
          if (busyId === null) setAsking(null);
        }}
      >
        {ask === null || asking === null ? null : (
          <View style={styles.ask}>
            {ask.lines.map((line) => (
              <Txt key={line} colour="text">
                {line}
              </Txt>
            ))}
            <Button label={ask.yes} kind="danger" wide busy={busyId !== null} onPress={() => void give(asking)} />
            <Button
              label={ask.no}
              kind="quiet"
              style={styles.middle}
              disabled={busyId !== null}
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

interface ClassBoxProps {
  c: ClassBookingView;
  clock: GymClockFormat;
  busy: boolean;
  said: Said | undefined;
  onTake: (action: Take) => void;
  onGive: () => void;
}

function ClassBox({ c, clock, busy, said, onTake, onGive }: ClassBoxProps) {
  const { take, give } = actionsOf(c);
  const mine = mineText(c, Date.now());
  const places = placesText(c);
  const why = whyText(c, clock);
  const fees = feeLines(c, clock, Date.now());
  const online = onlineText(c);
  const when = whenText(c, clock);
  return (
    <Card testID={`class-${c.sessionId}`} style={styles.box}>
      <View style={styles.row}>
        <View style={[styles.stripe, c.cancelled ? styles.stripeOff : null]} />
        <View style={styles.grow}>
          <Txt kind="h3" style={c.cancelled ? styles.struck : null}>
            {c.className}
          </Txt>
          <Txt kind="small">{places === null ? when : `${when} · ${places}`}</Txt>
        </View>
        {mine === null ? null : mine.tone === "good" ? <Pill label={mine.pill} tone="good" icon="check" /> : <Pill label={mine.pill} tone={mine.tone} />}
      </View>
      {mine?.line == null ? null : <Txt kind="small">{mine.line}</Txt>}
      {online === null ? null : (
        <Txt kind="small" colour={online.link === null ? "textSoft" : "goodText"}>
          {online.line}
        </Txt>
      )}
      {online?.link == null ? null : (
        <Button
          label="Join class"
          icon="play"
          small
          wide
          say={`Join class: ${c.className}, ${when}`}
          onPress={() => {
            if (online.link !== null) void Linking.openURL(online.link);
          }}
        />
      )}
      {why === null ? null : <Txt kind="small">{why}</Txt>}
      {said === undefined ? null : (
        <Txt kind="small" colour={said.bad ? "badText" : "goodText"}>
          {said.text}
        </Txt>
      )}
      {take === null ? null : (
        <Button
          label={take.label}
          kind={take.kind === "waitlist" ? "soft" : "main"}
          small
          wide
          busy={busy}
          say={`${take.label}: ${c.className}, ${when}`}
          onPress={() => {
            onTake(take);
          }}
        />
      )}
      {give === null ? null : (
        <Button label={give.label} kind="plain" small wide disabled={busy} say={`${give.label}: ${c.className}, ${when}`} onPress={onGive} />
      )}
      {fees.map((line) => (
        <Txt key={line} kind="small">
          {line}
        </Txt>
      ))}
    </Card>
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
  weekRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: sizes.edge, paddingBottom: 8 },
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
  day: { gap: 10 },
  box: { padding: 16, gap: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  stripe: { width: 4, alignSelf: "stretch", borderRadius: 999, backgroundColor: colours.orange },
  stripeOff: { backgroundColor: colours.textFaint },
  struck: { textDecorationLine: "line-through", opacity: 0.6 },
  ask: { gap: 12 },
  middle: { alignSelf: "center" },
});
