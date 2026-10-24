// Telling open lines that something changed (ROADMAP Stage 4 item 18). A route that changed
// something calls `tell` after its change is saved; it never waits on it and it never fails the
// route: a page whose news is lost still reads again when its line next opens.
//
// With Redis (production, where the lines are held by a server of their own) the news goes on
// one Redis channel and every server holding lines hears it; without Redis (this laptop, tests)
// it goes straight to this server's own lines.
import { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import { liveNewsForGymSchema, type LiveNews } from "@app/shared";
import type { LiveHub } from "./hub.js";

export const LIVE_CHANNEL = "live:news";

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

export function createRedisNews(url: string, log: FastifyBaseLogger): LiveNewsSender {
  const client = new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 5_000, enableOfflineQueue: false });
  // A Redis that is down is said by the refused publish below, not by every reconnect.
  client.on("error", () => undefined);
  return {
    tell(gymId, news) {
      const message = JSON.stringify(liveNewsForGymSchema.parse({ gymId, news }));
      client.publish(LIVE_CHANNEL, message).catch(() => {
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
 *  one that does not read as news for a gym is dropped. */
export async function hearRedisNews(url: string, hub: LiveHub, log: FastifyBaseLogger): Promise<() => Promise<void>> {
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
  await client.subscribe(LIVE_CHANNEL);
  return async () => {
    await client.quit().catch(() => {
      client.disconnect();
    });
  };
}
