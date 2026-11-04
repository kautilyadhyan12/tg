import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { bodyMeasurementResponseSchema, type WaitingBodyEntry } from "@app/shared";
import type { Answer, Shape } from "../../session/calls";
import type { Session } from "../../session/session";
import { useSession } from "../../session/SessionProvider";
import type { TextStore } from "../food/outbox";
import { bodySaveBody, createBodyOutbox, type BodyOutbox, type BodyOutboxView, type BodySendResult } from "./bodyQueue";

/** While something waits, it is sent again this often, besides on opening and coming back to the app. */
export const BODY_SEND_AGAIN_MS = 15_000;

/** DELETE answers 204 with no body. */
const nothing: Shape<null> = { safeParse: (raw) => (raw === null ? { success: true, data: null } : { success: false }) };

/** The server cannot take it now: a lost connection, a sign-in being renewed, too many at once, or a
 *  fault of its own. Anything else it refuses, it will refuse again. */
const now = (answer: Answer<unknown>): boolean =>
  answer.kind === "no_answer" || (answer.kind === "refused" && (answer.status === 401 || answer.status === 429 || answer.status >= 500));

export const BODY_REFUSED_WORDS = "These measurements couldn’t be saved. Log them again.";

export function bodySender(session: Session) {
  return {
    save: async (entry: WaitingBodyEntry): Promise<BodySendResult> => {
      const answer = await session.signedIn({ method: "POST", path: "/v1/nutrition/body-measurements", body: bodySaveBody(entry) }, bodyMeasurementResponseSchema);
      if (answer.kind === "ok") return { kind: "done", entry: answer.data.measurement };
      if (now(answer) || answer.kind !== "refused") return { kind: "later" };
      // Removed before this late save arrived: nothing is left to keep.
      if (answer.status === 404) return { kind: "done" };
      return { kind: "refused", message: BODY_REFUSED_WORDS };
    },
    remove: async (id: string): Promise<BodySendResult> => {
      const answer = await session.signedIn({ method: "DELETE", path: `/v1/nutrition/body-measurements/${id}` }, nothing);
      if (answer.kind === "ok") return { kind: "done" };
      // Already gone, or never there: nothing is left to remove.
      return now(answer) ? { kind: "later" } : { kind: "done" };
    },
  };
}

const BodyOutboxContext = createContext<BodyOutbox | null>(null);

/** The signed-in person's waiting measurements, sent from the moment the tabs open, whichever page is
 *  on screen. Made again for each person, and stopped when they leave. */
export function BodyOutboxProvider({ store, children }: { store: (userId: string) => TextStore; children: ReactNode }) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [outbox, setOutbox] = useState<BodyOutbox | null>(null);

  useEffect(() => {
    if (me === null) return undefined;
    const made = createBodyOutbox(store(me), bodySender(session));
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
    }, BODY_SEND_AGAIN_MS);
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") go();
    });
    return () => {
      made.stop();
      clearInterval(timer);
      heard.remove();
    };
  }, [me, session, store]);

  return <BodyOutboxContext.Provider value={outbox}>{children}</BodyOutboxContext.Provider>;
}

const EMPTY: BodyOutboxView = { waiting: [], landed: [], removing: new Set(), refused: [], sent: 0, unsaved: false };
const noListen = () => () => undefined;

/** The outbox and what it holds now; null until the person's file is open. */
export function useBodyOutbox(): { outbox: BodyOutbox | null; view: BodyOutboxView } {
  const outbox = useContext(BodyOutboxContext);
  const view = useSyncExternalStore(outbox?.subscribe ?? noListen, () => outbox?.view() ?? EMPTY);
  return { outbox, view };
}
