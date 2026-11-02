import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { myOrgsResponseSchema } from "@app/shared";
import { useSession } from "../session/SessionProvider";
import { newMessagesAt } from "./gym/inboxView";

// The kinds of place the person is a member of, read once when the tabs open and again by the
// Gym tab, so the tab's own word under its icon is the place's ("Studio" for a yoga studio), and with them
// how many new messages wait at those places, so the tab's dot is lit while any do.

interface Places {
  /** Null until the first read has answered. */
  kinds: readonly unknown[] | null;
  setKinds: (kinds: readonly unknown[]) => void;
  /** New messages at all the person's places, as the server last said it; 0 until read. */
  newMessages: number;
  setNewMessages: (count: number) => void;
}

/** How many seconds the tabs wait for the sign-in to reach the server before giving up asking. */
const PLACES_WAIT_TICKS = 30;

const PlacesContext = createContext<Places>({ kinds: null, setKinds: () => undefined, newMessages: 0, setNewMessages: () => undefined });

export const usePlaces = () => useContext(PlacesContext);

export function PlacesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [kinds, setKinds] = useState<readonly unknown[] | null>(null);
  const [newMessages, setNewMessages] = useState(0);
  useEffect(() => {
    const run = { live: true };
    const read = async () => {
      const answer = await session.signedIn({ method: "GET", path: "/v1/orgs/mine" }, myOrgsResponseSchema);
      if (run.live && answer.kind === "ok") {
        setKinds((now) => now ?? answer.data.orgs.filter((org) => org.isMember).map((org) => org.orgType));
        setNewMessages(newMessagesAt(answer.data.orgs));
      }
    };
    // Asked once the phone has reached the server (its sign-in refreshed), never as a try of its own:
    // with no internet it asks nothing, and the tab keeps its own word.
    let waited = 0;
    const tick = setInterval(() => {
      waited += 1;
      if (session.accessToken() !== null) {
        clearInterval(tick);
        void read();
      } else if (waited >= PLACES_WAIT_TICKS) clearInterval(tick);
    }, 1_000);
    if (session.accessToken() !== null) {
      clearInterval(tick);
      void read();
    }
    return () => {
      run.live = false;
      clearInterval(tick);
    };
  }, [session]);
  const value = useMemo(() => ({ kinds, setKinds, newMessages, setNewMessages }), [kinds, newMessages]);
  return <PlacesContext.Provider value={value}>{children}</PlacesContext.Provider>;
}
