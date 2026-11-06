import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { memberReferralResponseSchema, referralLineWords, referralShareMessage, type ReferralTickets } from "@app/shared";
import { Button } from "../../look/Button";
import { Badge, Card } from "../../look/Card";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { Rise } from "../../look/Motion";
import { PictureTop } from "../../look/PictureTop";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { CopyContext } from "../ThisCopy";
import { SHARE_NOT_OPENED, inviteLink, inviteNotRead, inviteOff, invitePath, type InviteHeld } from "./inviteView";

// Invite a friend (ROADMAP Stage 5 item 20a; Kd's drawing of 2026-11-06): the line at the foot of a
// business's card on the Gym tab, where it has switched Refer a friend on, and the page it opens:
// what the member gets and what their friend gets, each on a ticket, one Share my link and the link.
//
// Each line and each page belongs to ONE business, and shows an answer only when that answer names
// the business it asked about: one member's link is never shown, or shared, under another business.

export interface InvitePlace {
  id: string;
  name: string;
  /** What the Gym tab's line last read, so the page opens with it while it reads again. */
  first: InviteHeld;
}

type Read = (gymId: string) => Promise<InviteHeld>;

/** One read of a business's invite, kept only if it answers for that business. */
function useInviteRead(): Read {
  const { session } = useSession();
  const webUrl = useContext(CopyContext).extra?.webUrl;
  return useCallback(
    async (gymId: string): Promise<InviteHeld> => {
      const answer = await session.signedIn({ method: "GET", path: invitePath(gymId) }, memberReferralResponseSchema);
      if (answer.kind !== "ok") return { kind: "failed", status: answer.kind === "refused" ? answer.status : null };
      if (answer.data.gymId !== gymId) return { kind: "failed", status: null };
      if (answer.data.status === "off") return { kind: "off" };
      // A copy that does not know its website has no link to give.
      if (webUrl === undefined) return { kind: "failed", status: null };
      return { kind: "on", invite: answer.data, link: inviteLink(webUrl, answer.data.path) };
    },
    [session, webUrl],
  );
}

interface InviteLineProps {
  gymId: string;
  gymName: string;
  /** Changed by the Gym tab when its places are read again. */
  read: number;
  onOpen: (first: InviteHeld) => void;
}

/** The line at the foot of a business's card: shown only while its offer is on. */
export function InviteLine({ gymId, gymName, read, onOpen }: InviteLineProps) {
  const readInvite = useInviteRead();
  const [held, setHeld] = useState<InviteHeld>({ kind: "loading" });
  const started = useRef(0);
  useEffect(() => {
    let live = true;
    started.current += 1;
    const number = started.current;
    void readInvite(gymId).then((now) => {
      if (!live || number !== started.current) return;
      // A read that fails keeps what the last one showed; the next read of the places tries again.
      setHeld((was) => (now.kind === "failed" && was.kind !== "loading" ? was : now));
    });
    return () => {
      live = false;
    };
  }, [readInvite, gymId, read]);

  if (held.kind !== "on") return null;
  const gift = referralLineWords(held.invite.memberGift);
  return (
    <Pressable
      testID={`invite-line-${gymId}`}
      accessibilityRole="button"
      accessibilityLabel={`Invite a friend to ${gymName}${gift === null ? "" : `. ${gift}`}`}
      onPress={() => {
        onOpen(held);
      }}
      style={({ pressed }) => [styles.line, pressed ? styles.pressed : null]}
    >
      <Badge icon="gift" />
      <View style={styles.grow}>
        <Txt kind="h3">Invite a friend</Txt>
        {gift === null ? null : <Txt kind="small">{gift}</Txt>}
      </View>
      <Icon name="go" size={18} colour="orange" />
    </Pressable>
  );
}

/** The page over the Gym tab; closed while `place` is null. */
export function InviteFriendPage({ place, onClose }: { place: InvitePlace | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={place !== null} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View testID="invite-page" accessibilityViewIsModal style={styles.page}>
        {place === null ? null : <Body key={place.id} place={place} top={insets.top} bottom={insets.bottom} onClose={onClose} />}
      </View>
    </Modal>
  );
}

