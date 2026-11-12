import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { appPaymentResponseSchema, myAppPaymentsResponseSchema, type AppPayment } from "@app/shared";
import { openInTab } from "../../look/browserTab";
import { colours } from "../../look/colours";
import { useSession } from "../../session/SessionProvider";
import { newRequestKey } from "./classesView";
import { forgetPayAway, keepPayAway } from "./payAway";
import {
  PAY_CHECKING,
  PAY_NOT_OPENED,
  PAY_NO_ANSWER,
  PAY_NO_ANSWER_PRESS,
  PAY_OPENING,
  PAY_WAITING,
  endedSaid,
  keyOfPayment,
  myPaymentClosePath,
  myPaymentsPath,
  payBody,
  payRefusalSaid,
  type PaySaid,
  type PayTarget,
} from "./payView";

// Pay on My membership (ROADMAP Stage 5 item 20f). One bill or fee at a time: Pay asks the server for Square's page and
// opens it in a tab over the app. Once they are back (the tab closed, or the app in front again), the page is closed at
// Square, which records it instead where it was paid, and what happened is said under that bill or fee. A page found
// still open when the place is read (the app was closed meanwhile) is ended the same way, so the front desk is never kept
// waiting on it.

/** Said while the tab is over the app. */
export const PAY_AWAY = "Complete your payment in the checkout window.";

export interface PayInApp {
  /** This place takes payments in the app now. */
  inApp: boolean;
  /** The bill or fee whose Pay is at work, and what it is doing. */
  busy: { key: string; line: string } | null;
  /** What happened last, under its bill or fee. */
  said: { key: string; said: PaySaid } | null;
  pay: (target: PayTarget) => void;
  /** Asks again how the page that was not answered ended. */
  checkAgain: () => void;
}

interface Away {
  key: string;
  payment: AppPayment;
  /** The app went behind the tab: coming to the front again means they left Square's page. */
  left: boolean;
  /** The tab has not answered yet. An iPhone's answers only once it is closed, and until then the app going behind and
   *  coming back (the Apple Pay sheet, Face ID, the bank's app for a card check) is the member still paying. */
  tabOpen: boolean;
}

