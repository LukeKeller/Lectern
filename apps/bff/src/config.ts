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
});

export type Config = z.infer<typeof EnvSchema>;

export const config: Config = EnvSchema.parse(process.env);
