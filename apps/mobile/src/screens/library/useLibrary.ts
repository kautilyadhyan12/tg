import { onboardingResponseSchema } from "@app/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/SessionProvider";
import type { Sex } from "../../library/figure";
import { figureFile, libraryFile } from "../../library/files";
import { readKept, refreshLibrary, type LibraryFile, type LibraryState } from "../../library/store";
import { setupPath } from "../setup/useSetupAnswers";

/** The Library kept on the phone: the kept copy at once, then the server asked for a newer one. `again`
 *  asks once more (Try again). A test hands in its own file. */
export function useLibrary(file?: LibraryFile): { state: LibraryState; again: () => void } {
  const { session } = useSession();
  const [state, setState] = useState<LibraryState>({ kind: "loading" });
  const me = session.state();
  const files = useRef(file ?? libraryFile(me.kind === "in" ? me.user.id : ""));
  const live = useRef(true);
  // Read through a function: the page may have closed during each wait.
  const isLive = useCallback(() => live.current, []);
  const load = useCallback(async () => {
    const kept = await readKept(files.current);
    if (!isLive()) return;
    if (kept !== null) setState({ kind: "ready", library: kept, fresh: false });
    const next = await refreshLibrary((request, shape) => session.signedIn(request, shape), files.current, kept);
    if (isLive()) setState(next);
  }, [session, isLive]);
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [load]);
  const again = useCallback(() => {
    setState({ kind: "loading" });
    void load();
  }, [load]);
  return { state, again };
}

/** Whose body the figures show: the person's own, from their setup answer (Kd: a man sees the male figure, a
 *  woman the female one, never the other). Null until it is known: no figure is drawn then, rather than a
 *  wrong one. The answer the server last gave is kept on the phone for that person, so it is known with no
 *  internet. "Other", "prefer not to say" or no answer show the male figure. */
export function useFigureSex(): Sex | null {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [sex, setSex] = useState<Sex | null>(null);
  useEffect(() => {
    setSex(null);
    if (me === null) return;
    const alive = { now: true, heard: false };
    // Read through functions: the person may have left, or the server answered, during each wait.
    const here = () => alive.now;
    const heard = () => alive.heard;
    void (async () => {
      const kept = await figureFile.read(me);
      if (here() && !heard() && kept !== null) setSex(kept);
    })();
    void (async () => {
      const answer = await session.signedIn({ method: "GET", path: setupPath() }, onboardingResponseSchema);
      if (!here() || answer.kind !== "ok") return;
      const next: Sex = answer.data.answers.gender === "female" ? "female" : "male";
      alive.heard = true;
      setSex(next);
      figureFile.write(me, next);
    })();
    return () => {
      alive.now = false;
    };
  }, [me, session]);
  return sex;
}
