import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppState } from "react-native";
import { useSession } from "../../session/SessionProvider";
import type { TextStore } from "../food/outbox";
import { createRunOutbox, runSender, type RunOutbox, type RunOutboxView } from "./runQueue";

/** While a run waits, it is sent again this often, besides on opening and coming back to the app. */
export const RUN_SEND_AGAIN_MS = 15_000;

const RunOutboxContext = createContext<RunOutbox | null>(null);

/** The signed-in person's saved runs not yet on the server, sent from the moment the tabs open,
 *  whichever page is on screen. Made again for each person, and stopped when they leave. */
export function RunOutboxProvider({ store, children }: { store: (userId: string) => TextStore; children: ReactNode }) {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [outbox, setOutbox] = useState<RunOutbox | null>(null);

  useEffect(() => {
    if (me === null) return undefined;
    const made = createRunOutbox(store(me), runSender(session));
    setOutbox(made);
    const go = () => {
      void made.start().then(() => made.send(), () => undefined);
    };
    go();
    const timer = setInterval(() => {
      if (made.view().waiting.length > 0 || made.view().unsaved) go();
    }, RUN_SEND_AGAIN_MS);
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") go();
    });
    return () => {
      made.stop();
      clearInterval(timer);
      heard.remove();
    };
  }, [me, session, store]);

  return <RunOutboxContext.Provider value={outbox}>{children}</RunOutboxContext.Provider>;
}

const EMPTY: RunOutboxView = { waiting: [], saved: [], refused: [], sent: 0, unsaved: false };
const noListen = () => () => undefined;

/** The outbox and what it holds now; null until the person's file is open. */
export function useRunOutbox(): { outbox: RunOutbox | null; view: RunOutboxView } {
  const outbox = useContext(RunOutboxContext);
  const view = useSyncExternalStore(outbox?.subscribe ?? noListen, () => outbox?.view() ?? EMPTY);
  return { outbox, view };
}
