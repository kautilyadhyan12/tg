import { useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  GYM_CAN_SEE,
  GYM_NEVER_SEES,
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
import { Badge, Card } from "../look/Card";
import { colours } from "../look/colours";
import { Field } from "../look/Field";
import { Icon } from "../look/Icon";
import { Tick } from "../look/Tick";
import { Txt } from "../look/Txt";
import { useSession } from "../session/SessionProvider";
import { NO_ANSWER } from "./SignIn";

// One invitation to one gym (spec Part 3 §10.2), the browser's InvitationCard fitted to a phone:
// what the gym can see, the gym's waiver where it has one, and the ONE tap, Join. No thanks and
// Not me are words beside it. Nothing is sent until the person presses; Join waits for the
// waiver's name and tick, and the server checks everything again.

export type Answered = "joined" | "declined" | "not_me";

export const invitationsPath = "/v1/orgs/invitations";
const answerPath = (id: string, what: "accept" | "decline" | "not-me") =>
  `${invitationsPath}/${encodeURIComponent(id)}/${what}`;

export function InvitationCard({ invitation, onAnswered }: { invitation: MyInvitation; onAnswered: (kind: Answered) => void }) {
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
      <Card style={styles.done}>
        <View style={styles.row}>
          <Badge icon="check" tone="good" />
          <View style={styles.grow}>
            <Txt kind="h3">You’re in {joined.name}.</Txt>
            <Txt kind="small">
              {joined.featuresOn
                ? `Your ${words.itToMembers}'s features are on.`
                : `Your ${words.itToMembers}'s features aren't on right now.`}
            </Txt>
          </View>
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Badge icon="mail" />
        <View style={styles.grow}>
          <Txt kind="h3">{collapsed ? gym.name : `You’re invited to ${gym.name}`}</Txt>
          {gym.city === null ? null : <Txt kind="small">{gym.city}</Txt>}
        </View>
      </View>

      {state === "declined" && notMe ? (
        <Txt>{INVITATION_WORDS.said_not_me(gym.name)}</Txt>
      ) : state === "declined" ? (
        <Txt>{invitation.canTakeMembers ? "You said no thanks. You can still join." : "You said no thanks."}</Txt>
      ) : null}

      {collapsed ? (
        invitation.canTakeMembers ? (
          <Button
            label={`Pressed this by mistake? Join ${gym.name}`}
            kind="link"
            style={styles.start}
            onPress={() => {
              setMistake(true);
            }}
          />
        ) : null
      ) : (
        <>
          {invitation.canTakeMembers ? (
            <CanSee gymName={gym.name} person={words.person} />
          ) : (
            <Txt>{INVITATION_WORDS.gym_not_taking_members(gym.name, gym.orgType)}</Txt>
          )}

          {plan === null ? null : (
            <View testID="your-plan" style={styles.note}>
              <Txt colour="text">{plan.lead}</Txt>
              <Txt kind="small">{plan.cancel}</Txt>
            </View>
          )}

          {invitation.canTakeMembers && waiver !== null ? (
            <View style={styles.waiver}>
              <Txt kind="h3">{gym.name}’s waiver</Txt>
              <View style={styles.note}>
                <Txt colour="text">{waiver.text}</Txt>
              </View>
              <Field
                label="Your full name"
                value={signedName}
                onChange={setSignedName}
                fills="name"
                name
                maxLength={WAIVER_NAME_MAX_CHARS}
              />
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

          {invitation.canTakeMembers ? (
            <>
              <Button label="Join" wide busy={busy === "join"} disabled={busy !== null || !waiverReady} onPress={() => void join()} />
              {waiverReady ? null : (
                <Txt kind="tiny" style={styles.middle}>
                  To join, type your full name and tick the box.
                </Txt>
              )}
            </>
          ) : null}
          {state === "pending" ? (
            <Button
              label="No thanks"
              kind="quiet"
              style={styles.middle}
              busy={busy === "decline"}
              disabled={busy !== null}
              onPress={() => void decline("decline")}
            />
          ) : null}
        </>
      )}

      {/* The gym typed a wrong address. Nothing here says whom it meant. */}
      {notMe ? null : (
        <View style={styles.notMe}>
          <Txt kind="small">Not a {words.person} of {gym.name}?</Txt>
          <Button label="Not me" kind="link" busy={busy === "not_me"} disabled={busy !== null} onPress={() => void decline("not_me")} />
        </View>
      )}

      {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
    </Card>
  );
}

/** "What {gym} can see": the browser's own two lists, from @app/shared. */
function CanSee({ gymName, person }: { gymName: string; person: string }) {
  return (
    <View style={styles.note}>
      <Txt kind="h3">What {gymName} can see</Txt>
      <Txt kind="tiny">Only while you are a {person}.</Txt>
      {GYM_CAN_SEE.map((line) => (
        <View key={line} style={styles.line}>
          <Icon name="check" size={16} colour="goodText" />
          <Txt style={styles.grow}>{line}</Txt>
        </View>
      ))}
      <Txt kind="tiny" style={styles.never}>
        NEVER
      </Txt>
      {GYM_NEVER_SEES.map((line) => (
        <View key={line} style={styles.line}>
          <Icon name="x" size={16} colour="textFaint" />
          <Txt style={styles.grow}>{line}</Txt>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, gap: 14, borderColor: colours.orangeLine },
  done: { borderColor: colours.goodLine },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  grow: { flex: 1 },
  start: { alignSelf: "flex-start" },
  middle: { alignSelf: "center" },
  note: { gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.fill },
  waiver: { gap: 12 },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  never: { marginTop: 6, letterSpacing: 0.9 },
  notMe: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
});
