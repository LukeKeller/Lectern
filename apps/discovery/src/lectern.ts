import { LecternClient } from "@lectern/api-client";
import { config, type Config } from "./config";

/**
 * Build a typed Lectern API client from config. The worker talks to the BFF
 * ONLY through this client (never raw HTTP), so every request/response is
 * validated against the shared contract.
 */
export function buildClient(cfg: Config = config): LecternClient {
  return new LecternClient({
    baseUrl: cfg.LECTERN_API_URL,
    token: cfg.LECTERN_API_TOKEN,
  });
}
