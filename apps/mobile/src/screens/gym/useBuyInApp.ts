import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { appPurchaseResponseSchema, type AppPurchase, type AppPurchaseRequest } from "@app/shared";
import { openInTab } from "../../look/browserTab";
import { colours } from "../../look/colours";
import { useSession } from "../../session/SessionProvider";
import type { BankCheckOutcome } from "./BankCheck";
import { CHARGING, CHECKING_BANK, bankSaid, buyRefusalSaid, endedBuySaid, purchaseClosePath, purchasesPath, withPass, type BuySaid } from "./buyView";
import { newRequestKey } from "./classesView";
import { forgetPayAway, keepPayAway } from "./payAway";
import { PAY_CHECKING, PAY_NO_ANSWER, PAY_NOT_OPENED, PAY_OPENING } from "./payView";
import { PAY_AWAY } from "./usePayInApp";

// Buy in the app (ROADMAP Stage 5 item 20g). One line at a time: Pay asks the server for Square's page for exactly what
// the line's page showed, and opens it in a tab over the app. Once they are back (the tab closed, or the app in front
// again) the page is closed at Square, which records it instead where it was paid, and how it ended is said where Pay
// was. Only the server's `paid` ever reads as bought. Android may close the app behind the tab: the purchase is kept on
// the phone, and Buy ends it when the app starts again (`resume`). The tab's comings and goings are 20f's (`usePayInApp`).
// A repeating membership (20i-i) opens no tab: Pay charges the saved card, and the answer is paid, or Square still to say
// (Check status asks again), or the server's sentence why nothing was charged.

/** Where what happened is said: a line's page (its type id), or Buy's list for a page ended after the app started again. */
export const RESUMED = "resumed";

export interface BuyInApp {
  /** The line whose Pay is at work, and what it is doing. */
  busy: { at: string; line: string } | null;
  /** What happened last, where. */
  said: { at: string; said: BuySaid } | null;
  /** A purchase Square took and the server gave, where. */
  paid: { at: string; purchase: AppPurchase } | null;
  /** Pay: the line's body without its key. */
  /** `check`: the bank's check before a repeating membership is charged (20i-ii), ending with Square's pass or why not. */
  pay: (typeId: string, body: Omit<AppPurchaseRequest, "requestKey">, check?: () => Promise<BankCheckOutcome>) => void;
  /** Asks again how the page that was not answered ended. */
  checkAgain: () => void;
  /** Ends a page kept from before the app was closed. */
  resume: (purchaseId: string) => void;
  /** Forgets what was said (another line opened). */
  clear: () => void;
  /** Closes the box saying how a page ended: forgets it, and what was bought. */
  dismiss: () => void;
  /** The line whose card charge Square has not answered yet (20i-i): its page says so, with Check status, in place of Pay. */
  waiting: string | null;
}

interface Away {
  at: string;
  purchase: AppPurchase;
  /** The app went behind the tab: coming to the front again means they left Square's page. */
  left: boolean;
  /** The tab has not answered yet (an iPhone's answers once it is closed; until then the app going behind and coming back
   *  is the member still paying). */
  tabOpen: boolean;
}

