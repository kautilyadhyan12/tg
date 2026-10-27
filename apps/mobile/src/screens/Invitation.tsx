import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  GYM_CAN_SEE,
  GYM_NEVER_SEES,
  GYM_SEES_IF_YOU_ALLOW,
  INVITATION_WORDS,
  WAIVER_AGREE_LABEL,
  WAIVER_NAME_MAX_CHARS,
  acceptInvitationResponseSchema,
  cleanSignedName,
  declineInvitationResponseSchema,
  myInvitationsResponseSchema,
  notMeInvitationResponseSchema,
  orgWords,
  waiverReadyToSign,
  yourPlanWords,
  type MyInvitation,
  type WaiverToRead,
} from "@app/shared";
import { Button } from "../look/Button";
import { Avatar, Badge, Card, Pill } from "../look/Card";
import { colours } from "../look/colours";
import { CoverPage } from "../look/CoverPage";
import { Field } from "../look/Field";
import { Icon, type IconName } from "../look/Icon";
import { Tick } from "../look/Tick";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { NO_ANSWER } from "./SignIn";

// Invitations (spec Part 3 §10.2): one box each, and a page over the tab to review one —
// who invited the person, what the place can see, its waiver — with Join held at the bottom.
// Nothing is sent until the person presses; Join waits for the waiver's name and tick, and the
// server checks everything again.

export type Answered = "joined" | "declined" | "not_me";

export const invitationsPath = "/v1/orgs/invitations";
const answerPath = (id: string, what: "accept" | "decline" | "not-me") =>
  `${invitationsPath}/${encodeURIComponent(id)}/${what}`;

/** "Gym · Pune", "Yoga studio". */
export const placeLine = (orgType: unknown, city: string | null) =>
  city === null ? orgWords(orgType).itToMembersCap : `${orgWords(orgType).itToMembersCap} · ${city}`;

/** Each invitation in its own box; View invitation opens it to review. `onAnswered` once the server has answered.
 *  `read` counts the server's reads of these invitations: an answer stands only until the next read,
 *  which says what is true now (the gym may have invited the person again since). */
export function InvitationList({
  invitations,
  label,
  read = 0,
  onAnswered,
}: {
  invitations: MyInvitation[];
  label?: string;
  read?: number;
  onAnswered: (id: string, kind: Answered) => void;
}) {
  // The invitation as it was opened: the page stays open, with what happened, after the list has moved on.
  const [open, setOpen] = useState<MyInvitation | null>(null);
  const [answers, setAnswers] = useState<Readonly<Record<string, { kind: Answered; read: number }>>>({});
  const answered = (id: string): Answered | undefined => {
    const one = answers[id];
    return one !== undefined && one.read === read ? one.kind : undefined;
  };
  const found = open ?? undefined;
  // Opened again after an answer, the page starts from that answer, never from the first read.
  const answer = found === undefined ? undefined : answered(found.id);
  const shown =
    found === undefined
      ? null
      : answer === undefined
        ? found
        : { ...found, state: "declined" as const, notMe: answer === "not_me" || found.notMe };
  return (
    <>
      <View style={styles.cards}>
        {label === undefined || invitations.length === 0 ? null : (
          <Txt kind="tiny" style={styles.caps}>
            {label}
          </Txt>
        )}
        {invitations.map((invitation) => (
          <Card key={invitation.id} style={styles.invite}>
            <PlaceHead name={invitation.gym.name} orgType={invitation.gym.orgType} city={invitation.gym.city}>
              <StatePill invitation={invitation} answered={answered(invitation.id)} />
            </PlaceHead>
            {answered(invitation.id) === "joined" ? null : (
              <Button
                label="View invitation"
                say={`View invitation from ${invitation.gym.name}`}
                kind="soft"
                small
                wide
                onPress={() => {
                  setOpen(invitation);
                }}
              />
            )}
          </Card>
        ))}
      </View>
      {shown === null ? null : (
        <InvitationReview
          key={shown.id}
          invitation={shown}
          onClose={() => {
            setOpen(null);
          }}
          onAnswered={(kind) => {
            setAnswers((before) => ({ ...before, [shown.id]: { kind, read } }));
            onAnswered(shown.id, kind);
          }}
        />
      )}
    </>
  );
}

/** A place's initial, its name and what kind of place it is, with a word about it at the end. */
export function PlaceHead({ name, orgType, city, children }: { name: string; orgType: unknown; city: string | null; children?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Avatar name={name} size={52} />
      <View style={styles.grow}>
        <Txt kind="h3" numberOfLines={1}>
          {name}
        </Txt>
        <Txt kind="small" numberOfLines={1}>
          {placeLine(orgType, city)}
        </Txt>
      </View>
      {children === undefined ? null : <View>{children}</View>}
    </View>
  );
}

function StatePill({ invitation, answered }: { invitation: MyInvitation; answered: Answered | undefined }) {
  if (answered === "joined") return <Pill label="Joined" tone="good" icon="check" />;
  if (answered !== undefined || invitation.state === "declined") return <Pill label="Declined" />;
  return <Pill label="Invited" tone="orange" />;
}

