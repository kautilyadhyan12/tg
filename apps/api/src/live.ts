// The console's open lines, as a server of their own (ROADMAP Stage 4 item 18; Kd, 2026-10-24):
// kept apart from the api that loads pages, so thousands of quiet lines never sit beside the
// requests that do the work. It answers only `/v1/orgs/:gymId/live` (and `/health`), with the
// api's own sign-in, staff check and limits, and hears what changed from the api through Redis.
// The api runs with LIVE_LINES=apart beside it; on this laptop the api holds the lines itself.
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig(process.env);
if (config.REDIS_URL === undefined) {
  throw new Error("REDIS_URL is required: the api tells this server what changed through Redis");
}
const app = await buildApp(config, {}, "lines");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

try {
  await app.listen({ port: config.LIVE_PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.fatal({ err }, "failed to start");
  process.exit(1);
}