function Body({ place, top, bottom, onClose }: { place: InvitePlace; top: number; bottom: number; onClose: () => void }) {
  const readInvite = useInviteRead();
  const [held, setHeld] = useState<InviteHeld>(place.first);
  const [shareFailed, setShareFailed] = useState(false);
  const started = useRef(0);
  const live = useRef(true);

  const load = useCallback(
    async (quiet: boolean) => {
      started.current += 1;
      const number = started.current;
      const now = await readInvite(place.id);
      if (!live.current || number !== started.current) return;
      // A read made by itself never takes the page away over a lost connection.
      setHeld((was) => (quiet && now.kind === "failed" && now.status === null && was.kind === "on" ? was : now));
    },
    [readInvite, place.id],
  );

  useEffect(() => {
    live.current = true;
    void load(true);
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active") void load(true);
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [load]);

  const share = async (message: string) => {
    setShareFailed(false);
    try {
      await Share.share({ message });
    } catch {
      if (live.current) setShareFailed(true);
    }
  };

  return (
    <>
      <ScrollView style={styles.grow} contentContainerStyle={{ paddingBottom: bottom + 24 }}>
        <PictureTop picture="highfive" tall={PICTURE_TALL} eyebrow={place.name} title="Invite a friend" />
        <View style={styles.body}>
          {held.kind === "loading" ? (
            <Txt kind="small">Loading…</Txt>
          ) : held.kind === "failed" ? (
            <Card style={styles.box}>
              <Txt colour="badText">{inviteNotRead(held.status, place.name)}</Txt>
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
          ) : held.kind === "off" ? (
            <Txt colour="text">{inviteOff(place.name)}</Txt>
          ) : (
            <>
              <Tickets tickets={held.invite.tickets} />
              <Button label="Share my link" icon="share" wide say={`Share my invite link for ${place.name}`} onPress={() => void share(referralShareMessage(place.name, held.link))} />
              {shareFailed ? <Txt colour="badText">{SHARE_NOT_OPENED}</Txt> : null}
              <View style={styles.link}>
                <Icon name="users" size={16} colour="textSoft" />
                <Txt colour="text" style={styles.grow} numberOfLines={2}>
                  {held.link}
                </Txt>
                <Txt kind="tiny">your link</Txt>
              </View>
              <View style={styles.small}>
                {held.invite.tickets.small.map((line) => (
                  <Txt key={line} kind="tiny">
                    {line}
                  </Txt>
                ))}
              </View>
            </>
          )}
        </View>
      </ScrollView>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onClose} style={[styles.back, { top: top + BACK_TOP }]}>
        <Icon name="back" size={18} />
      </Pressable>
    </>
  );
}

/** Each gift on a ticket: its words large, and what it needs under them. */
function Tickets({ tickets }: { tickets: ReferralTickets }) {
  return (
    <>
      {tickets.you === null ? null : (
        <Rise>
          <Ticket label="You get" gift={tickets.you.gift} notes={tickets.you.notes} />
        </Rise>
      )}
      {tickets.friend === null ? null : (
        <Rise delay={90}>
          <Ticket label="Your friend gets" gift={tickets.friend.gift} notes={[tickets.friend.note]} />
        </Rise>
      )}
      {tickets.plain === null ? null : (
        <Card style={styles.box}>
          <Txt colour="text">{tickets.plain}</Txt>
        </Card>
      )}
    </>
  );
}

function Ticket({ label, gift, notes }: { label: string; gift: string; notes: string[] }) {
  return (
    <View style={styles.ticket} accessible accessibilityLabel={`${label}: ${gift}. ${notes.join(" ")}`}>
      <Txt kind="eyebrow">{label}</Txt>
      <Txt kind="h2">{gift}</Txt>
      {notes.map((note) => (
        <View key={note} style={styles.note}>
          <View style={styles.tick}>
            <Icon name="check" size={14} colour="textSoft" />
          </View>
          <Txt kind="small" style={styles.grow}>
            {note}
          </Txt>
        </View>
      ))}
      {/* The ticket's two notches. */}
      <View style={[styles.notch, styles.notchLeft]} />
      <View style={[styles.notch, styles.notchRight]} />
    </View>
  );
}

/** The picture's height for the phone's width, as Challenges' own page. */
const PICTURE_TALL = 0.5;
const BACK_TOP = 12;
const NOTCH = 22;

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  grow: { flex: 1 },
  body: { paddingHorizontal: sizes.edge, paddingTop: 8, gap: sizes.gap },
  box: { padding: 16, gap: 10 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: -16,
    marginBottom: -16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: sizes.press + 12,
    borderTopWidth: 1,
    borderTopColor: colours.line,
  },
  pressed: { backgroundColor: colours.fill },
  ticket: {
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 20,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colours.ticketEdge,
    backgroundColor: colours.box,
  },
  note: { flexDirection: "row", gap: 8 },
  tick: { paddingTop: 2 },
  notch: { position: "absolute", top: "50%", width: NOTCH, height: NOTCH, marginTop: -NOTCH / 2, borderRadius: NOTCH / 2, backgroundColor: colours.page },
  notchLeft: { left: -NOTCH / 2 - 1 },
  notchRight: { right: -NOTCH / 2 - 1 },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: sizes.press,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.fieldLine,
    backgroundColor: colours.field,
  },
  small: { gap: 4, paddingHorizontal: 2 },
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
});
