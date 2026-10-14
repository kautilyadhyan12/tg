import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import type { Server } from "./calls";
import { createSession, type KeyStore, type Session, type SessionState } from "./session";

const SessionContext = createContext<{ session: Session; state: SessionState } | null>(null);

/** Who is signed in on this phone, for every screen under it. */
export function SessionProvider({
  server,
  store,
  wait,
  children,
}: {
  server: Server;
  store: KeyStore;
  /** A test's stand-in for the pause between two tries of a refresh. */
  wait?: ((ms: number) => Promise<void>) | undefined;
  children: ReactNode;
}) {
  const [state, setState] = useState<SessionState>({ kind: "starting" });
  const session = useMemo(
    () => createSession({ server, store, onChange: setState, ...(wait === undefined ? {} : { wait }) }),
    [server, store, wait],
  );

  useEffect(() => {
    void session.start();
    // Coming back to the app is when an older phone learns it was signed out.
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") void session.refreshIfDue();
    });
    return () => {
      heard.remove();
    };
  }, [session]);

  const value = useMemo(() => ({ session, state }), [session, state]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): { session: Session; state: SessionState } {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession needs a SessionProvider above it");
  return value;
}
