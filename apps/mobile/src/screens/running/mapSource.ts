// Which map the phone draws runs on (ROADMAP Stage 5 37b-i): what the server last said, kept on the
// phone, OpenFreeMap's until it has said anything. Asked again each time a run's map opens, so the
// day the server is switched to our own copy every phone follows, with no new app version.
import { useEffect, useState, useSyncExternalStore } from "react";
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

/** Asks the server which map to draw and keeps its answer. "offline" when no answer came. */
export async function askMapSource(session: Pick<Session, "signedIn">): Promise<"online" | "offline"> {
  await readKept();
  const answer = await session.signedIn({ method: "GET", path: "/v1/geo/map" }, mapSourceResponseSchema);
  if (answer.kind !== "ok") return answer.kind === "no_answer" ? "offline" : "online";
  const changed = JSON.stringify(answer.data.map) !== JSON.stringify(source);
  source = answer.data.map;
  if (changed) {
    tell();
    await files.write(FILE, JSON.stringify(source)).catch(() => undefined);
  }
  return "online";
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const current = () => source;

/** The map to draw, and whether the phone reached the server when the map opened (null while asking). */
export function useMapSource(session: Pick<Session, "signedIn">): { source: MapSource; online: boolean | null } {
  const now = useSyncExternalStore(subscribe, current);
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void askMapSource(session).then((said) => {
      if (live) setOnline(said === "online");
    });
    return () => {
      live = false;
    };
  }, [session]);
  return { source: now, online };
}

/** For tests: forget what was kept, and read from `withFiles`. */
export function resetMapSource(withFiles: RunFiles = phoneRunFiles): void {
  source = OPENFREEMAP;
  read = null;
  files = withFiles;
}
