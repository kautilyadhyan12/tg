import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { myOrgsResponseSchema, type MyOrgsResponse } from "@app/shared";
import { useSession } from "../session/SessionProvider";

// The kinds of place the person is a member of, read once when the tabs open and again by the
// Gym tab, so the tab's own word under its icon is the place's ("Studio" for a yoga studio), and with them
// how many new messages wait at those places, so the tab's dot is lit while any do. The count is read
// again when the app comes back, at most every 30 seconds: a phone is left on another tab for days.

interface Places {
  /** Null until the first read has answered. */
  kinds: readonly unknown[] | null;
  setKinds: (kinds: readonly unknown[]) => void;
  /** New messages at all the person's places; 0 until read. The tab's dot is lit while it is more. */
  newMessages: number;
  /** A place's count of new messages, or null before the places are read. */
  unreadOf: (gymId: string) => number | null;
  /** Numbers a read of the places as it starts; `placesRead` takes its answer with that number. */
  startRead: () => number;
  /** A read's answer, unless a read that started after it has already answered. */
  placesRead: (number: number, orgs: MyOrgsResponse["orgs"]) => void;
  /** What a place's Inbox last said: kept over a read of the places that started before it. */
  inboxSaid: (gymId: string, unread: number) => void;
}

/** How many seconds the tabs wait for the sign-in to reach the server before giving up asking. */
const PLACES_WAIT_TICKS = 30;
/** The count of new messages is read again when the app comes back, at most this often. */
const COUNT_READ_AGAIN_MS = 30_000;

const PlacesContext = createContext<Places>({
  kinds: null,
  setKinds: () => undefined,
  newMessages: 0,
  unreadOf: () => null,
  startRead: () => 0,
  placesRead: () => undefined,
  inboxSaid: () => undefined,
});

export const usePlaces = () => useContext(PlacesContext);

export function PlacesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [kinds, setKinds] = useState<readonly unknown[] | null>(null);
  // Each place's count, from the newest read of the places to answer, and what an Inbox said since.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [said, setSaid] = useState<Record<string, { unread: number; after: number }>>({});
  const started = useRef(0);
  const applied = useRef(0);

  const startRead = useCallback(() => {
    started.current += 1;
    return started.current;
  }, []);
  const placesRead = useCallback((number: number, orgs: MyOrgsResponse["orgs"]) => {
    if (number < applied.current) return;
    applied.current = number;
    setCounts(Object.fromEntries(orgs.filter((org) => org.isMember).map((org) => [org.id, org.newMessages])));
    setSaid((was) => Object.fromEntries(Object.entries(was).filter(([, one]) => one.after >= number)));
  }, []);
  const inboxSaid = useCallback((gymId: string, unread: number) => {
    setSaid((was) => ({ ...was, [gymId]: { unread, after: started.current } }));
  }, []);

  useEffect(() => {
    const run = { live: true, readAt: 0 };
    const read = async () => {
      run.readAt = Date.now();
      const number = startRead();
      const answer = await session.signedIn({ method: "GET", path: "/v1/orgs/mine" }, myOrgsResponseSchema);
      if (run.live && answer.kind === "ok") {
        setKinds((now) => now ?? answer.data.orgs.filter((org) => org.isMember).map((org) => org.orgType));
        placesRead(number, answer.data.orgs);
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
    const back = AppState.addEventListener("change", (state) => {
      if (state === "active" && session.accessToken() !== null && Date.now() - run.readAt >= COUNT_READ_AGAIN_MS) void read();
    });
    return () => {
      run.live = false;
      clearInterval(tick);
      back.remove();
    };
  }, [session, startRead, placesRead]);

  const value = useMemo(() => {
    const unreadOf = (gymId: string) => said[gymId]?.unread ?? counts[gymId] ?? null;
    const newMessages = Object.keys(counts).reduce((sum, gymId) => sum + (unreadOf(gymId) ?? 0), 0);
    return { kinds, setKinds, newMessages, unreadOf, startRead, placesRead, inboxSaid };
  }, [kinds, counts, said, startRead, placesRead, inboxSaid]);
  return <PlacesContext.Provider value={value}>{children}</PlacesContext.Provider>;
}
