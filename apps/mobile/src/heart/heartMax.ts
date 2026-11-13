// The maximum heart rate the five heart rate zones are worked from (ROADMAP Stage 5 item 37f-ii-a): the
// person's own where they typed one, else 220 less their age, kept on the server. Read from one place
// here, so Settings, the run's summary, the run's page and the heart rate on a run show one answer.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { heartMaxResponseSchema, type HeartMaxResponse } from "@app/shared";
import { useSession } from "../session/SessionProvider";

export const HEART_MAX_PATH = "/v1/geo/heart-max";
const NO_CONNECTION = "No connection. Try again.";

/** The last answer the server gave, for the person it was about; dropped when somebody else signs in. */
let kept: { who: string; data: HeartMaxResponse } | null = null;
const listeners = new Set<() => void>();
const tell = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

function keep(who: string, data: HeartMaxResponse): void {
  kept = { who, data };
  tell();
}

/** Only for tests: forget what was read. */
export function forgetHeartMax(): void {
  kept = null;
  tell();
}

/** The maximum as last read for this person, null before it is read (a run on the way out shows its heart
 *  rate without a zone until then). */
export function useHeartMaxKept(): HeartMaxResponse | null {
  const { state } = useSession();
  const who = state.kind === "in" ? state.user.id : null;
  const now = useSyncExternalStore(subscribe, () => kept);
  return now !== null && now.who === who ? now.data : null;
}

export type HeartMaxRead = { kind: "loading" } | { kind: "ok"; data: HeartMaxResponse } | { kind: "failed" };

/** The maximum, read when the screen opens (and again with `again`), and the person's own saved or taken
 *  away. A read that fails keeps what was read before. */
export function useHeartMax(): { read: HeartMaxRead; again: () => void; save: (own: number | null) => Promise<string | null> } {
  const { session, state } = useSession();
  const who = state.kind === "in" ? state.user.id : null;
  const shown = useHeartMaxKept();
  const [failed, setFailed] = useState(false);
  const again = useCallback(() => {
    if (who === null) return;
    setFailed(false);
    void session.signedIn({ method: "GET", path: HEART_MAX_PATH }, heartMaxResponseSchema).then((answer) => {
      if (answer.kind === "ok") keep(who, answer.data);
      else setFailed(true);
    });
  }, [session, who]);
  useEffect(() => {
    again();
  }, [again]);
  const save = useCallback(
    async (own: number | null): Promise<string | null> => {
      if (who === null) return NO_CONNECTION;
      const answer = await session.signedIn({ method: "PUT", path: HEART_MAX_PATH, body: { own } }, heartMaxResponseSchema);
      if (answer.kind === "ok") {
        keep(who, answer.data);
        return null;
      }
      return answer.kind === "no_answer" || answer.message === "" ? NO_CONNECTION : answer.message;
    },
    [session, who],
  );
  const read: HeartMaxRead = shown !== null ? { kind: "ok", data: shown } : failed ? { kind: "failed" } : { kind: "loading" };
  return { read, again, save };
}