export function usePayInApp(gymId: string, onEnded: () => void): PayInApp {
  const { session, state } = useSession();
  const userId = state.kind === "in" ? state.user.id : null;
  const [inApp, setInApp] = useState(false);
  const [busy, setBusy] = useState<{ key: string; line: string } | null>(null);
  const [said, setSaid] = useState<{ key: string; said: PaySaid } | null>(null);
  const live = useRef(true);
  const busyNow = useRef(false);
  const away = useRef<Away | null>(null);
  // The pages being ended now, so a read of the place and the return from the tab never end one twice.
  const ending = useRef(new Set<string>());
  // A page whose end was not answered, for Check again.
  const unanswered = useRef<{ key: string; payment: AppPayment } | null>(null);
  // A press whose answer was lost keeps its key: pressed again, the server gives back the page it may have made.
  const lostPress = useRef<{ key: string; requestKey: string } | null>(null);
  // A press on its way: a read of the place answered meanwhile must not end the page it is making.
  const pressing = useRef(false);
  const gone = useCallback(() => !live.current, []);
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);

  const working = useCallback((now: { key: string; line: string } | null) => {
    busyNow.current = now !== null;
    setBusy(now);
  }, []);

  const finish = useCallback(
    async (key: string, payment: AppPayment, notOpened = false) => {
      if (ending.current.has(payment.id)) return;
      ending.current.add(payment.id);
      unanswered.current = null;
      working({ key, line: PAY_CHECKING });
      const answer = await session.signedIn({ method: "POST", path: myPaymentClosePath(gymId, payment.id) }, appPaymentResponseSchema);
      ending.current.delete(payment.id);
      if (!live.current) return;
      working(null);
      if (answer.kind === "ok") {
        const how = endedSaid(answer.data.payment);
        if (how === null) {
          // Square has not said yet: the page stays held until it does, and Check again asks.
          unanswered.current = { key, payment: answer.data.payment };
          setSaid({ key, said: { tone: "warn", line: PAY_WAITING, again: true } });
          return;
        }
        void forgetPayAway();
        // A page that never opened says so, unless Square says it was paid after all.
        setSaid({ key, said: notOpened && answer.data.payment.state === "closed" ? { tone: "bad", line: PAY_NOT_OPENED } : how });
        ended.current();
        return;
      }
      if (answer.kind === "no_answer") {
        unanswered.current = { key, payment };
        setSaid({ key, said: { tone: "bad", line: PAY_NO_ANSWER, again: true } });
        return;
      }
      void forgetPayAway();
      setSaid({ key, said: payRefusalSaid(answer.error, answer.message) });
      ended.current();
    },
    [session, gymId, working],
  );

  const readPayments = useCallback(async () => {
    const answer = await session.signedIn({ method: "GET", path: myPaymentsPath(gymId) }, myAppPaymentsResponseSchema);
    if (!live.current || answer.kind !== "ok") return;
    setInApp(answer.data.inApp);
    // A page left open while the app was closed: they are not on it now. Never one they are on, or one a press is making.
    if (away.current !== null || pressing.current) return;
    for (const payment of answer.data.open) {
      const key = keyOfPayment(payment);
      if (key !== null && payment.state === "open") void finish(key, payment);
    }
  }, [session, gymId, finish]);

  useEffect(() => {
    live.current = true;
    void readPayments();
    const back = AppState.addEventListener("change", (state) => {
      const there = away.current;
      if (state !== "active") {
        if (there !== null) there.left = true;
        return;
      }
      if (there !== null && there.left && !there.tabOpen) {
        away.current = null;
        void finish(there.key, there.payment);
        return;
      }
      if (there === null) void readPayments();
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [readPayments, finish]);

  const pay = useCallback(
    (target: PayTarget) => {
      if (busyNow.current || away.current !== null) return;
      const lost = lostPress.current?.key === target.key ? lostPress.current.requestKey : null;
      lostPress.current = null;
      setSaid(null);
      working({ key: target.key, line: PAY_OPENING });
      pressing.current = true;
      void (async () => {
        const send = (requestKey: string) => session.signedIn({ method: "POST", path: myPaymentsPath(gymId), body: payBody(target, requestKey) }, appPaymentResponseSchema);
        let requestKey = lost ?? newRequestKey();
        let answer: Awaited<ReturnType<typeof send>>;
        try {
          answer = await send(requestKey);
          // The page a lost press made has ended since (left open, then closed): this press asks for a page of its own.
          if (lost !== null && answer.kind === "ok" && answer.data.payment.state === "closed") {
            requestKey = newRequestKey();
            answer = await send(requestKey);
          }
        } finally {
          pressing.current = false;
        }
        if (!live.current) return;
        if (answer.kind === "no_answer") {
          lostPress.current = { key: target.key, requestKey };
          working(null);
          setSaid({ key: target.key, said: { tone: "bad", line: PAY_NO_ANSWER_PRESS } });
          return;
        }
        if (answer.kind !== "ok") {
          working(null);
          const refused = payRefusalSaid(answer.error, answer.message);
          setSaid({ key: target.key, said: refused });
          if (refused.tone === "warn") ended.current();
          return;
        }
        const payment = answer.data.payment;
        // The same press already ended (paid, closed or for the desk to check): said as it is.
        const how = endedSaid(payment);
        if (how !== null) {
          working(null);
          setSaid({ key: target.key, said: how });
          ended.current();
          return;
        }
        if (payment.url === null) {
          working(null);
          void finish(target.key, payment, true);
          return;
        }
        const there: Away = { key: target.key, payment, left: false, tabOpen: true };
        away.current = there;
        // Android may close the app behind the tab: kept, the app opens this place's My membership when it starts again.
        if (userId !== null) await keepPayAway(userId, gymId);
        // The page may have closed while it was kept: a ref read again after an await.
        if (gone()) return;
        working({ key: target.key, line: PAY_AWAY });
        try {
          const opened = await openInTab(payment.url, { bar: colours.page, controls: colours.orange });
          if (away.current !== there) return;
          // On an iPhone the tab says when it closes; on Android it only opens, and the app learns they are back when it
          // comes to the front again.
          there.tabOpen = false;
          if (opened === "closed" || (there.left && AppState.currentState === "active")) {
            away.current = null;
            working(null);
            void finish(there.key, there.payment);
          }
        } catch {
          if (away.current === there) away.current = null;
          working(null);
          void finish(there.key, there.payment, true);
        }
      })();
    },
    [session, gymId, finish, working, userId, gone],
  );

  const checkAgain = useCallback(() => {
    const waiting = unanswered.current;
    if (waiting === null || busyNow.current) return;
    void finish(waiting.key, waiting.payment);
  }, [finish]);

  return { inApp, busy, said, pay, checkAgain };
}