function InvitationReview({
  invitation,
  onClose,
  onAnswered,
}: {
  invitation: MyInvitation;
  onClose: () => void;
  onAnswered: (kind: Answered) => void;
}) {
  const { session } = useSession();
  const { gym } = invitation;
  const words = orgWords(gym.orgType);
  const [busy, setBusy] = useState<"join" | "decline" | "not_me" | null>(null);
  const [problem, setProblem] = useState("");
  const [state, setState] = useState(invitation.state);
  const [notMe, setNotMe] = useState(invitation.notMe);
  // After Not me only what was said is left; a member who pressed it by mistake opens the rest again.
  const [mistake, setMistake] = useState(false);
  const [joined, setJoined] = useState<{ name: string; featuresOn: boolean } | null>(null);
  // The gym can change its waiver while this is open: the last one read is what is signed.
  const [waiver, setWaiver] = useState<WaiverToRead | null>(invitation.waiver);
  const [signedName, setSignedName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const collapsed = notMe && !mistake;
  const plan = invitation.yourPlan !== null && invitation.canTakeMembers ? yourPlanWords(gym.name, invitation.yourPlan) : null;
  const waiverReady = waiver === null || waiverReadyToSign(signedName, agreed);
  const canJoin = invitation.canTakeMembers && !collapsed;

  const join = async () => {
    setBusy("join");
    setProblem("");
    const body = waiver === null ? {} : { waiver: { id: waiver.id, name: cleanSignedName(signedName) } };
    const answer = await session.signedIn({ method: "POST", path: answerPath(invitation.id, "accept"), body }, acceptInvitationResponseSchema);
    if (answer.kind === "ok") {
      setJoined({ name: answer.data.gym.name, featuresOn: answer.data.featuresOn !== false });
      onAnswered("joined");
    } else {
      setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
      // The gym wrote or changed its waiver after this was read: its new words are shown to agree to.
      if (answer.kind === "refused" && (answer.error === "waiver_needed" || answer.error === "waiver_changed")) {
        setAgreed(false);
        const fresh = await session.signedIn({ method: "GET", path: invitationsPath }, myInvitationsResponseSchema);
        if (fresh.kind === "ok") setWaiver(fresh.data.invitations.find((other) => other.id === invitation.id)?.waiver ?? null);
      }
    }
    setBusy(null);
  };

  const decline = async (kind: "decline" | "not_me") => {
    setBusy(kind);
    setProblem("");
    const answer =
      kind === "decline"
        ? await session.signedIn({ method: "POST", path: answerPath(invitation.id, "decline") }, declineInvitationResponseSchema)
        : await session.signedIn({ method: "POST", path: answerPath(invitation.id, "not-me") }, notMeInvitationResponseSchema);
    if (answer.kind === "ok") {
      setState("declined");
      if (kind === "not_me") {
        setNotMe(true);
        setMistake(false);
      }
      onAnswered(kind === "decline" ? "declined" : "not_me");
    } else {
      setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
    }
    setBusy(null);
  };

  if (joined !== null) {
    return (
      <CoverPage open title="Invitation" onClose={onClose} foot={<Button label="Done" wide onPress={onClose} />}>
        <View style={styles.done}>
          <View style={styles.doneMark}>
            <Icon name="check" size={32} colour="goodText" />
          </View>
          <Txt kind="h2" style={styles.centre}>
            You’re a {words.person} of {joined.name}.
          </Txt>
          <Txt style={styles.centre}>
            {joined.featuresOn
              ? `Your ${words.itToMembers}'s features are on.`
              : `Your ${words.itToMembers}'s features aren't on right now.`}
          </Txt>
        </View>
      </CoverPage>
    );
  }

  const foot = (
    <>
      {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
      {canJoin ? (
        <>
          <Button
            label={`Join ${gym.name}`}
            wide
            busy={busy === "join"}
            disabled={busy !== null || !waiverReady}
            onPress={() => void join()}
          />
          {waiverReady ? null : (
            <Txt kind="tiny" style={styles.centre}>
              Enter your full name and tick the box to join.
            </Txt>
          )}
        </>
      ) : null}
      {state === "pending" ? (
        <Button
          label="Decline"
          kind="quiet"
          style={styles.middle}
          busy={busy === "decline"}
          disabled={busy !== null}
          onPress={() => void decline("decline")}
        />
      ) : null}
    </>
  );

  return (
    <CoverPage open title="Invitation" onClose={onClose} foot={foot}>
      <Card style={styles.hero}>
        <Avatar name={gym.name} size={64} />
        <Txt kind="h2" style={styles.centre}>
          {gym.name}
        </Txt>
        <Txt kind="small" style={styles.centre}>
          {placeLine(gym.orgType, gym.city)}
        </Txt>
        <View style={styles.heroLine} />
        <Txt colour="text" style={styles.centre}>
          {state === "declined" && notMe
            ? INVITATION_WORDS.said_not_me(gym.name)
            : state === "declined"
              ? invitation.canTakeMembers
                ? "You declined this invitation. You can still join."
                : "You declined this invitation."
              : `${gym.name} invited you to join as a ${words.person}.`}
        </Txt>
      </Card>

      {collapsed ? (
        invitation.canTakeMembers ? (
          <Button
            label={`Join ${gym.name} anyway`}
            kind="link"
            style={styles.middle}
            onPress={() => {
              setMistake(true);
            }}
          />
        ) : null
      ) : (
        <>
          {invitation.canTakeMembers ? null : (
            <View style={styles.note}>
              <Icon name="warn" size={18} colour="gold" />
              <Txt colour="text" style={styles.grow}>
                {INVITATION_WORDS.gym_not_taking_members(gym.name, gym.orgType)}
              </Txt>
            </View>
          )}

          <CanSee gymName={gym.name} person={words.person} />

          {plan === null ? null : (
            <View testID="your-plan" style={styles.note}>
              <Icon name="star" size={18} colour="textSoft" />
              <View style={styles.grow}>
                <Txt colour="text">{plan.lead}</Txt>
                <Txt kind="small">{plan.cancel}</Txt>
              </View>
            </View>
          )}

          {invitation.canTakeMembers && waiver !== null ? (
            <Card style={styles.panel}>
              <View style={styles.row}>
                <Badge icon="book" />
                <View style={styles.grow}>
                  <Txt kind="h3">Waiver</Txt>
                  <Txt kind="small">Written by {gym.name}</Txt>
                </View>
              </View>
              <ScrollView nestedScrollEnabled style={styles.waiver} contentContainerStyle={styles.waiverWords}>
                <Txt colour="text">{waiver.text}</Txt>
              </ScrollView>
              <Field label="Full name" value={signedName} onChange={setSignedName} fills="name" name maxLength={WAIVER_NAME_MAX_CHARS} />
              <Tick
                label={WAIVER_AGREE_LABEL}
                ticked={agreed}
                disabled={busy !== null}
                onPress={() => {
                  setAgreed((now) => !now);
                }}
              />
            </Card>
          ) : null}
        </>
      )}

      {/* The gym typed a wrong address. Nothing here says whom it meant. */}
      {notMe ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="This invitation isn’t for me"
          accessibilityState={{ disabled: busy !== null, busy: busy === "not_me" }}
          disabled={busy !== null}
          onPress={() => void decline("not_me")}
          style={styles.small}
        >
          <Txt kind="small" colour="textFaint" style={styles.underline}>
            This invitation isn’t for me
          </Txt>
        </Pressable>
      )}
    </CoverPage>
  );
}

/** "What {gym} can see": the browser's own three lists, from @app/shared, each under its own label. */
function CanSee({ gymName, person }: { gymName: string; person: string }) {
  return (
    <Card style={styles.panel}>
      <View style={styles.row}>
        <Badge icon="shield" />
        <View style={styles.grow}>
          <Txt kind="h3">What {gymName} can see</Txt>
          <Txt kind="small">While you’re a {person}.</Txt>
        </View>
      </View>
      <Group tone="good" title="Can see" icon="check" lines={GYM_CAN_SEE} />
      <Group tone="gold" title="Only if you allow it" icon="sliders" lines={GYM_SEES_IF_YOU_ALLOW} />
      <Group tone="plain" title="Never" icon="x" lines={GYM_NEVER_SEES} />
    </Card>
  );
}

const groupTones = {
  good: { ink: "goodText", fill: "goodFill" },
  gold: { ink: "gold", fill: "goldFill" },
  plain: { ink: "textFaint", fill: "fill" },
} as const;

function Group({ tone, title, icon, lines }: { tone: keyof typeof groupTones; title: string; icon: IconName; lines: readonly string[] }) {
  const t = groupTones[tone];
  return (
    <View style={styles.group}>
      <Pill label={title} tone={tone} />
      {lines.map((line) => (
        <View key={line} style={styles.line}>
          <View style={[styles.tile, { backgroundColor: colours[t.fill] }]}>
            <Icon name={icon} size={14} colour={t.ink} />
          </View>
          <Txt style={styles.grow}>{line}</Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: 6, paddingVertical: 22, paddingHorizontal: 18 },
  heroLine: { alignSelf: "stretch", height: 1, backgroundColor: colours.line, marginVertical: 8 },
  panel: { padding: 16, gap: 16 },
  group: { gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: colours.line },
  tile: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  cards: { gap: 12 },
  invite: { padding: 16, gap: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  small: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  underline: { textDecorationLine: "underline" },
  centre: { textAlign: "center" },
  middle: { alignSelf: "center" },
  grow: { flex: 1 },
  caps: { textTransform: "uppercase", letterSpacing: 0.9, marginTop: 2 },
  line: { flexDirection: "row", alignItems: "center", gap: 12 },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colours.line,
    backgroundColor: colours.box,
  },
  waiver: { maxHeight: 220, borderRadius: 14, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.fill },
  waiverWords: { padding: 14 },
  done: { alignItems: "center", gap: 10, paddingTop: 48 },
  doneMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.goodFill,
    borderWidth: 1,
    borderColor: colours.goodLine,
  },
});

