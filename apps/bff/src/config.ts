import { z } from "zod";

/**
 * Zod-validated environment loader. Defaults mirror `.env.example` so the BFF
 * boots against the local dev stack with no env file present. `config` is parsed
 * once at import time; a malformed env aborts startup with a readable error.
 */
const EnvSchema = z.object({
  BFF_HOST: z.string().default("127.0.0.1"),
  BFF_PORT: z.coerce.number().int().positive().default(8787),
  LECTERN_API_TOKEN: z.string().default("change-me"),
  LECTERN_DEV_USER: z.string().default("luke"),
  DATABASE_URL: z.string().default("postgres://lectern:lectern@localhost:5433/lectern"),
  MINIFLUX_URL: z.string().default("http://localhost:8088"),
  /** `user:pass` for HTTP Basic; dev convenience when no API token is set. */
  MINIFLUX_BASIC: z.string().default("admin:adminpass"),
  MINIFLUX_API_TOKEN: z.string().default(""),
  READECK_URL: z.string().default("http://localhost:8089"),
  READECK_API_TOKEN: z.string().default(""),
  /** Dedicated newsletter mailbox (IMAP). Empty IMAP_HOST disables ingestion. */
  IMAP_HOST: z.string().default(""),
  // An empty/absent value (e.g. a pre-IMAP install's rendered .env) must fall
  // back to 993, not coerce to NaN and abort startup.
  IMAP_PORT: z.preprocess(
    (v) => (v === "" || v === undefined ? 993 : v),
    z.coerce.number().int().positive(),
  ),
  IMAP_USER: z.string().default(""),
  IMAP_PASSWORD: z.string().default(""),
  IMAP_MAILBOX: z.string().default("INBOX"),
  /** "0" for a plain/STARTTLS connection (143); anything else uses TLS (993). */
  IMAP_SECURE: z.string().default("1"),
  /** Comma-separated From addresses to skip during ingestion (internal/system mail). */
  IMAP_EXCLUDE_SENDERS: z.string().default(""),
  /** When set, the BFF serves the prebuilt web SPA from this dir (production single-service). */
  LECTERN_WEB_DIR: z.string().default(""),
  /** Public origin (scheme + host) used to build absolute podcast feed/enclosure
   * URLs. Empty = derive from the request's forwarded headers (default). */
  LECTERN_PUBLIC_URL: z.string().default(""),
  /** Base URL of an optional self-hosted Kokoro-FastAPI service (OpenAI-compatible
   * `/v1/audio/*`). Used only when the TTS provider is set to "kokoro". */
  KOKORO_BASE_URL: z.string().default("http://127.0.0.1:8880"),
  /** Base URL of an optional self-hosted Piper service (OHF-Voice piper1-gpl,
   * `python3 -m piper.http_server`). Used only when the TTS provider is "piper". */
  PIPER_BASE_URL: z.string().default("http://127.0.0.1:5000"),
  /** Set to "1" to start the pg-boss polling jobs. */
  LECTERN_ENABLE_JOBS: z.string().default(""),
  /** Set to "1" to enable the newsletter mailbox poll (requires IMAP_* + jobs). */
  LECTERN_ENABLE_EMAIL: z.string().default(""),
  /** Set to "1" to enable Web Push notifications (also requires both VAPID keys). */
  LECTERN_ENABLE_PUSH: z.string().default(""),
  /** VAPID public key (sent to the SPA so it can subscribe). */
  LECTERN_VAPID_PUBLIC_KEY: z.string().default(""),
  /** VAPID private key (signs push requests; never leaves the server). */
  LECTERN_VAPID_PRIVATE_KEY: z.string().default(""),
  /** VAPID `sub` contact (mailto: or https: URL) per the Web Push spec. */
  LECTERN_VAPID_SUBJECT: z.string().default("mailto:admin@example.com"),
  /** Base URL of the content-discovery worker. The BFF POSTs `/run` here to
   * fire off a discovery run (fire-and-forget). */
  DISCOVERY_URL: z.string().default("http://127.0.0.1:8790"),
  /** Bearer token the BFF presents to the discovery worker's trigger endpoint. */
  DISCOVERY_TOKEN: z.string().default(""),
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = EnvSchema.parse(process.env);

/**
 * Web Push is live only when explicitly enabled AND both VAPID keys are present.
 * A missing keypair (e.g. an upgrade from a pre-push install) silently no-ops
 * rather than crashing the server.
 */
export function pushEnabled(cfg: Config = config): boolean {
  return Boolean(cfg.LECTERN_ENABLE_PUSH) && !!cfg.LECTERN_VAPID_PUBLIC_KEY && !!cfg.LECTERN_VAPID_PRIVATE_KEY;
}
