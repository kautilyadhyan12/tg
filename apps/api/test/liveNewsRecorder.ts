// What the console's open lines were told (ROADMAP Stage 4 item 18), for a route test that runs on
// `inject` with no line open: the server's own hub, with every piece of news handed to it written
// down. News is sent once the response has gone, so `toldAbout` waits a moment for it.
import type { LiveNews } from "@app/shared";
import { createLiveHub, type LiveHub } from "../src/modules/live/hub.js";

export interface RecordingHub extends LiveHub {
  told: { gymId: string; news: LiveNews }[];
  /** How many times the gym's lines were told to read this person's memberships again, once at
   *  least `atLeast` have come or a second has passed. */
  toldAbout(gymId: string, entryId: string, atLeast?: number): Promise<number>;
  /** How many pieces of news of this kind the gym's lines were told, waited for the same way. */
  toldOf(gymId: string, what: LiveNews["what"], atLeast?: number): Promise<number>;
}

export function recordingHub(): RecordingHub {
  const hub = createLiveHub();
  const told: { gymId: string; news: LiveNews }[] = [];
  const count = (gymId: string, entryId: string) =>
    told.filter((t) => t.gymId === gymId && t.news.what === "memberships" && t.news.entryId === entryId).length;
  const countOf = (gymId: string, what: LiveNews["what"]) => told.filter((t) => t.gymId === gymId && t.news.what === what).length;
  const settle = async (counted: () => number, atLeast: number) => {
    const by = Date.now() + 1_000;
    while (counted() < atLeast && Date.now() < by) await new Promise((resolve) => setTimeout(resolve, 10));
    // Anything still on its way from a request just answered.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return counted();
  };
  return {
    ...hub,
    told,
    deliver(gymId, news) {
      told.push({ gymId, news });
      return hub.deliver(gymId, news);
    },
    toldAbout(gymId, entryId, atLeast = 0) {
      return settle(() => count(gymId, entryId), atLeast);
    },
    toldOf(gymId, what, atLeast = 0) {
      return settle(() => countOf(gymId, what), atLeast);
    },
  };
}
