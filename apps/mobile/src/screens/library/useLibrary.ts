import { onboardingResponseSchema } from "@app/shared";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "../../session/SessionProvider";
import type { Sex } from "../../library/figure";
import { figureFile, libraryFile, myWorkoutFile } from "../../library/files";
import { storeFor } from "../../library/myWorkout";
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

/** What the Library reads of the person's setup answers, asked once for both. `sex`: whose body the figures show, the
 *  person's own (Kd: a man sees the male figure, a woman the female one, never the other); null until it is known, as
 *  no figure is drawn rather than a wrong one. The answer the server last gave is kept on the phone for that person, so
 *  it is known with no internet; "other", "prefer not to say" or no answer show the male figure. `weightKg`: their
 *  newest weight, the one a saved workout's calories are reckoned at; null when they have none, and undefined until
 *  the server has said, so a page never says "at 70 kg" of somebody whose weight it has not heard yet. */
export interface SetupFacts {
  sex: Sex | null;
  weightKg: number | null | undefined;
  /** Asks again, such as after the person added their weight. */
  again: () => void;
}

export function useSetupFacts(): SetupFacts {
  const { session, state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [facts, setFacts] = useState<Omit<SetupFacts, "again">>({ sex: null, weightKg: undefined });
  const [asked, setAsked] = useState(0);
  const again = useCallback(() => {
    setAsked((n) => n + 1);
  }, []);
  // A new person starts from nothing; asking again keeps what is shown until the answer comes.
  useEffect(() => {
    setFacts({ sex: null, weightKg: undefined });
  }, [me]);
  useEffect(() => {
    if (me === null) return;
    const alive = { now: true, heard: false };
    // Read through functions: the person may have left, or the server answered, during each wait.
    const here = () => alive.now;
    const heard = () => alive.heard;
    void (async () => {
      const kept = await figureFile.read(me);
      if (here() && !heard() && kept !== null) setFacts((f) => ({ ...f, sex: kept }));
    })();
    void (async () => {
      const answer = await session.signedIn({ method: "GET", path: setupPath() }, onboardingResponseSchema);
      if (!here() || answer.kind !== "ok") return;
      const sex: Sex = answer.data.answers.gender === "female" ? "female" : "male";
      alive.heard = true;
      setFacts({ sex, weightKg: answer.data.answers.weightKg });
      figureFile.write(me, sex);
    })();
    return () => {
      alive.now = false;
    };
  }, [me, session, asked]);
  return useMemo(() => ({ ...facts, again }), [facts, again]);
}

/** The person's My Workout (63c): the same list on every page that shows it; null with nobody signed in. */
export function useMyWorkout(): { list: readonly string[]; add: (id: string) => void; remove: (id: string) => void } | null {
  const { state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const store = useMemo(() => (me === null ? null : storeFor(me, myWorkoutFile(me))), [me]);
  const subscribe = useCallback((told: () => void) => (store === null ? () => undefined : store.watch(told)), [store]);
  const list = useSyncExternalStore(subscribe, () => store?.list() ?? NONE);
  return store === null ? null : { list, add: store.add, remove: store.remove };
}

const NONE: readonly string[] = [];
