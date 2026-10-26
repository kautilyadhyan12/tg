// The open lines this server holds (ROADMAP Stage 4 item 18), by gym. A piece of news goes to
// the lines of the one gym it names and to no other; a line belongs to a gym only once the
// route has checked that its person is that gym's staff.
import type { LiveMessage, LiveNews } from "@app/shared";

export interface LiveLine {
  readonly gymId: string;
  readonly userId: string;
  /** Writes one message on the line. */
  send(message: LiveMessage): void;
  /** Ends the line; the browser opens a new one through the route's checks. */
  end(): void;
}

export type OpenAnswer = "open" | "too_many_lines" | "lines_full";

export interface LiveHub {
  open(line: LiveLine): OpenAnswer;
  close(line: LiveLine): void;
  /** How many lines the news went to. */
  deliver(gymId: string, news: LiveNews): number;
  count(): number;
  /** Tells every line `ready`: news may have been lost, so every page reads again. */
  readAgainAll(): void;
  /** Ends every line, when the server stops. */
  endAll(): void;
}

export interface HubLimits {
  /** Open lines one account may hold at once, over every gym: one for each console tab on screen. */
  perPerson: number;
  /** Open lines this server holds at once. */
  total: number;
}

/** Measured 2026-10-24 (`apps/api/.cost/measure-open-lines.mjs`): an open line is 17–19 KB of
 *  the server's memory, so 20,000 is under 400 MB. */
export const HUB_LIMITS: HubLimits = { perPerson: 10, total: 20_000 };

export function createLiveHub(limits: HubLimits = HUB_LIMITS): LiveHub {
  const byGym = new Map<string, Set<LiveLine>>();
  const byPerson = new Map<string, number>();
  let total = 0;
  return {
    open(line) {
      if (total >= limits.total) return "lines_full";
      const held = byPerson.get(line.userId) ?? 0;
      if (held >= limits.perPerson) return "too_many_lines";
      const lines = byGym.get(line.gymId) ?? new Set<LiveLine>();
      if (lines.has(line)) return "open";
      lines.add(line);
      byGym.set(line.gymId, lines);
      byPerson.set(line.userId, held + 1);
      total += 1;
      return "open";
    },
    close(line) {
      const lines = byGym.get(line.gymId);
      if (lines === undefined || !lines.delete(line)) return;
      if (lines.size === 0) byGym.delete(line.gymId);
      const held = (byPerson.get(line.userId) ?? 1) - 1;
      if (held <= 0) byPerson.delete(line.userId);
      else byPerson.set(line.userId, held);
      total -= 1;
    },
    deliver(gymId, news) {
      const lines = byGym.get(gymId);
      if (lines === undefined) return 0;
      for (const line of lines) line.send(news);
      return lines.size;
    },
    count() {
      return total;
    },
    readAgainAll() {
      for (const lines of byGym.values()) for (const line of [...lines]) line.send({ what: "ready" });
    },
    endAll() {
      for (const lines of [...byGym.values()]) for (const line of [...lines]) line.end();
    },
  };
}
