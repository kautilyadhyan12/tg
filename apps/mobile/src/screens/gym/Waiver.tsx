import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  WAIVER_AGREE_LABEL,
  WAIVER_NAME_MAX_CHARS,
  WAIVER_WORDS,
  cleanSignedName,
  myWaiverResponseSchema,
  orgWords,
  signWaiverResponseSchema,
  waiverReadyToSign,
  type MyWaiverResponse,
  type WaiverSigned,
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
import { placeLine } from "../Invitation";
import { NO_ANSWER } from "../SignIn";
import { WAIVER_ASK_TITLE, WAIVER_NOT_READY, signedLine, waiverAskLine, waiverNotRead, waiverPath, waiverSignPath } from "./waiverView";

// A business's waiver for somebody already its member (ROADMAP Stage 5 item 20b; Kd's drawing of
// 2026-11-07; spec Part 3 §10.10): the line on its card on the Gym tab while they have not signed its
// words as they are today, and the page it opens — the words in full as one paper, their full name,
// the tick and Sign held at the foot. Join's own waiver is the Invitation page's.
//
// A page belongs to ONE business: an answer is shown only when it names the business it asked about,
// and only the newest read stands. What is signed is the wording on the screen; the server refuses any
// other, and the page then shows the words as they are now.

export interface WaiverPlace {
  id: string;
  name: string;
  orgType: string;
  city: string | null;
}

/** The ask on the card, above Show my pass. */
export function WaiverAsk({ gymId, gymName, onOpen }: { gymId: string; gymName: string; onOpen: () => void }) {
  return (
    <Pressable
      testID={`waiver-ask-${gymId}`}
      accessibilityRole="button"
      accessibilityLabel={`${WAIVER_ASK_TITLE}. ${waiverAskLine(gymName)}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.ask, pressed ? styles.askPressed : null]}
    >
      <Badge icon="pen" />
      <View style={styles.grow}>
        <Txt kind="h3">{WAIVER_ASK_TITLE}</Txt>
        <Txt kind="small">{waiverAskLine(gymName)}</Txt>
      </View>
      <Icon name="go" size={18} colour="orange" />
    </Pressable>
  );
}

type Held = { kind: "loading" } | { kind: "failed"; status: number | null } | { kind: "ok"; view: MyWaiverResponse };

/** The page over the Gym tab; closed while `place` is null. */
export function WaiverPage({ place, onClose }: { place: WaiverPlace | null; onClose: () => void }) {
  return place === null ? null : <Body key={place.id} place={place} onClose={onClose} />;
}

function Body({ place, onClose }: { place: WaiverPlace; onClose: () => void }) {
  const { session } = useSession();
  const [held, setHeld] = useState<Held>({ kind: "loading" });
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  // Signed on this page: said here, in place of the words.
  const [done, setDone] = useState<WaiverSigned | null>(null);
  const started = useRef(0);
  const live = useRef(true);

  const load = useCallback(async () => {
    started.current += 1;
    const number = started.current;
    const answer = await session.signedIn({ method: "GET", path: waiverPath(place.id) }, myWaiverResponseSchema);
    if (!live.current || number !== started.current) return;
    if (answer.kind === "ok" && answer.data.gymId === place.id) setHeld({ kind: "ok", view: answer.data });
    else setHeld({ kind: "failed", status: answer.kind === "refused" ? answer.status : null });
  }, [session, place.id]);

  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);

  const view = held.kind === "ok" ? held.view : null;
  const toSign = view !== null && view.waiver !== null && view.signed === null ? view.waiver : null;
  const ready = waiverReadyToSign(name, agreed);

  const sign = async () => {
    if (toSign === null || !ready || busy) return;
    setBusy(true);
    setProblem("");
    const answer = await session.signedIn(
      { method: "POST", path: waiverSignPath(place.id), body: { waiverId: toSign.id, name: cleanSignedName(name) } },
      signWaiverResponseSchema,
    );
    if (!live.current) return;
    setBusy(false);
    if (answer.kind === "ok") {
      setDone(answer.data.signed);
      return;
    }
    setProblem(answer.kind === "refused" ? answer.message : NO_ANSWER);
    // The business changed or stopped its waiver while this was open: show what it asks now.
    if (answer.kind === "refused" && (answer.error === "waiver_changed" || answer.error === "waiver_not_in_use")) {
      setAgreed(false);
      void load();
    }
  };

  const person = orgWords(place.orgType).person;
  const head = (
    <View style={styles.head}>
      <Avatar name={place.name} size={52} />
      <View style={styles.grow}>
        <Txt kind="h3" numberOfLines={1}>
          {place.name}
        </Txt>
        <Txt kind="small" numberOfLines={1}>
          {placeLine(place.orgType, place.city)}
        </Txt>
      </View>
      {view?.signed !== null && view?.signed !== undefined && done === null ? <Pill label="Signed" tone="good" icon="check" /> : null}
    </View>
  );

  if (done !== null) {
    return (
      <CoverPage open title="Waiver" onClose={onClose} foot={<Button label="Done" wide onPress={onClose} />}>
        <View testID="waiver-done" style={styles.done}>
          <View style={styles.doneMark}>
            <Icon name="check" size={32} colour="goodText" />
          </View>
          <Txt kind="h2" style={styles.centre}>
            You signed {place.name}’s waiver.
          </Txt>
          <Txt style={styles.centre}>{signedLine(done, view?.timezone)}</Txt>
        </View>
      </CoverPage>
    );
  }

  const foot =
    toSign === null ? undefined : (
      <>
        {problem === "" ? null : <Txt colour="badText">{problem}</Txt>}
        <Button label="Sign" wide busy={busy} disabled={busy || !ready} say={`Sign ${place.name}'s waiver`} onPress={() => void sign()} />
        {ready ? null : (
          <Txt kind="tiny" style={styles.centre}>
            {WAIVER_NOT_READY}
          </Txt>
        )}
      </>
    );

  return (
    <CoverPage open title="Waiver" onClose={onClose} foot={foot}>
      {held.kind === "loading" ? (
        <Txt kind="small">Loading…</Txt>
      ) : held.kind === "failed" ? (
        <Card style={styles.paper}>
          <Txt colour="badText">{waiverNotRead(held.status, place.name, person)}</Txt>
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
      ) : held.view.waiver === null ? (
        <Card style={styles.paper}>
          {head}
          <View style={styles.line} />
          <Txt colour="text">{WAIVER_WORDS.waiver_not_in_use(place.name)}</Txt>
        </Card>
      ) : (
        <Card testID="waiver-paper" style={styles.paper}>
          {head}
          {held.view.signed === null ? null : (
            <View style={styles.signed}>
              <Icon name="pen" size={14} colour="textSoft" />
              <Txt kind="small" style={styles.grow}>
                {signedLine(held.view.signed, held.view.timezone)}
              </Txt>
            </View>
          )}
          <View style={styles.line} />
          <Txt colour="text" style={styles.words}>
            {held.view.waiver.text}
          </Txt>
          {toSign === null ? null : (
            <>
              <View style={styles.line} />
              <Field label="Full name" value={name} onChange={setName} fills="name" name maxLength={WAIVER_NAME_MAX_CHARS} />
              <Tick
                label={WAIVER_AGREE_LABEL}
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
