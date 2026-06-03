import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "../config";
import * as schema from "./schema";

/**
 * postgres.js client + drizzle instance for the glue DB. A single shared pool is
 * created at import time from `config.DATABASE_URL`.
 */
export const sql = postgres(config.DATABASE_URL);

export const db = drizzle(sql, { schema });

export type Db = typeof db;
