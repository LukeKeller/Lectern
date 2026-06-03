import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for the glue DB.
 *
 * Commands (run from apps/bff; the repo root .env supplies DATABASE_URL, else
 * the dev default below is used):
 *   pnpm --filter @lectern/bff exec drizzle-kit generate   # write ./drizzle SQL
 *   pnpm --filter @lectern/bff exec drizzle-kit push       # apply to the DB
 *   pnpm --filter @lectern/bff exec drizzle-kit migrate    # apply tracked migrations
 */
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://lectern:lectern@localhost:5433/lectern",
  },
});
