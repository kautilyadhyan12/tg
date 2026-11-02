import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  INBOX_NOTE,
  contactGymLabel,
  emptyInboxLine,
  gymContactWays,
  gymInboxResponseSchema,
  gymMessageSwitchResponseSchema,
  inboxPinnedNote,
  markGymInboxReadResponseSchema,
  memberMessageSwitches,
  memberSwitchesHeading,
  pausedInboxLine,
  type GymCheer,
  type GymInboxResponse,
  type GymMessageMemberSwitchGroup,
  type GymNudge,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Card } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NO_ANSWER } from "../SignIn";
import { INBOX_NOT_READ, LINK_NOT_OPENED, SWITCH_NOT_SAVED, inboxPath, inboxReadPath, inboxRow, inboxSwitchPath } from "./inboxView";

// A place's messages to its member (spec Part 3 §16.1; ROADMAP Stage 5 item 18a): the place's pinned note, then its
// messages, newest first, Contact the gym, and the member's two switches. A page over the Gym tab, read when it opens
// and when the app comes back. Opening it tells the server the messages shown were seen; the New marks stay until it
// is read again. A switch shows only what the server's last answer said.

export interface InboxPlace {
  id: string;
  name: string;
  orgType: string;
  latestCheer: GymCheer | null;
  latestNudge: GymNudge | null;
}

/** The page over the Gym tab; closed while `place` is null. `onUnread`: the place's count of new messages, as the server last said it. */
export function InboxPage({ place, onClose, onUnread }: { place: InboxPlace | null; onClose: () => void; onUnread: (gymId: string, unread: number) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="inbox-page" accessibilityViewIsModal style={[styles.page, { paddingTop: insets.top }]}>
        {place === null ? null : <InboxBody key={place.id} place={place} onClose={onClose} onUnread={onUnread} bottom={insets.bottom} />}
      </View>
    </Modal>
  );
}

type Held = { kind: "loading" } | { kind: "failed" } | { kind: "ok"; inbox: GymInboxResponse; readAt: number };
type Switches = { off: readonly string[]; groupMessages: boolean };

