import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { myOrgsResponseSchema } from "@app/shared";
import { useSession } from "../session/SessionProvider";

// The kinds of place the person is a member of, read once when the tabs open and again by the
// Gym tab, so the tab's own word under its icon is the place's ("Studio" for a yoga studio).

interface Places {
  /** Null until the first read has answered. */
  kinds: readonly unknown[] | null;
  setKinds: (kinds: readonly unknown[]) => void;
}

/** How many seconds the tabs wait for the sign-in to reach the server before giving up asking. */
const PLACES_WAIT_TICKS = 30;

const PlacesContext =createContext<Places>({ kinds: null, setKinds: () => undefined });

export const usePlaces = () => useContext(PlacesContext);

export function PlacesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const [kinds, setKinds] = useState<readonly unknown[] | null>(null);
  useEffect(() => {
    const run = { live: true };
    const read = async () => {
      const answer = await session.signedIn({ method: "GET", path: "/v1/orgs/mine" }, myOrgsResponseSchema);
      if (run.live && answer.kind === "ok") {
        setKinds((now) => now ?? answer.data.orgs.filter((org) => org.isMember).map((org) => org.orgType));
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
  const value = useMemo(() => ({ kinds, setKinds }), [kinds]);
  return <PlacesContext.Provider value={value}>{children}</PlacesContext.Provider>;
}