export function useBuyInApp(gymId: string, onEnded: () => void): BuyInApp {
  const { session, state } = useSession();
  const userId = state.kind === "in" ? state.user.id : null;
  const [busy, setBusy] = useState<{ at: string; line: string } | null>(null);
  const [said, setSaid] = useState<{ at: string; said: BuySaid } | null>(null);
  const [paid, setPaid] = useState<{ at: string; purchase: AppPurchase } | null>(null);
  const live = useRef(true);
  const busyNow = useRef(false);
  const away = useRef<Away | null>(null);
  // The pages being ended now, so the return from the tab and a resume never end one twice.
  const ending = useRef(new Set<string>());
  // A page whose end was not answered, for Check again.
  const unanswered = useRef<{ at: string; id: string } | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  // A press whose answer was lost keeps its key, for the very same body: pressed again, the server gives back the page it
  // may have made. A changed body (another name typed) is a press of its own. On a card it keeps the pass it sent too, so
  // the same press is sent again without asking the bank twice (20i-ii).
  const lostPress = useRef<{ typeId: string; body: string; requestKey: string; sent: Omit<AppPurchaseRequest, "requestKey"> } | null>(null);
  // Purchases charged to the card, not paid on a page: closed reads as nothing taken, never as cancelled.
  const charged = useRef(new Set<string>());
  const gone = useCallback(() => !live.current, []);
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);

  // A charge Square has not answered is said on its line's page too, so closing the box never hides it.
  const leave = useCallback((now: { at: string; id: string } | null) => {
    unanswered.current = now;
    setWaiting(now !== null && charged.current.has(now.id) ? now.at : null);
  }, []);

  const working = useCallback((now: { at: string; line: string } | null) => {
    busyNow.current = now !== null;
    setBusy(now);
  }, []);

  const finish = useCallback(
    async (at: string, purchaseId: string, notOpened = false) => {
      if (ending.current.has(purchaseId)) return;
      ending.current.add(purchaseId);
      leave(null);
      working({ at, line: PAY_CHECKING });
      const answer = await session.signedIn({ method: "POST", path: purchaseClosePath(gymId, purchaseId) }, appPurchaseResponseSchema);
      ending.current.delete(purchaseId);
      // A page that has ended is let go on the phone even where Buy was closed meanwhile, so the app does not open it again.
      if (answer.kind === "ok" && answer.data.purchase.id === purchaseId && answer.data.purchase.state !== "open") void forgetPayAway(purchaseId);
      if (!live.current) return;
      working(null);
      if (answer.kind === "ok") {
        const purchase = answer.data.purchase;
        if (purchase.id !== purchaseId) {
          // An answer about another page is no answer about this one.
          leave({ at, id: purchaseId });
          setSaid({ at, said: { tone: "bad", line: PAY_NO_ANSWER, again: true, ended: true } });
          return;
        }
        if (purchase.state === "paid") {
          void forgetPayAway(purchaseId);
          setPaid({ at, purchase });
          ended.current();
          return;
        }
        const how = endedBuySaid(purchase, charged.current.has(purchaseId));
        if (purchase.state === "open") {
          // Square has not said yet: the page stays held until it does, and Check again asks.
          leave({ at, id: purchaseId });
          if (how !== null) setSaid({ at, said: how });
          return;
        }
        void forgetPayAway(purchaseId);
        if (how !== null) setSaid({ at, said: notOpened && purchase.state === "closed" ? { tone: "bad", line: PAY_NOT_OPENED, ended: true } : how });
        ended.current();
        return;
      }
      // No answer, too many asks or the server failing says nothing of how the page ended: it stays held, and Check again asks.
      if (answer.kind === "no_answer" || answer.status >= 429) {
        leave({ at, id: purchaseId });
        setSaid({ at, said: { tone: "bad", line: PAY_NO_ANSWER, again: true, ended: true } });
        return;
      }
      void forgetPayAway(purchaseId);
      setSaid({ at, said: { ...buyRefusalSaid(answer.error, answer.message), ended: true } });
      ended.current();
    },
    [session, gymId, working, leave],
  );

  useEffect(() => {
    live.current = true;
    const back = AppState.addEventListener("change", (now) => {
      const there = away.current;
      if (there === null) return;
      if (now !== "active") {
        there.left = true;
        return;
      }
      if (there.left && !there.tabOpen) {
        away.current = null;
        void finish(there.at, there.purchase.id);
      }
    });
    return () => {
      live.current = false;
      back.remove();
    };
  }, [finish]);

  const pay = useCallback(
    (typeId: string, body: Omit<AppPurchaseRequest, "requestKey">, check?: () => Promise<BankCheckOutcome>) => {
      if (busyNow.current || away.current !== null) return;
      const bodyKey = JSON.stringify(body);
      const lost = lostPress.current !== null && lostPress.current.typeId === typeId && lostPress.current.body === bodyKey ? lostPress.current : null;
      lostPress.current = null;
      setSaid(null);
      setPaid(null);
      const card = body.charge !== undefined;
      // A repeating membership asks the card's bank first (20i-ii), unless it is the same press sent again.
      const asking = card && lost === null;
      working({ at: typeId, line: asking ? CHECKING_BANK : card ? CHARGING : PAY_OPENING });
      void (async () => {
        let sent = lost?.sent ?? body;
        if (asking) {
          const outcome = check === undefined ? ({ kind: "not_reached" } as const) : await check();
          if (!live.current) return;
          if (outcome.kind !== "pass") {
            working(null);
            setSaid({ at: typeId, said: bankSaid(outcome.kind) });
            return;
          }
          sent = withPass(body, outcome.pass);
          working({ at: typeId, line: CHARGING });
        }
        const send = (requestKey: string) => session.signedIn({ method: "POST", path: purchasesPath(gymId), body: { ...sent, requestKey } }, appPurchaseResponseSchema);
        let requestKey = lost?.requestKey ?? newRequestKey();
        let answer = await send(requestKey);
        // The page a lost press made has ended since: this press asks for a page of its own. A card's pass is used once, so
        // a card purchase that ended is said as it ended.
        if (lost !== null && !card && answer.kind === "ok" && answer.data.purchase.state === "closed") {
          requestKey = newRequestKey();
          answer = await send(requestKey);
        }
        if (!live.current) return;
        if (answer.kind === "no_answer") {
          lostPress.current = { typeId, body: bodyKey, requestKey, sent };
          working(null);
          setSaid({ at: typeId, said: { tone: "bad", line: PAY_NO_ANSWER } });
          return;
        }
        if (answer.kind !== "ok") {
          working(null);
          const refused = buyRefusalSaid(answer.error, answer.message);
          setSaid({ at: typeId, said: refused });
          if (refused.reread === true) ended.current();
          return;
        }
        const purchase = answer.data.purchase;
        // A page for another line is never opened as this one's.
        if (purchase.typeId !== typeId) {
          working(null);
          setSaid({ at: typeId, said: { tone: "bad", line: PAY_NOT_OPENED } });
          return;
        }
        // The same press already ended (paid, closed or for the desk to check): said as it is.
        if (purchase.state === "paid") {
          working(null);
          setPaid({ at: typeId, purchase });
          ended.current();
          return;
        }
        if (card) charged.current.add(purchase.id);
        if (purchase.state !== "open") {
          working(null);
          const how = endedBuySaid(purchase, card);
          if (how !== null) setSaid({ at: typeId, said: how });
          ended.current();
          return;
        }
        if (card) {
          // Square has not said yet: Check status asks, and the worker asks too.
          working(null);
          leave({ at: typeId, id: purchase.id });
          setSaid({ at: typeId, said: { ...(endedBuySaid(purchase, true) ?? { tone: "warn", line: PAY_CHECKING }), again: true, ended: true } });
          return;
        }
        if (purchase.url === null) {
          working(null);
          void finish(typeId, purchase.id, true);
          return;
        }
        const there: Away = { at: typeId, purchase, left: false, tabOpen: true };
        away.current = there;
        // Android may close the app behind the tab: kept, the app opens this place's Buy when it starts again.
        if (userId !== null) await keepPayAway(userId, gymId, purchase.id, Date.now(), purchase.id);
        // The page may have closed while it was kept: a ref read again after an await.
        if (gone()) return;
        working({ at: typeId, line: PAY_AWAY });
        try {
          const opened = await openInTab(purchase.url, { bar: colours.page, controls: colours.orange });
          if (away.current !== there) return;
          // On an iPhone the tab says when it closes; on Android it only opens, and the app learns they are back when it
          // comes to the front again.
          there.tabOpen = false;
          if (opened === "closed" || (there.left && AppState.currentState === "active")) {
            away.current = null;
            working(null);
            void finish(there.at, there.purchase.id);
          }
        } catch {
          if (away.current === there) away.current = null;
          working(null);
          void finish(there.at, there.purchase.id, true);
        }
      })();
    },
    [session, gymId, finish, working, userId, gone, leave],
  );

  const checkAgain = useCallback(() => {
    const waiting = unanswered.current;
    if (waiting === null || busyNow.current) return;
    void finish(waiting.at, waiting.id);
  }, [finish]);

  const resume = useCallback(
    (purchaseId: string) => {
      if (away.current !== null) return;
      void finish(RESUMED, purchaseId);
    },
    [finish],
  );

  const clear = useCallback(() => {
    if (busyNow.current) return;
    setSaid(null);
  }, []);

  const dismiss = useCallback(() => {
    if (busyNow.current) return;
    setSaid(null);
    setPaid(null);
  }, []);

  return { busy, said, paid, pay, checkAgain, resume, clear, dismiss, waiting };
}
