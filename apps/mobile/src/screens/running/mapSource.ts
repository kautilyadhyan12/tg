// Which map the phone draws runs on (ROADMAP Stage 5 37b-i): what the server last said, kept on the
// phone, OpenFreeMap's until it has said anything. Asked again each time a run's map opens, so the
// day the server is switched to our own copy every phone follows, with no new app version.
import { useEffect, useSyncExternalStore } from "react";
import { OPENFREEMAP, mapSourceResponseSchema, mapSourceSchema, type MapSource } from "@app/shared";
import type { Session } from "../../session/session";
import { phoneRunFiles, type RunFiles } from "./recorder";

const FILE = "run-map.json";

let source: MapSource = OPENFREEMAP;
let read: Promise<void> | null = null;
let files: RunFiles = phoneRunFiles;
const listeners = new Set<() => void>();
const tell = () => {
  for (const l of listeners) l();
};

/** The map kept on the phone, read once; a file that does not read as a map keeps OpenFreeMap's. */
function readKept(): Promise<void> {
  read ??= (async () => {
    try {
      const text = await files.read(FILE);
      if (text === null) return;
      const kept = mapSourceSchema.safeParse(JSON.parse(text));
      if (kept.success) {
        source = kept.data;
        tell();
      }
    } catch {
      // Unreadable: OpenFreeMap's stands.
    }
  })();
  return read;
}

/** Asks the server which map to draw and keeps its answer; with no answer, the kept one stands. */
export async function askMapSource(session: Pick<Session, "signedIn">): Promise<void> {
  await readKept();
  const answer = await session.signedIn({ method: "GET", path: "/v1/geo/map" }, mapSourceResponseSchema);
  if (answer.kind !== "ok") return;
  // The same map is kept as the same thing: a new copy of it would have every map draw again.
  if (JSON.stringify(answer.data.map) !== JSON.stringify(source)) {
    source = answer.data.map;
    tell();
    await files.write(FILE, JSON.stringify(source)).catch(() => undefined);
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const current = () => source;

/** The map to draw: the kept one at once, the server's as soon as it answers. Whether the map then
 *  draws is the map's own word (`RunMap`'s `onDrawn`), not whether our server answered. */
export function useMapSource(session: Pick<Session, "signedIn">): MapSource {
  const now = useSyncExternalStore(subscribe, current);
  useEffect(() => {
    void askMapSource(session);
  }, [session]);
  return now;
}

/** For tests: forget what was kept, and read from `withFiles`. */
export function resetMapSource(withFiles: RunFiles = phoneRunFiles): void {
  source = OPENFREEMAP;
  read = null;
  files = withFiles;
}
