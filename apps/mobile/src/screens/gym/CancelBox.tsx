import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import {
  MY_CANCEL_REASON_QUESTION,
  myCancelAskSchema,
  myCancelDoneSchema,
  myCancelReasonRequestSchema,
  myKeepAskSchema,
  myKeepDoneSchema,
  type MyCancelAsk,
  type MyCancelDone,
  type MyCancelReason,
  type MyCancelWhen,
  type MyKeepAsk,
  type MyKeepDone,
} from "@app/shared";
import { Button } from "../../look/Button";
import { Options } from "../../look/Choice";
import { Sheet } from "../../look/Sheet";
import { RECEIPT_MOST } from "../../look/sizing";
import { Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import {
  CLOSE,
  COULD_NOT_READ,
  DONE,
  EMAILED,
  GO_BACK,
  NO_ANSWER_PRESS,
  REASON_NOT_SAVED,
  REASON_OPTIONS,
  SKIP,
  cancelTitle,
  keepTitle,
  myCancelPath,
  myCancelReasonPath,
  myKeepPath,
  refusedLine,
} from "./cancelView";
import { newRequestKey } from "./classesView";

// The boxes from the bottom under Cancel membership and Keep my membership (ROADMAP Stage 5 item 20j). Nothing changes
// until the member presses a button the box shows; that button sends back the box's own key, so the server refuses a
// cancel or keep whose box has changed since it was read. A press whose answer was lost is sent again with the same
// request key when pressed again, so it is one cancel, answered as it was.

/** The membership a box is open for. */
export interface BoxFor {
  membershipId: string;
  name: string;
}

type Step<A, D> = { kind: "loading" } | { kind: "failed" } | { kind: "ask"; ask: A } | { kind: "done"; done: D };

/** A press whose answer was lost: pressed again, it is sent with the same request key. */
type Lost = { membershipId: string; what: string; key: string; requestKey: string };

function useLostPress() {
  const lost = useRef<Lost | null>(null);
  return {
    /** The request key for this press: the lost one's where it is the same press of the same box. */
    keyFor: (membershipId: string, what: string, key: string): string => {
      const was = lost.current;
      lost.current = null;
      return was !== null && was.membershipId === membershipId && was.what === what && was.key === key ? was.requestKey : newRequestKey();
    },
    keep: (l: Lost) => {
      lost.current = l;
    },
  };
}

/** The box under Cancel membership: when it ends and what is still to pay, one button a way; once cancelled, said in
 *  the box, then "Why are you leaving?" (never a must). `onDone` gives the place what to say under the membership. */
export function CancelBox({ gymId, open, onDone, onClose }: { gymId: string; open: BoxFor | null; onDone: (membershipId: string, line: string) => void; onClose: () => void }) {
  const { session } = useSession();
  const { height } = useWindowDimensions();
  const [step, setStep] = useState<Step<MyCancelAsk, MyCancelDone>>({ kind: "loading" });
  const [busy, setBusy] = useState<MyCancelWhen | null>(null);
  const [problem, setProblem] = useState<{ line: string; final: boolean } | null>(null);
  const [reason, setReason] = useState<{ picked: MyCancelReason | null; busy: boolean; failed: boolean }>({ picked: null, busy: false, failed: false });
  const lost = useLostPress();
  // Reads are numbered as they start: an answer stands only if no later read or press has started.
  const asked = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const read = useCallback(
    async (target: BoxFor) => {
      asked.current += 1;
      const number = asked.current;
      const answer = await session.signedIn({ method: "GET", path: myCancelPath(gymId, target.membershipId) }, myCancelAskSchema);
      if (!live.current || number !== asked.current) return;
      // Only the membership pressed is shown in its box.
      if (answer.kind === "ok" && answer.data.membership.id === target.membershipId) setStep({ kind: "ask", ask: answer.data });
      else if (answer.kind === "refused") setProblem({ line: refusedLine(answer.status, answer.error, answer.message).line, final: true });
      else setStep({ kind: "failed" });
    },
    [session, gymId],
  );

  useEffect(() => {
    if (open === null) return;
    setStep({ kind: "loading" });
    setBusy(null);
    setProblem(null);
    setReason({ picked: null, busy: false, failed: false });
    void read(open);
  }, [open, read]);

  const press = useCallback(
    async (target: BoxFor, when: MyCancelWhen, key: string) => {
      if (busy !== null) return;
      setBusy(when);
      setProblem(null);
      asked.current += 1;
      const number = asked.current;
      const requestKey = lost.keyFor(target.membershipId, when, key);
      const answer = await session.signedIn({ method: "POST", path: myCancelPath(gymId, target.membershipId), body: { requestKey, when, key } }, myCancelDoneSchema);
      if (!live.current || number !== asked.current) return;
      setBusy(null);
      if (answer.kind === "ok") {
        setStep({ kind: "done", done: answer.data });
        onDone(target.membershipId, answer.data.line);
        return;
      }
      if (answer.kind === "no_answer") {
        // It may have gone through: never said as cancelled, and pressed again it is the same press.
        lost.keep({ membershipId: target.membershipId, what: when, key, requestKey });
        setProblem({ line: NO_ANSWER_PRESS, final: false });
        return;
      }
      const refused = refusedLine(answer.status, answer.error, answer.message);
      setProblem({ line: refused.line, final: refused.final });
      if (refused.reread) await read(target);
    },
    [busy, session, gymId, lost, onDone, read],
  );

  const sendReason = useCallback(
    async (cancelId: string, picked: MyCancelReason) => {
      if (reason.busy) return;
      setReason({ picked, busy: true, failed: false });
      const answer = await session.signedIn({ method: "POST", path: myCancelReasonPath(gymId, cancelId), body: { reason: picked } }, myCancelReasonRequestSchema);
      if (!live.current) return;
      if (answer.kind === "ok") {
        onClose();
        return;
      }
      setReason({ picked: null, busy: false, failed: true });
    },
    [reason.busy, session, gymId, onClose],
  );

  const title = open === null ? "" : step.kind === "ask" ? cancelTitle(step.ask.membership.name) : cancelTitle(open.name);
  return (
    <Sheet open={open !== null} title={step.kind === "done" ? MY_CANCEL_REASON_QUESTION : title} onClose={onClose}>
      {open === null ? null : (
        <ScrollView testID="cancel-box" style={[styles.scroll, { maxHeight: height * RECEIPT_MOST }]} contentContainerStyle={styles.body}>
          {step.kind === "loading" && problem === null ? <Txt kind="small">Loading…</Txt> : null}
          {step.kind === "failed" ? (
            <>
              <Txt colour="badText">{COULD_NOT_READ}</Txt>
              <Button
                label="Try again"
                kind="soft"
                onPress={() => {
                  setStep({ kind: "loading" });
                  void read(open);
                }}
              />
            </>
          ) : null}
          {step.kind === "ask" ? (
            <>
              {step.ask.choices.map((c) => (
                <View key={c.when} testID={`cancel-way-${c.when}`} style={styles.way}>
                  {c.lines.map((line) => (
                    <Txt key={line} colour="text">
                      {line}
                    </Txt>
                  ))}
                  {problem?.final === true ? null : (
                    <Button label={c.button} kind="danger" wide busy={busy === c.when} disabled={busy !== null && busy !== c.when} onPress={() => void press(open, c.when, c.key)} />
                  )}
                </View>
              ))}
              {step.ask.notes.map((note) => (
                <Txt key={note} colour="textSoft">
                  {note}
                </Txt>
              ))}
            </>
          ) : null}
          {step.kind === "done" ? (
            <>
              <View testID="cancel-done" style={styles.way}>
                <Txt colour="goodText">{step.done.line}</Txt>
                {step.done.emailed ? <Txt kind="small">{EMAILED}</Txt> : null}
              </View>
              <Options options={REASON_OPTIONS} selected={reason.picked} disabled={reason.busy} onPick={(r) => void sendReason(step.done.cancelId, r)} />
              {reason.failed ? <Txt colour="badText">{REASON_NOT_SAVED}</Txt> : null}
              <Button label={SKIP} kind="plain" wide disabled={reason.busy} onPress={onClose} />
            </>
          ) : null}
          {problem === null ? null : (
            <View testID="cancel-problem">
              <Txt colour="badText">{problem.line}</Txt>
            </View>
          )}
          {step.kind === "done" ? null : <Button label={step.kind === "ask" && step.ask.choices.length > 0 && problem?.final !== true ? GO_BACK : CLOSE} kind="plain" wide onPress={onClose} />}
        </ScrollView>
      )}
    </Sheet>
  );
}

/** The box under Keep my membership: the next payment and the card, and one button; once kept, said in the box. */
export function KeepBox({ gymId, open, onDone, onClose }: { gymId: string; open: BoxFor | null; onDone: (membershipId: string, line: string) => void; onClose: () => void }) {
  const { session } = useSession();
  const { height } = useWindowDimensions();
  const [step, setStep] = useState<Step<MyKeepAsk, MyKeepDone>>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ line: string; final: boolean } | null>(null);
  const lost = useLostPress();
  const asked = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const read = useCallback(
    async (target: BoxFor) => {
      asked.current += 1;
      const number = asked.current;
      const answer = await session.signedIn({ method: "GET", path: myKeepPath(gymId, target.membershipId) }, myKeepAskSchema);
      if (!live.current || number !== asked.current) return;
      if (answer.kind === "ok" && answer.data.membership.id === target.membershipId) setStep({ kind: "ask", ask: answer.data });
      else if (answer.kind === "refused") setProblem({ line: refusedLine(answer.status, answer.error, answer.message).line, final: true });
      else setStep({ kind: "failed" });
    },
    [session, gymId],
  );

  useEffect(() => {
    if (open === null) return;
    setStep({ kind: "loading" });
    setBusy(false);
    setProblem(null);
    void read(open);
  }, [open, read]);

  const press = useCallback(
    async (target: BoxFor, key: string) => {
      if (busy) return;
      setBusy(true);
      setProblem(null);
      asked.current += 1;
      const number = asked.current;
      const requestKey = lost.keyFor(target.membershipId, "keep", key);
      const answer = await session.signedIn({ method: "POST", path: myKeepPath(gymId, target.membershipId), body: { requestKey, key } }, myKeepDoneSchema);
      if (!live.current || number !== asked.current) return;
      setBusy(false);
      if (answer.kind === "ok") {
        setStep({ kind: "done", done: answer.data });
        onDone(target.membershipId, answer.data.line);
        return;
      }
      if (answer.kind === "no_answer") {
        lost.keep({ membershipId: target.membershipId, what: "keep", key, requestKey });
        setProblem({ line: NO_ANSWER_PRESS, final: false });
        return;
      }
      const refused = refusedLine(answer.status, answer.error, answer.message);
      setProblem({ line: refused.line, final: refused.final });
      if (refused.reread) await read(target);
    },
    [busy, session, gymId, lost, onDone, read],
  );

  const title = open === null ? "" : step.kind === "done" ? open.name : keepTitle(step.kind === "ask" ? step.ask.membership.name : open.name);
  const choice = step.kind === "ask" ? step.ask.choice : null;
  return (
    <Sheet open={open !== null} title={title} onClose={onClose}>
      {open === null ? null : (
        <ScrollView testID="keep-box" style={[styles.scroll, { maxHeight: height * RECEIPT_MOST }]} contentContainerStyle={styles.body}>
          {step.kind === "loading" && problem === null ? <Txt kind="small">Loading…</Txt> : null}
          {step.kind === "failed" ? (
            <>
              <Txt colour="badText">{COULD_NOT_READ}</Txt>
              <Button
                label="Try again"
                kind="soft"
                onPress={() => {
                  setStep({ kind: "loading" });
                  void read(open);
                }}
              />
            </>
          ) : null}
          {step.kind === "ask" ? (
            <>
              {choice === null
                ? null
                : choice.lines.map((line) => (
                    <Txt key={line} colour="text">
                      {line}
                    </Txt>
                  ))}
              {step.ask.notes.map((note) => (
                <Txt key={note} colour="textSoft">
                  {note}
                </Txt>
              ))}
              {choice === null || problem?.final === true ? null : <Button label={choice.button} wide busy={busy} onPress={() => void press(open, choice.key)} />}
            </>
          ) : null}
          {step.kind === "done" ? (
            <View testID="keep-done" style={styles.way}>
              <Txt colour="goodText">{step.done.line}</Txt>
              {step.done.emailed ? <Txt kind="small">{EMAILED}</Txt> : null}
            </View>
          ) : null}
          {problem === null ? null : (
            <View testID="keep-problem">
              <Txt colour="badText">{problem.line}</Txt>
            </View>
          )}
          <Button label={step.kind === "done" ? DONE : choice !== null && problem?.final !== true ? GO_BACK : CLOSE} kind="plain" wide onPress={onClose} />
        </ScrollView>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  // Room round the buttons, so the main one's glow is not cut off by the scroll's edge.
  scroll: { marginHorizontal: -14 },
  body: { gap: 14, paddingHorizontal: 14, paddingBottom: 18 },
  way: { gap: 10 },
});