function InboxBody({ place, onClose, onUnread, bottom }: { place: InboxPlace; onClose: () => void; onUnread: (gymId: string, unread: number) => void; bottom: number }) {
  const { session } = useSession();
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  // The switches as the server last said them; null until the inbox is read.
  const [switches, setSwitches] = useState<Switches | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [switchesOpen, setSwitchesOpen] = useState(false);
  const [busyGroup, setBusyGroup] = useState<GymMessageMemberSwitchGroup | null>(null);
  const [switchSaid, setSwitchSaid] = useState<string | null>(null);
  // A link no app on the phone could open, said where it was pressed: a message's id, or "contact".
  const [notOpened, setNotOpened] = useState<string | null>(null);
  // Reads are numbered as they start: an answer stands only if no later read has started.
  const started = useRef(0);
  const live = useRef(true);
  // Read through a call: after a wait the page may have closed, which a plain read narrowed before the wait hides.
  const isLive = useCallback(() => live.current, []);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const answer = await session.signedIn({ method: "GET", path: inboxPath(place.id) }, gymInboxResponseSchema);
      if (!live.current || number !== started.current) return;
      // Another place's messages are never shown under this one.
      if (answer.kind === "ok" && answer.data.gymId === place.id) {
        const inbox = answer.data;
        setHeld({ kind: "ok", inbox, readAt: Date.now() });
        setSwitches({ off: inbox.off, groupMessages: inbox.groupMessages });
        onUnread(place.id, inbox.unread);
        if (inbox.unread === 0) return;
        // Seen up to what this read showed: a message that came after it stays new.
        const seen = await session.signedIn({ method: "POST", path: inboxReadPath(place.id), body: { upTo: inbox.asOf } }, markGymInboxReadResponseSchema);
        if (seen.kind === "ok" && isLive()) onUnread(place.id, seen.data.unread);
      } else if (!quiet || answer.kind === "refused") {
        // A read made by itself never takes the messages away over a lost connection.
        setHeld({ kind: "failed" });
      }
    },
    [session, place.id, onUnread, isLive],
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

  const change = async (group: GymMessageMemberSwitchGroup, on: boolean) => {
    if (busyGroup !== null) return;
    setBusyGroup(group);
    setSwitchSaid(null);
    const answer = await session.signedIn({ method: "PUT", path: inboxSwitchPath(place.id), body: { group, on } }, gymMessageSwitchResponseSchema);
    if (!live.current) return;
    setBusyGroup(null);
    if (answer.kind === "ok") {
      // What the server holds now, never what was pressed.
      setSwitches((was) => ({ off: answer.data.off, groupMessages: answer.data.groupMessages ?? was?.groupMessages ?? true }));
      return;
    }
    setSwitchSaid(answer.kind === "no_answer" ? NO_ANSWER : SWITCH_NOT_SAVED);
  };

  const open = (url: string, where: string) => {
    setNotOpened(null);
    Linking.openURL(url).catch(() => {
      if (isLive()) setNotOpened(where);
    });
  };

  const inbox = held.kind === "ok" ? held.inbox : null;
  const paused = inbox?.status === "paused";
  const pinned = inbox === null || paused ? null : inboxPinnedNote(place.latestCheer, place.latestNudge, held.kind === "ok" ? held.readAt : 0);
  const rows = inbox === null || paused ? [] : inbox.messages.map((m) => inboxRow(m, held.kind === "ok" ? held.readAt : 0));
  const contact = gymContactWays(inbox?.contact, place.name);
  const switchRows = switches === null ? [] : memberMessageSwitches(place.name, place.orgType, switches.off, switches.groupMessages);

  return (
    <>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={styles.back}>
          <Icon name="back" size={18} />
        </Pressable>
        <View style={styles.grow}>
          <Txt kind="h2">Inbox</Txt>
          <Txt kind="small" numberOfLines={1}>
            {place.name}
          </Txt>
        </View>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={[styles.list, { paddingBottom: bottom + 24 }]}>
        {held.kind === "loading" ? <Txt kind="small">Loading…</Txt> : null}
        {held.kind === "failed" ? (
          <Card style={styles.box}>
            <Txt colour="badText">{INBOX_NOT_READ}</Txt>
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
        ) : null}
        {paused ? <Txt>{pausedInboxLine(place.name)}</Txt> : null}
        {inbox === null || paused ? null : (
          <>
            {pinned === null ? null : (
              <Card testID="inbox-pinned" style={[styles.box, styles.pinned]}>
                <View style={styles.row}>
                  <Icon name="pin" size={16} colour="orange" />
                  <Txt colour="text" style={styles.grow}>
                    {pinned.text}
                  </Txt>
                </View>
                <Txt kind="tiny">{pinned.when === null ? "Pinned" : `Pinned · ${pinned.when}`}</Txt>
              </Card>
            )}
            {rows.length === 0 && pinned === null ? <Txt>{emptyInboxLine(place.name)}</Txt> : null}
            {rows.map((row) => (
              <Card key={row.id} testID={`message-${row.id}`} style={styles.box}>
                <View style={styles.row}>
                  <Icon name="mail" size={16} colour={row.isNew ? "orange" : "textFaint"} />
                  <Txt colour="text" style={styles.grow}>
                    {row.body}
                  </Txt>
                </View>
                {row.link === null ? null : (
                  <Button
                    label="Leave a review"
                    kind="soft"
                    small
                    style={styles.under}
                    onPress={() => {
                      if (row.link !== null) open(row.link, row.id);
                    }}
                  />
                )}
                {notOpened === row.id ? (
                  <Txt kind="small" colour="badText" style={styles.under}>
                    {LINK_NOT_OPENED}
                  </Txt>
                ) : null}
                {row.isNew || row.when !== null ? (
                  <Txt kind="tiny" style={styles.under}>
                    {row.isNew ? (
                      <Txt kind="tiny" colour="orange" style={styles.strong}>
                        New
                      </Txt>
                    ) : null}
                    {row.isNew && row.when !== null ? " · " : ""}
                    {row.when}
                  </Txt>
                ) : null}
              </Card>
            ))}
            <Txt kind="small">{INBOX_NOTE}</Txt>
            {contact.none === null ? (
              <Button
                label={contactGymLabel(place.orgType)}
                kind="soft"
                icon="phone"
                wide
                onPress={() => {
                  setContactOpen(true);
                }}
              />
            ) : (
              <Txt kind="small">{contact.none}</Txt>
            )}
            {notOpened === "contact" ? (
              <Txt kind="small" colour="badText">
                {LINK_NOT_OPENED}
              </Txt>
            ) : null}
            <Button
              label={memberSwitchesHeading(place.name)}
              kind="link"
              icon="settings"
              style={styles.middle}
              onPress={() => {
                setSwitchesOpen(true);
              }}
            />
          </>
        )}
      </ScrollView>
      <Sheet
        open={contactOpen}
        title={contactGymLabel(place.orgType)}
        onClose={() => {
          setContactOpen(false);
        }}
      >
        <View style={styles.sheet}>
          {contact.ways.map((way) => (
            <Button
              key={way.kind}
              label={way.label}
              kind="plain"
              icon={way.kind === "phone" ? "phone" : "mail"}
              wide
              onPress={() => {
                setContactOpen(false);
                open(way.href, "contact");
              }}
            />
          ))}
        </View>
      </Sheet>
      <Sheet
        open={switchesOpen}
        title={memberSwitchesHeading(place.name)}
        onClose={() => {
          setSwitchesOpen(false);
          setSwitchSaid(null);
        }}
      >
        <View style={styles.sheet}>
          {switchRows.map((row) => (
            <View key={row.group} testID={`switch-${row.group}`} style={styles.switchRow}>
              <View style={styles.grow}>
                <Txt kind="strong">{row.label}</Txt>
                <Txt kind="small">{row.line}</Txt>
              </View>
              <Switch
                accessibilityLabel={row.label}
                value={row.on}
                disabled={busyGroup !== null}
                onValueChange={(on) => void change(row.group, on)}
                trackColor={{ false: colours.lineStrong, true: colours.orange }}
                thumbColor={colours.text}
              />
            </View>
          ))}
          {switchSaid === null ? null : (
            <Txt kind="small" colour="badText">
              {switchSaid}
            </Txt>
          )}
        </View>
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
  list: { paddingHorizontal: sizes.edge, gap: sizes.gap },
  box: { padding: 16, gap: 8 },
  pinned: { backgroundColor: colours.orangeFill, borderColor: colours.orangeLine },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  grow: { flex: 1 },
  middle: { alignSelf: "center" },
  // Under the words, beside the envelope.
  under: { marginLeft: 26, alignSelf: "flex-start" },
  strong: { fontFamily: fonts.semibold },
  sheet: { gap: 12 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.press },
});
