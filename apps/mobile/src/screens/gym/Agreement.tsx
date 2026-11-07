import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  AGREEMENT_AGREE_LABEL,
  WAIVER_NAME_MAX_CHARS,
  cleanSignedName,
  myAgreementResponseSchema,
  signMyAgreementResponseSchema,
  waiverReadyToSign,
  type AgreementEmailed,
  type MyAgreementResponse,
  type MySignedAgreement,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Avatar, Badge, Card, Pill } from "../../look/Card";
import { colours } from "../../look/colours";
import { CoverPage } from "../../look/CoverPage";
import { Field } from "../../look/Field";
import { Icon } from "../../look/Icon";
import { Tick } from "../../look/Tick";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { NO_ANSWER } from "../SignIn";
import {
  AGREEMENT_ASK_TITLE,
  AGREEMENT_PAGE_TITLE,
  SIGN_AGREEMENT_BUTTON,
  UNSIGNED_SIGN_HERE,
  agreementAskLine,
  agreementDoneTitle,
  agreementNotRead,
  agreementPath,
  agreementSignPath,
  agreementSignedLine,
  copyLine,
  notInAppLine,
  termsHeading,
} from "./agreementView";
import { WAIVER_NOT_READY } from "./waiverView";

// A member's own membership agreement (ROADMAP Stage 5 item 20c; spec Part 3 §14.8; Kd's drawing of 2026-11-07): the
// ask on the business's card on the Gym tab while a membership of theirs has one to sign, and the page it opens — the
// membership's details first, as the website's sign page lists them, then the business's own words, their full name,
// the tick and Sign held at the foot. My membership opens the same page, to sign or to read what was signed.
//
// A page belongs to ONE membership of ONE business: an answer is shown only when it names both, and only the newest
// read stands. What is signed is the details and the words on the screen; the server refuses any other, and the page
// then shows them as they are now.

export interface AgreementPlace {
  /** The business. */
  id: string;
  name: string;
  membershipId: string;
  membershipName: string;
}

