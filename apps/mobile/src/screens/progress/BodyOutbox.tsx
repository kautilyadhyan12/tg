import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { useSession } from "../../session/SessionProvider";
import type { TextStore } from "../food/outbox";
import { bodySender, createBodyOutbox, type BodyOutbox, type BodyOutboxView } from "./bodyQueue";

/** While something waits, it is sent again this often, besides on opening and coming back to the app. */
export const BODY_SEND_AGAIN_MS = 15_000;

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
