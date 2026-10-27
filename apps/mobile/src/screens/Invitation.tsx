import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
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
import { Avatar, Pill } from "../look/Card";
import { colours } from "../look/colours";
import { CoverPage } from "../look/CoverPage";
import { Field } from "../look/Field";
import { Icon, type IconName } from "../look/Icon";
import { Row, RowGroup } from "../look/Rows";
import { Tick } from "../look/Tick";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { NO_ANSWER } from "./SignIn";

// Invitations (spec Part 3 §10.2): one row each, and a page over the tab to review one —
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

/** Each invitation as a row; a press opens it to review. `onAnswered` once the server has answered. */
export function InvitationList({
  invitations,
  label,
  onAnswered,
}: {
  invitations: MyInvitation[];
  label?: string;
  onAnswered: (id: string, kind: Answered) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Readonly<Record<string, Answered>>>({});
  const shown = invitations.find((one) => one.id === open) ?? null;
  return (
    <>
      <RowGroup {...(label === undefined ? {} : { label })}>
        {invitations.map((invitation) => (
          <Row
            key={invitation.id}
            title={invitation.gym.name}
            detail={placeLine(invitation.gym.orgType, invitation.gym.city)}
            lead={<Avatar name={invitation.gym.name} size={44} />}
            end={<StatePill invitation={invitation} answered={answers[invitation.id]} />}
            onPress={() => {
              setOpen(invitation.id);
            }}
          />
        ))}
      </RowGroup>
      {shown === null ? null : (
        <InvitationReview
          key={shown.id}
          invitation={shown}
          onClose={() => {
            setOpen(null);
          }}
          onAnswered={(kind) => {
            setAnswers((before) => ({ ...before, [shown.id]: kind }));
            onAnswered(shown.id, kind);
          }}
        />
      )}
    </>
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
      <View style={styles.head}>
        <Avatar name={gym.name} size={64} />
        <Txt kind="h1" style={styles.centre}>
          {gym.name}
        </Txt>
        <Txt kind="small" style={styles.centre}>
          {placeLine(gym.orgType, gym.city)}
        </Txt>
        <Txt colour="text" style={styles.centre}>
          {state === "declined" && notMe
            ? INVITATION_WORDS.said_not_me(gym.name)
            : state === "declined"
              ? invitation.canTakeMembers
                ? "You declined this invitation. You can still join."
                : "You declined this invitation."
              : `${gym.name} invited you to join as a ${words.person}.`}
        </Txt>
      </View>

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
            <View style={styles.section}>
              <View>
                <Txt kind="h3">Waiver</Txt>
                <Txt kind="small">Written by {gym.name}</Txt>
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
            </View>
          ) : null}
        </>
      )}

      {/* The gym typed a wrong address. Nothing here says whom it meant. */}
      {notMe ? null : (
        <Button
          label="This invitation isn’t for me"
          kind="quiet"
          style={styles.middle}
          busy={busy === "not_me"}
          disabled={busy !== null}
          onPress={() => void decline("not_me")}
        />
      )}
    </CoverPage>
  );
}

/** "What {gym} can see": the browser's own three lists, from @app/shared. */
function CanSee({ gymName, person }: { gymName: string; person: string }) {
  return (
    <View style={styles.section}>
      <View>
        <Txt kind="h3">What {gymName} can see</Txt>
        <Txt kind="small">While you’re a {person}.</Txt>
      </View>
      <View style={styles.list}>
        {GYM_CAN_SEE.map((line) => (
          <Line key={line} icon="check" colour="goodText" words={line} />
        ))}
      </View>
      <View style={styles.list}>
        <Txt kind="tiny" style={styles.caps}>
          Only if you allow it
        </Txt>
        {GYM_SEES_IF_YOU_ALLOW.map((line) => (
          <Line key={line} icon="shield" colour="textSoft" words={line} />
        ))}
      </View>
      <View style={styles.list}>
        <Txt kind="tiny" style={styles.caps}>
          Never
        </Txt>
        {GYM_NEVER_SEES.map((line) => (
          <Line key={line} icon="x" colour="textFaint" words={line} />
        ))}
      </View>
    </View>
  );
}

function Line({ icon, colour, words }: { icon: IconName; colour: "goodText" | "textSoft" | "textFaint"; words: string }) {
  return (
    <View style={styles.line}>
      <Icon name={icon} size={16} colour={colour} />
      <Txt colour="text" style={styles.grow}>
        {words}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: "center", gap: 6, paddingTop: 8 },
  centre: { textAlign: "center" },
  middle: { alignSelf: "center" },
  grow: { flex: 1 },
  section: { gap: 12 },
  list: { gap: 10 },
  caps: { textTransform: "uppercase", letterSpacing: 0.9, marginTop: 2 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
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
  waiver: { maxHeight: 220, borderRadius: 14, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.box },
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