/** The ask on the card, above Show my pass. */
export function AgreementAsk({ gymName, membershipId, membershipName, onOpen }: { gymName: string; membershipId: string; membershipName: string; onOpen: () => void }) {
  return (
    <Pressable
      testID={`agreement-ask-${membershipId}`}
      accessibilityRole="button"
      accessibilityLabel={`${AGREEMENT_ASK_TITLE}. ${agreementAskLine(gymName, membershipName)}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.ask, pressed ? styles.askPressed : null]}
    >
      <Badge icon="pen" />
      <View style={styles.grow}>
        <Txt kind="h3">{AGREEMENT_ASK_TITLE}</Txt>
        <Txt kind="small">{agreementAskLine(gymName, membershipName)}</Txt>
      </View>
      <Icon name="go" size={18} colour="orange" />
    </Pressable>
  );
}

/** Where the business stops new bookings until the agreement is signed and the member can sign it here: the line,
 *  and the button that opens the agreement. */
export function SignToBook({ onSign }: { onSign: () => void }) {
  return (
    <View testID="sign-to-book" style={styles.stop}>
      <Txt kind="small" colour="orange">
        {UNSIGNED_SIGN_HERE}
      </Txt>
      <Button label={SIGN_AGREEMENT_BUTTON} kind="link" icon="pen" small onPress={onSign} />
    </View>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | "other" | null } | { kind: "ok"; view: MyAgreementResponse };

/** The page over the tab or over My membership; closed while `place` is null. */
export function AgreementPage({ place, onClose, onSigned }: { place: AgreementPlace | null; onClose: () => void; onSigned: (gymId: string, membershipId: string) => void }) {
  return place === null ? null : <Body key={`${place.id}:${place.membershipId}`} place={place} onClose={onClose} onSigned={onSigned} />;
}

function Body({ place, onClose, onSigned }: { place: AgreementPlace; onClose: () => void; onSigned: (gymId: string, membershipId: string) => void }) {
  const { session } = useSession();
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // Signed on this page: said here, in place of the words.
  const [done, setDone] = useState<{ signed: MySignedAgreement; emailed: AgreementEmailed } | null>(null);
  const started = useRef(0);
  const live = useRef(true);

  const load = useCallback(async () => {
    started.current += 1;
    const number = started.current;
    const answer = await session.signedIn({ method: "GET", path: agreementPath(place.id, place.membershipId) }, myAgreementResponseSchema);
    if (!live.current || number !== started.current) return;
    if (answer.kind === "ok") {
      const ours = answer.data.gymId === place.id && answer.data.membershipId === place.membershipId;
      setHeld(ours ? { kind: "ok", view: answer.data } : { kind: "failed", status: "other" });
    } else setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
  }, [session, place.id, place.membershipId]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  const view = held.kind === "ok" ? held.view : null;
  const toSign = view !== null && view.state === "to_sign" && view.agreement !== null && view.factsKey !== null ? { agreementId: view.agreement.id, factsKey: view.factsKey } : null;
  const ready = waiverReadyToSign(name, agreed);

  const sign = async () => {
    if (toSign === null || !ready || busy) return;
    setBusy(true);
    setProblem("");
    const answer = await session.signedIn(
      { method: "POST", path: agreementSignPath(place.id, place.membershipId), body: { ...toSign, name: cleanSignedName(name) } },
      signMyAgreementResponseSchema,
    );
    if (!live.current) return;
    setBusy(false);
    if (answer.kind === "ok") {
      setDone(answer.data);
      // The card and My membership say signed at once; they read again on closing.
      onSigned(place.id, place.membershipId);
      return;
    }
    setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
    // The details, the words or who signs changed while this was open: show what is asked now.
    if (answer.kind === "refused" && answer.status === 409) {
      setAgreed(false);
      void load();
    }
  };

  const head = (
    <View style={styles.head}>
      <Avatar name={place.name} size={52} />
      <View style={styles.grow}>
        <Txt kind="h3" numberOfLines={1}>
          {place.name}
        </Txt>
        <Txt kind="small" numberOfLines={2}>
          {view?.membershipName ?? place.membershipName}
        </Txt>
      </View>
      {view?.state === "signed" && done === null ? <Pill label="Signed" tone="good" icon="check" /> : null}
    </View>
  );

  if (done !== null) {
    return (
      <CoverPage open title={AGREEMENT_PAGE_TITLE} onClose={onClose} foot={<Button label="Done" wide onPress={onClose} />}>
        <View testID="agreement-done" style={styles.done}>
          <View style={styles.doneMark}>
            <Icon name="check" size={32} colour="goodText" />
          </View>
          <Txt kind="h2" style={styles.centre}>
            {agreementDoneTitle(place.name)}
          </Txt>
          <Txt style={styles.centre}>
            {agreementSignedLine(done.signed, view?.timezone)} {copyLine(done.emailed, place.name)}
          </Txt>
        </View>
      </CoverPage>
    );
  }

  const foot =
    toSign === null ? undefined : (
      <>
        {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
        <Button label="Sign" wide busy={busy} disabled={busy || !ready} say={`Sign ${place.name}'s membership agreement`} onPress={() => void sign()} />
        {ready ? null : (
          <Txt kind="tiny" style={styles.centre}>
            {WAIVER_NOT_READY}
          </Txt>
        )}
      </>
    );

  // Signing: the details worked out now; signed: the details as they were signed.
  const facts = view === null ? null : view.state === "signed" ? (view.signed?.facts ?? null) : view.facts;
  const words = view === null ? null : view.state === "signed" ? (view.signed?.text ?? null) : (view.agreement?.text ?? null);
  const wordsName = view === null ? null : view.state === "signed" ? (view.signed?.agreementName ?? null) : (view.agreement?.name ?? null);

  return (
    <CoverPage open title={AGREEMENT_PAGE_TITLE} onClose={onClose} foot={foot}>
      {held.kind === "loading" ? (
        <Txt kind="small">Loading…</Txt>
      ) : held.kind === "failed" ? (
        <Card testID="agreement-failed" style={styles.paper}>
          <Txt colour="badText">{agreementNotRead(held.status)}</Txt>
          {held.status === 404 ? null : (
            <Button
              label="Try again"
              kind="soft"
              small
              onPress={() => {
                setHeld({ kind: "loading" });
                void load();
              }}
            />
          )}
        </Card>
      ) : facts === null || words === null ? (
        <Card testID="agreement-none" style={styles.paper}>
          {head}
          <View style={styles.line} />
          {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
          <Txt colour="text">{notInAppLine(held.view)}</Txt>
        </Card>
      ) : (
        <Card testID="agreement-paper" style={styles.paper}>
          {head}
          {held.view.state === "signed" && held.view.signed !== null ? (
            <View style={styles.signed}>
              <Icon name="pen" size={14} colour="textSoft" />
              <Txt kind="small" style={styles.grow}>
                {agreementSignedLine(held.view.signed, held.view.timezone)}
              </Txt>
            </View>
          ) : null}
          <View style={styles.line} />
          <Txt kind="eyebrow" colour="textFaint">
            The membership
          </Txt>
          <View testID="agreement-facts" style={styles.facts}>
            {facts.map((fact) => (
              <View key={fact.label} style={styles.fact}>
                <Txt kind="small" style={styles.factLabel}>
                  {fact.label}
                </Txt>
                <Txt colour="text" style={styles.factValue}>
                  {fact.value}
                </Txt>
              </View>
            ))}
          </View>
          <View style={styles.line} />
          <Txt kind="eyebrow" colour="textFaint">
            {termsHeading(place.name, wordsName)}
          </Txt>
          <Txt colour="text" style={styles.words}>
            {words}
          </Txt>
          {toSign === null ? null : (
            <>
              <View style={styles.line} />
              <Field label="Full name" value={name} onChange={setName} fills="name" name maxLength={WAIVER_NAME_MAX_CHARS} disabled={busy} />
              <Tick
                label={AGREEMENT_AGREE_LABEL}
                ticked={agreed}
                disabled={busy}
                onPress={() => {
                  setAgreed((now) => !now);
                }}
              />
            </>
          )}
        </Card>
      )}
    </CoverPage>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  ask: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colours.orangeLine,
    backgroundColor: colours.orangeFill,
  },
  askPressed: { backgroundColor: colours.orangeLine },
  paper: { padding: 16, gap: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  signed: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { height: 1, backgroundColor: colours.line },
  stop: { gap: 4, alignItems: "flex-start" },
  facts: { gap: 8 },
  fact: { flexDirection: "row", gap: 14 },
  // The label and its value side by side, as the website lists them; each grows with the largest text.
  factLabel: { flex: 2 },
  factValue: { flex: 3 },
  words: { lineHeight: 21 },
  centre: { textAlign: "center" },
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
