import { z } from "zod";

/**
 * Zod-validated environment loader for the discovery worker. Mirrors the BFF's
 * loader (`apps/bff/src/config.ts`): defaults let the worker boot against the
 * local dev stack with no env file present, and a malformed env aborts startup
 * with a readable error. `config` is parsed once at import time.
 */
const EnvSchema = z.object({
  /** Bind host for the worker's own HTTP surface (/run, /health). */
  DISCOVERY_HOST: z.string().default("127.0.0.1"),
  DISCOVERY_PORT: z.coerce.number().int().positive().default(8790),
  /** Bearer token required on POST /run. Empty (dev) leaves the endpoint open. */
  DISCOVERY_TOKEN: z.string().default(""),
  /** Base URL of the Lectern BFF API, including the /api/v1 prefix. */
  LECTERN_API_URL: z.string().default("http://127.0.0.1:8787/api/v1"),
  /** Bearer token the worker presents to the BFF (must match the BFF's). */
  LECTERN_API_TOKEN: z.string().default("change-me"),
  /** Set to "1" to start the cron scheduler on boot. */
  DISCOVERY_ENABLE: z.string().default(""),
  /** Fallback cron expression when the BFF config carries none. */
  DISCOVERY_SCHEDULE: z.string().default("0 */6 * * *"),
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = EnvSchema.parse(process.env);
