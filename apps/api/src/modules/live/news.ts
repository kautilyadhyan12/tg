// Telling open lines that something changed (ROADMAP Stage 4 item 18). A route that changed
// something calls `tell` after its change is saved; it never waits on it and it never fails the
// route: a page whose news is lost still reads again when its line next opens.
//
// With Redis (production, where the lines are held by a server of their own) the news goes on
// one Redis channel and every server holding lines hears it; without Redis (this laptop, tests)
// it goes straight to this server's own lines.
import { createHash } from "node:crypto";
import { Redis } from "ioredis";
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import type { Sql } from "postgres";
import { z } from "zod";
import { liveNewsForGymSchema, type LiveNews } from "@app/shared";
import type { LiveHub } from "./hub.js";
import { gymsOfMember } from "./repo.js";

/** One channel for each database: gym ids belong to one database, and Redis's channels are shared
 *  by every database number on it, so another environment or another folder's servers on the same
 *  Redis never hear this one's news. */
export function liveChannel(databaseUrl: string): string {
  return `live:news:${createHash("sha256").update(databaseUrl).digest("hex").slice(0, 12)}`;
}

export interface LiveNewsSender {
  tell(gymId: string, news: LiveNews): void;
  close(): Promise<void>;
}

/** Nobody to tell: a server that holds no lines and has no Redis. */
export const NO_NEWS: LiveNewsSender = {
  tell() {},
  async close() {},
};

export function createLocalNews(hub: LiveHub): LiveNewsSender {
  return {
    tell(gymId, news) {
      hub.deliver(gymId, news);
    },
    async close() {},
  };
}

export function createRedisNews(url: string, channel: string, log: FastifyBaseLogger): LiveNewsSender {
  const client = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 5_000, enableOfflineQueue: false });
  // A Redis that is down is said by the refused publish below, not by every reconnect.
  client.on("error", () => undefined);
  return {
    tell(gymId, news) {
      const message = liveNewsForGymSchema.safeParse({ gymId, news });
      if (!message.success) {
        log.warn("live.news_not_sent");
        return;
      }
      client.publish(channel, JSON.stringify(message.data)).catch(() => {
        log.warn("live.news_not_sent");
      });
    },
    async close() {
      await client.quit().catch(() => {
        client.disconnect();
      });
    },
  };
}

/** A server that holds lines hears every server's news on the channel. Each message is parsed:
 *  one that does not read as news for a gym is dropped. Nothing waits for Redis: a server starts
 *  while Redis is down, and Redis's client subscribes by itself once it is back. */
export function hearRedisNews(url: string, channel: string, hub: LiveHub, log: FastifyBaseLogger): () => void {
  const client = new Redis(url, { maxRetriesPerRequest: null });
  client.on("error", () => undefined);
  client.on("message", (_channel: string, raw: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
    const message = liveNewsForGymSchema.safeParse(parsed);
    if (!message.success) {
      log.warn("live.news_unreadable");
      return;
    }
    hub.deliver(message.data.gymId, message.data.news);
  });
  client.subscribe(channel).catch(() => {
    log.warn("live.news_not_heard");
  });
  return () => {
    client.disconnect();
  };
}

/** A route's `onResponse`: a change saved to a person on the gym's list (2xx, not a read) tells the
 *  gym's open lines to read their memberships again. */
export function tellMembershipsAfter(news: LiveNewsSender) {
  const personInAddress = z.object({ gymId: z.string().uuid(), entryId: z.string().uuid() });
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.method === "GET" || reply.statusCode >= 300) return;
    const at = personInAddress.safeParse(req.params);
    if (at.success) news.tell(at.data.gymId, { what: "memberships", entryId: at.data.entryId });
  };
}

/** A member's own change tells every gym they belong to: a workout saved or Hide me (the
 *  leaderboard), their name or age (`people`). Nothing waits on it and it never throws: a lost
 *  piece of news is read when the line next opens. */
export function tellMembersGyms(sql: Sql, news: LiveNewsSender, log: FastifyBaseLogger, userId: string, message: LiveNews): void {
  if (news === NO_NEWS) return;
  gymsOfMember(sql, userId).then(
    (gymIds) => {
      for (const gymId of gymIds) news.tell(gymId, message);
    },
    () => {
      log.warn("live.news_not_sent");
    },
  );
}

/** The same news to each of these gyms. */
export function tellGyms(news: LiveNewsSender, gymIds: readonly string[], message: LiveNews): void {
  for (const gymId of gymIds) news.tell(gymId, message);
}

export function tellMembersLeaderboards(sql: Sql, news: LiveNewsSender, log: FastifyBaseLogger, userId: string): void {
  tellMembersGyms(sql, news, log, userId, { what: "leaderboard", change: "counted" });
}

/** A route's `onResponse`: a change saved to the gym's people (2xx, not a read) tells the gym's open
 *  lines that names, records or members changed. */
export function tellPeopleAfter(news: LiveNewsSender) {
  const inGym = z.object({ gymId: z.string().uuid() });
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.method === "GET" || reply.statusCode >= 300) return;
    const at = inGym.safeParse(req.params);
    if (at.success) news.tell(at.data.gymId, { what: "people" });
  };
}
