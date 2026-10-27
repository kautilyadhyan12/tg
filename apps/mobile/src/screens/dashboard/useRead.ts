import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { Shape } from "../../session/calls";
import { useSession } from "../../session/SessionProvider";

/** One read of the person's own numbers. `failed` only when nothing was ever read: a read again that
 *  fails keeps what the screen already shows. */
export type Read<T> = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "failed" };

/** A signed-in GET, read when the page opens, when its tab is pressed again and when the app comes
 *  back to the front. Its answer is drawn only for the person who asked, and only while the page is
 *  there: a reply that comes after a sign-out, or after somebody else signs in, is dropped. */
export function useRead<T>(path: string, shape: Shape<T>): { read: Read<T>; again: () => void } {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [read, setRead] = useState<Read<T>>({ kind: "loading" });
  const alive = useRef(true);
  const away = useRef(false);

  const again = useCallback(() => {
    if (me === null || away.current) return;
    away.current = true;
    void session.signedIn({ method: "GET", path }, shape).then((answer) => {
      away.current = false;
      if (!alive.current) return;
      const now = session.state();
      if (now.kind !== "in" || now.user.id !== me) return;
      if (answer.kind === "ok") setRead({ kind: "ok", data: answer.data });
      else setRead((before) => (before.kind === "ok" ? before : { kind: "failed" }));
    });
  }, [session, me, path, shape]);

  useEffect(() => {
    alive.current = true;
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active") again();
    });
    return () => {
      alive.current = false;
      heard.remove();
    };
  }, [again]);

  useFocusEffect(again);

  return { read, again };
}
