import { buildApp } from "./app";
import { config } from "./config";
import { startJobs, stopJobs } from "./jobs";

const app = buildApp();

const jobsEnabled =
  process.env.LECTERN_ENABLE_JOBS === "1" || process.env.LECTERN_ENABLE_JOBS === "true";

app
  .listen({ port: config.BFF_PORT, host: config.BFF_HOST })
  .then(async (address) => {
    console.log(`Lectern BFF listening on ${address}`);
    if (jobsEnabled) {
      await startJobs();
      console.log("Lectern background jobs started");
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      if (jobsEnabled) await stopJobs();
      await app.close();
      process.exit(0);
    })();
  });
}
