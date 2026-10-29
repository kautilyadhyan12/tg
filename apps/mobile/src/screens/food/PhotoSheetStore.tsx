import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "../../session/SessionProvider";
import { photoSheetFile } from "./fileStore";
import type { TextStore } from "./outbox";
import { readSheetFile, sheetFileText, type PhotoSheet } from "./photo";

// The photo meal not yet saved, kept in the person's own file (ROADMAP Stage 5 33b-i): the scan has
// already used one of their scans, so closing the review, or the app, never throws it away. It opens
// again while the server can still save it.

const StoreContext = createContext<(userId: string) => TextStore>(photoSheetFile);

export function PhotoSheetStoreProvider({ store, children }: { store: (userId: string) => TextStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export interface KeptSheet {
  /** The kept photo meal, or null; undefined until the file is read. */
  sheet: PhotoSheet | null | undefined;
  keep: (sheet: PhotoSheet) => void;
  forget: () => void;
}

/** The signed-in person's kept photo meal. Each write is the whole meal, one at a time, in order. */
export function useKeptSheet(): KeptSheet {
  const make = useContext(StoreContext);
  const { state } = useSession();
  const me = state.kind === "in" ? state.user.id : null;
  const [sheet, setSheet] = useState<PhotoSheet | null | undefined>(undefined);
  const store = useRef<{ me: string; file: TextStore } | null>(null);
  const writing = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    setSheet(undefined);
    if (me === null) return undefined;
    const file = make(me);
    store.current = { me, file };
    let stale = false;
    void file.read().then(
      (text) => {
        if (!stale) setSheet((now) => (now === undefined ? readSheetFile(text, new Date()) : now));
      },
      () => {
        if (!stale) setSheet((now) => (now === undefined ? null : now));
      },
    );
    return () => {
      stale = true;
    };
  }, [me, make]);

  const write = useCallback((text: string) => {
    const kept = store.current;
    if (kept === null) return;
    writing.current = writing.current.then(() => kept.file.write(text)).catch(() => undefined);
  }, []);

  const keep = useCallback(
    (next: PhotoSheet) => {
      setSheet(next);
      write(sheetFileText(next));
    },
    [write],
  );
  const forget = useCallback(() => {
    setSheet(null);
    write("");
  }, [write]);

  return { sheet, keep, forget };
}
