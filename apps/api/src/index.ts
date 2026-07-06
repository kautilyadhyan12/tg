// apps/api boot: parse env once (R2.3) → build → listen. Graceful shutdown.
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig(process.env);
const app = await buildApp(config);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, "shutting down");
    void app.close().then(() => {
      process.exit(0);
    });
  });
}

try {
  await app.listen({ port: config.PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.fatal({ err }, "failed to start");
  process.exit(1);
}
