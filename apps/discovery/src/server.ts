import { buildApp } from "./app";
import { buildRealDeps } from "./deps";
import { buildClient } from "./lectern";
import { startScheduler } from "./scheduler";
import { config } from "./config";

const app = buildApp(buildRealDeps());

const scheduler =
  config.DISCOVERY_ENABLE === "1" || config.DISCOVERY_ENABLE === "true"
    ? startScheduler(buildClient())
    : null;

app
  .listen({ port: config.DISCOVERY_PORT, host: config.DISCOVERY_HOST })
  .then((address) => {
    console.log(`Lectern discovery worker listening on ${address}`);
    if (scheduler) console.log(`Discovery scheduler started (${config.DISCOVERY_SCHEDULE})`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      scheduler?.stop();
      await app.close();
      process.exit(0);
    })();
  });
}
