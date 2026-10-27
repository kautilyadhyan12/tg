import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { Shape } from "../../session/calls";
import { useSession } from "../../session/SessionProvider";

/** One read of the person's own numbers. `failed` only when nothing was ever read: a read again that
 *  fails keeps what the screen already shows. */
export type Read<T> = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "failed" };

/** A signed-in GET, read when the page opens, each time its tab is opened again, when the app comes
 *  back to the front while the page is on screen, and when `fresh` moves (the person's time zone was
 *  saved). Its answer is drawn only for the person who asked, and only while the page is there: a
 *  reply that comes after a sign-out, or after somebody else signs in, is dropped. A read asked for
 *  while one is away goes once that one is back, so a later change is never missed. */
export function useRead<T>(path: string, shape: Shape<T>, fresh = 0): { read: Read<T>; again: () => void } {
  const { session, state } = useSession();
  const navigation = useNavigation();
  const me = state.kind === "in" ? state.user.id : null;
  const [read, setRead] = useState<Read<T>>({ kind: "loading" });
  const alive = useRef(true);
  const away = useRef(false);
  const wanted = useRef(false);

  const again = useCallback(() => {
    if (me === null) return;
    if (away.current) {
      wanted.current = true;
      return;
    }
    away.current = true;
    void session.signedIn({ method: "GET", path }, shape).then((answer) => {
      away.current = false;
      if (!alive.current) return;
      const now = session.state();
      if (now.kind !== "in" || now.user.id !== me) return;
      if (answer.kind === "ok") setRead({ kind: "ok", data: answer.data });
      else setRead((before) => (before.kind === "ok" ? before : { kind: "failed" }));
      if (wanted.current) {
        wanted.current = false;
        again();
      }
    });
  }, [session, me, path, shape]);

  useEffect(() => {
    if (fresh > 0) again();
  }, [fresh, again]);

  useEffect(() => {
    alive.current = true;
    const heard = AppState.addEventListener("change", (next) => {
      if (next === "active" && navigation.isFocused()) again();
    });
    return () => {
      alive.current = false;
      heard.remove();
    };
  }, [again, navigation]);

  useFocusEffect(again);

  return { read, again };
}
