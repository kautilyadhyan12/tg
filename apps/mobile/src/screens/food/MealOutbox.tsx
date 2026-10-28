import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { mealResponseSchema, type WaitingMeal } from "@app/shared";
import type { Answer, Shape } from "../../session/calls";
import type { Session } from "../../session/session";
import { useSession } from "../../session/SessionProvider";
import { createOutbox, type Outbox, type OutboxView, type SendResult, type TextStore } from "./outbox";

/** While something waits, it is sent again this often, besides on opening and coming back to the app. */
export const SEND_AGAIN_MS = 15_000;

/** DELETE answers 204 with no body. */
const nothing: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

/** The server cannot take it now: a lost connection, a sign-in being renewed, too many at once, or a
 *  fault of its own. Anything else it refuses, it will refuse again. */
const now = (answer: Answer<unknown>): boolean =>
  answer.kind === "no_answer" || (answer.kind === "refused" && (answer.status === 401 || answer.status === 429 || answer.status >= 500));

const REFUSED_WORDS = "This meal couldn't be saved. Add it again.";

export function mealSender(session: Session) {
  return {
    save: async (meal: WaitingMeal): Promise<SendResult> => {
      const answer = await session.signedIn({ method: "POST", path: "/v1/nutrition/meals", body: meal.body }, mealResponseSchema);
      if (answer.kind === "ok") return { kind: "done", meal: answer.data.meal };
      if (now(answer) || answer.kind !== "refused") return { kind: "later" };
      // A shape the server would not read is the app's fault, never words for the person.
      return { kind: "refused", message: answer.error === "validation_error" ? REFUSED_WORDS : answer.message };
    },
    remove: async (id: string): Promise<SendResult> => {
      const answer = await session.signedIn({ method: "DELETE", path: `/v1/nutrition/meals/${id}` }, nothing);
      if (answer.kind === "ok") return { kind: "done" };
      // Already gone, or never there: nothing is left to remove.
      return now(answer) ? { kind: "later" } : { kind: "done" };
    },
  };
}

const OutboxContext = createContext<Outbox | null>(null);

/** The signed-in person's waiting meals, sent from the moment the tabs open, whichever tab is on
 *  screen. Made again for each person (the tabs are), and stopped when they leave. */
export function MealOutboxProvider({ store, children }: { store: (userId: string) => TextStore; children: ReactNode }) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [outbox, setOutbox] = useState<Outbox | null>(null);

  useEffect(() => {
    if (me === null) return undefined;
    const made = createOutbox(store(me), mealSender(session));
    setOutbox(made);
    const go = () => {
      void made.send();
    };
    // A file that could not be read is read again, never written over.
    let ready = false;
    const begin = () => {
      void made.start().then(() => {
        ready = true;
        go();
      }, () => undefined);
    };
    begin();
    const timer = setInterval(() => {
      if (!ready) begin();
      else if (made.view().waiting.length > 0 || made.view().removing.size > 0) go();
    }, SEND_AGAIN_MS);
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") go();
    });
    return () => {
      made.stop();
      clearInterval(timer);
      heard.remove();
    };
  }, [me, session, store]);

  return <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>;
}

const EMPTY: OutboxView = { waiting: [], landed: [], removing: new Set(), refused: [], sent: 0, unsaved: false };
const noListen = () => () => undefined;

/** The outbox and what it holds now; null until the person's file is open. */
export function useMealOutbox(): { outbox: Outbox | null; view: OutboxView } {
  const outbox = useContext(OutboxContext);
  const view = useSyncExternalStore(outbox?.subscribe ?? noListen, () => outbox?.view() ?? EMPTY);
  return { outbox, view };
}
