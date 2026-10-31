import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, FlatList, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { Modal } from "../../look/Modal";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { gymEventsResponseSchema, memberGymEventResponseSchema, type GymClockFormat, type GymEventsResponse, type MemberGymEvent } from "@app/shared";
import { Button } from "../../look/Button";
import { Card, Pill } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { posterHeight } from "../../look/sizing";
import { Sheet } from "../../look/Sheet";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NO_ANSWER } from "../SignIn";
import { CopyContext } from "../ThisCopy";
import { newRequestKey } from "./classesView";
import {
  EARLIER_BOOKING_GONE,
  EVENTS_NOT_READ,
  EVENTS_NOT_SHOWN,
  NO_EVENTS,
  eventActions,
  eventIsOn,
  eventMine,
  eventPlacesLeft,
  eventWhen,
  eventWhyNot,
  eventsZoneNote,
  givingUpAsks,
  givingUpLine,
  nextEventChangeAt,
  waitlistNote,
  type EventAct,
} from "./eventsView";
import { photoFiles, type PhotoFiles } from "./photoFiles";
import { SignedPhoto } from "./Updates";

// A place's events for its member (spec Part 3 §15.4; ROADMAP Stage 5 item 17c-i): every event that has not ended,
// soonest first, with its poster, booking and the waitlist. A page over the Gym tab, read when it opens and when the
// app comes back. The server decides every place; "You're booked" is only ever what its last answer said.

export interface EventsPlace {
  id: string;
  name: string;
  clockFormat: GymClockFormat;
}

export const eventsPath = (gymId: string) => `/v1/orgs/${encodeURIComponent(gymId)}/events`;
const comingPath = (gymId: string, eventId: string) => `${eventsPath(gymId)}/${encodeURIComponent(eventId)}/coming`;
const posterPath = (gymId: string, eventId: string, posterId: string) => `${eventsPath(gymId)}/${encodeURIComponent(eventId)}/poster/${encodeURIComponent(posterId)}`;

/** Posters are read only for events near the screen: a gym may list 100, at most 1 MB each. */
export const NEAR_THE_SCREEN = 5;
const READ_AGAIN_AFTER_MISSED_MS = 20_000;
/** While the member is on a waitlist the page is told to be checked: every 30 seconds, for at most 15 minutes. */
const WAITLIST_READ_MS = 30_000;
const WAITING_FOR_AT_MOST_MS = 15 * 60_000;
/** The longest a timer for the next start or end is set for. */
const LONGEST_TIMER_MS = 60 * 60_000;

const phoneZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
};

