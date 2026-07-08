import cron from "node-cron";
import { config } from "./config";
import { runDiscovery, type DiscoveryClient } from "./run";
import { allFetchers } from "./fetchers";

/**
 * Schedule periodic discovery runs from a cron expression. node-cron validates
 * and auto-starts the task; a thrown run is caught so one bad tick never crashes
 * the worker. Returns the task so `server.ts` can stop it on shutdown.
 */
export function startScheduler(
  client: DiscoveryClient,
  schedule: string = config.DISCOVERY_SCHEDULE,
): ReturnType<typeof cron.schedule> {
  return cron.schedule(schedule, () => {
    void runDiscovery(client, { trigger: "cron", fetchers: allFetchers }).catch((err) => {
      console.error("[discovery] scheduled run failed:", err);
    });
  });
}