/** The page over the Gym tab; closed while `place` is null. */
export function EventsPage({ place, onClose }: { place: EventsPlace | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="events-page" accessibilityViewIsModal style={[styles.page, { paddingTop: insets.top }]}>
        {place === null ? null : <EventsBody key={place.id} place={place} onClose={onClose} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; list: GymEventsResponse; readAt: number };

function EventsBody({ place, onClose, bottom }: { place: EventsPlace; onClose: () => void; bottom: number }) {
  const { session } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyKind, setBusyKind] = useState<EventAct | null>(null);
  // What the server last refused or could not answer, by event, until the next press on it.
  const [said, setSaid] = useState<Record<string, string | undefined>>({});
  const [asking, setAsking] = useState<MemberGymEvent | null>(null);
  // One key an event: kept while a press's answer is unknown, so a second press takes one place.
  const keys = useRef(new Map<string, string>());
  // Reads are numbered as they start: an answer stands only if no later read or press has started.
  const started = useRef(0);
  const live = useRef(true);
  const [missedAt, setMissedAt] = useState<number | null>(null);
  // When reads made by themselves began to fail: they stop trying after 15 minutes, until the app comes back.
  const firstMissed = useRef<number | null>(null);
  const [files] = useState<PhotoFiles>(() => photoFiles(session));
  const [photoRound, setPhotoRound] = useState(0);
  useEffect(
    () => () => {
      files.clear();
    },
    [files],
  );

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: eventsPath(place.id) }, gymEventsResponseSchema);
      if (!live.current) return;
      if (number !== started.current) {
        // A press took this read's place: a retry that was due goes on being due.
        setMissedAt((was) => (was === null ? null : Date.now()));
        return;
      }
      setPhotoRound((round) => round + 1);
      // Another place's events are never shown under this one.
      if (answer.kind === "ok" && answer.data.gymId === place.id) {
        // An event with a place of theirs needs no kept key: its press has plainly been answered.
        for (const e of answer.data.events) if (e.going.mine !== null) keys.current.delete(e.id);
        firstMissed.current = null;
        setMissedAt(null);
        setHeld({ kind: "ok", list: answer.data, readAt: Date.now() });
      } else if (quiet && !(answer.kind === "refused" && answer.status === 404)) {
        // A read made by itself never takes the events away over a lost connection; a 404 does.
        const nowMs = Date.now();
        firstMissed.current ??= nowMs;
        setMissedAt(nowMs - firstMissed.current < WAITING_FOR_AT_MOST_MS ? nowMs : null);
      } else {
        setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
      }
    },
    [session, place.id],
  );

  useEffect(() => {
    live.current = true;
    void load(false);
    const back = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      firstMissed.current = null;
      void load(true);
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [load]);

  useEffect(() => {
    if (missedAt === null) return undefined;
    const timer = setTimeout(() => void load(true), READ_AGAIN_AFTER_MISSED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [missedAt, load]);

  const say = (eventId: string, text: string | undefined) => {
    setSaid((all) => ({ ...all, [eventId]: text }));
  };

  const press = async (event: MemberGymEvent, kind: EventAct) => {
    if (busyId !== null) return;
    setBusyId(event.id);
    setBusyKind(kind);
    setAsking(null);
    say(event.id, undefined);
    // A read that started before this press no longer stands: it may not hold what the press does.
    started.current += 1;
    let key: string | null = null;
    if (kind !== "cancel") {
      key = keys.current.get(event.id) ?? newRequestKey();
      keys.current.set(event.id, key);
    }
    const answer = await session.signedIn(
      key === null
        ? { method: "DELETE", path: comingPath(place.id, event.id) }
        : { method: "POST", path: comingPath(place.id, event.id), body: { requestKey: key, joinWaitlist: kind === "wait" } },
      memberGymEventResponseSchema,
    );
    if (!live.current) return;
    setBusyId(null);
    setBusyKind(null);
    if (answer.kind === "no_answer") {
      // No answer keeps its key: pressed again, the server takes one place.
      say(event.id, NO_ANSWER);
      return;
    }
    keys.current.delete(event.id);
    if (answer.kind === "ok") {
      const now = answer.data.event;
      // A key from a press whose place was given up since is answered with no place.
      if (key !== null && now.going.mine === null) say(event.id, EARLIER_BOOKING_GONE);
      started.current += 1;
      setHeld((h) => (h.kind !== "ok" ? h : { ...h, list: { ...h.list, events: h.list.events.map((e) => (e.id === now.id ? now : e)) } }));
      return;
    }
    say(event.id, answer.message);
    // The event is not as this card showed it.
    void load(true);
  };

  const list = held.kind === "ok" ? held.list : null;
  const note = list === null ? null : eventsZoneNote(list.events, place.name, list.timezone, phoneZone());
  const onWaitlist = list?.events.some((e) => e.going.mine?.status === "waitlisted" && !e.cancelled) ?? false;

  // Told to check back, they need not leave and return: read on while waiting on a place.
  useEffect(() => {
    if (!onWaitlist) return undefined;
    const since = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - since >= WAITING_FOR_AT_MOST_MS) clearInterval(timer);
      else void load(true);
    }, WAITLIST_READ_MS);
    return () => {
      clearInterval(timer);
    };
  }, [onWaitlist, load]);

  // On now, Booking has closed and the list itself change when an event starts or ends.
  useEffect(() => {
    if (list === null) return undefined;
    const nowMs = Date.now();
    const at = nextEventChangeAt(list.events, nowMs);
    if (at === null) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const wait = () => {
      const left = at - Date.now() + 1000;
      // Only the start or end itself is worth a read; a long wait is only cut into pieces.
      timer = left > LONGEST_TIMER_MS ? setTimeout(wait, LONGEST_TIMER_MS) : setTimeout(() => void load(true), left);
    };
    wait();
    return () => {
      clearTimeout(timer);
    };
  }, [list, load]);

  const empty =
    held.kind === "loading" ? (
      <Txt kind="small">Loading…</Txt>
    ) : held.kind === "failed" ? (
      <Card style={styles.box}>
        <Txt colour="badText">{held.status === 404 ? EVENTS_NOT_SHOWN : EVENTS_NOT_READ}</Txt>
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
      <Txt>{list?.status === "paused" ? EVENTS_NOT_SHOWN : NO_EVENTS}</Txt>
    );

  return (
    <>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}>
          <Icon name="back" size={18} />
        </Pressable>
        <View style={styles.grow}>
          <Txt kind="h2">Events</Txt>
          <Txt kind="small" numberOfLines={1}>
            {place.name}
          </Txt>
        </View>
      </View>
      <FlatList
        style={styles.grow}
        contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}
        data={list === null || list.status === "paused" ? [] : list.events}
        keyExtractor={(e) => e.id}
        initialNumToRender={NEAR_THE_SCREEN}
        maxToRenderPerBatch={NEAR_THE_SCREEN}
        windowSize={NEAR_THE_SCREEN}
        ListEmptyComponent={empty}
        ListHeaderComponent={
          note === null ? null : (
            <Txt kind="small" colour="orange">
              {note}
            </Txt>
          )
        }
        renderItem={({ item }) => (
          <EventBox
            event={item}
            today={list?.today ?? ""}
            readAt={held.kind === "ok" ? held.readAt : 0}
            clock={place.clockFormat}
            posterUrl={(posterId) => `${apiUrl}${posterPath(place.id, item.id, posterId)}`}
            files={files}
            photoRound={photoRound}
            busyKind={busyId === item.id ? busyKind : null}
            blocked={busyId !== null && busyId !== item.id}
            said={said[item.id]}
            onPress={(kind) => {
              if (kind === "cancel" && givingUpAsks(item)) setAsking(item);
              else void press(item, kind);
            }}
          />
        )}
      />
      <Sheet
        open={asking !== null}
        place="middle"
        title="Cancel your booking?"
        onClose={() => {
          setAsking(null);
        }}
      >
        {asking === null ? null : (
          <View style={styles.ask}>
            <Txt colour="text">{asking.name}</Txt>
            <Txt colour="text">{givingUpLine(asking)}</Txt>
            <Button label="Cancel booking" kind="danger" wide onPress={() => void press(asking, "cancel")} />
            <Button
              label="Keep it"
              kind="quiet"
              style={styles.middle}
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

interface EventBoxProps {
  event: MemberGymEvent;
  today: string;
  readAt: number;
  clock: GymClockFormat;
  posterUrl: (posterId: string) => string;
  files: PhotoFiles;
  photoRound: number;
  /** What is on its way for this event; null with nothing. */
  busyKind: EventAct | null;
  /** Another event's press is on its way: this one's buttons wait for it. */
  blocked: boolean;
  said: string | undefined;
  onPress: (kind: EventAct) => void;
}

function Fact({ icon, words }: { icon: "calendar" | "pin" | "users"; words: string }) {
  return (
    <View style={styles.fact}>
      <Icon name={icon} size={16} colour="orange" />
      <Txt kind="small" colour="text" style={styles.grow}>
        {words}
      </Txt>
    </View>
  );
}

function EventBox({ event, today, readAt, clock, posterUrl, files, photoRound, busyKind, blocked, said, onPress }: EventBoxProps) {
  const { height } = useWindowDimensions();
  const places = eventPlacesLeft(event);
  const on = !event.cancelled && eventIsOn(event, readAt);
  const mine = eventMine(event);
  const whyNot = eventWhyNot(event);
  const waitNote = waitlistNote(event);
  const { poster } = event;
  // The card's own width: a poster fills it, and a tall one sits in the middle of its box.
  const [cardWidth, setCardWidth] = useState<number | null>(null);
  return (
    <Card testID={`event-${event.id}`} style={styles.card}>
      {poster === null ? null : (
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Poster for ${event.name}`}
          onLayout={(layout) => {
            setCardWidth(layout.nativeEvent.layout.width);
          }}
          style={[styles.poster, { height: posterHeight(cardWidth, poster, height) }, event.cancelled ? styles.faded : null]}
        >
          <SignedPhoto uri={posterUrl(poster.id)} photoId={poster.id} files={files} round={photoRound} fit="contain" testID={`poster-${poster.id}`} />
        </View>
      )}
      <View style={styles.box}>
        <View style={styles.row}>
          <Txt kind="h3" style={[styles.grow, event.cancelled ? styles.struck : null]}>
            {event.name}
          </Txt>
          {event.cancelled ? <Pill label="Cancelled" tone="bad" /> : on ? <Pill label="On now" tone="good" /> : null}
        </View>
        <Fact icon="calendar" words={eventWhen(event, today, clock)} />
        {event.place === "" ? null : <Fact icon="pin" words={event.place} />}
        {places === null || event.cancelled ? null : <Fact icon="users" words={places} />}
        {event.details === "" ? null : <Txt kind="small">{event.details}</Txt>}
        {mine === null || event.cancelled ? null : (
          <View style={styles.mine}>{mine.good ? <Pill label={mine.pill} tone="good" icon="check" /> : <Pill label={mine.pill} tone="gold" />}</View>
        )}
        {mine?.line == null || event.cancelled ? null : <Txt kind="small">{mine.line}</Txt>}
        {waitNote === null ? null : <Txt kind="small">{waitNote}</Txt>}
        {whyNot === null ? null : <Txt kind="small">{whyNot}</Txt>}
        {said === undefined ? null : (
          <Txt kind="small" colour="badText">
            {said}
          </Txt>
        )}
        {eventActions(event).map((action) => (
          <Button
            key={action.label}
            label={action.label}
            kind={action.main ? "main" : "plain"}
            small
            wide
            busy={busyKind === action.kind}
            disabled={blocked || busyKind !== null}
            say={`${action.label}: ${event.name}`}
            onPress={() => {
              onPress(action.kind);
            }}
          />
        ))}
      </View>
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
  list: { paddingHorizontal: sizes.edge, gap: sizes.gap },
  card: { padding: 0 },
  poster: { width: "100%", backgroundColor: colours.fill },
  faded: { opacity: 0.5 },
  box: { padding: 16, gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  fact: { flexDirection: "row", alignItems: "center", gap: 8 },
  mine: { flexDirection: "row" },
  grow: { flex: 1 },
  struck: { textDecorationLine: "line-through", opacity: 0.6 },
  ask: { gap: 12 },
  middle: { alignSelf: "center" },
});
