import { config } from "./config";
import { db } from "./db/client";
import { MinifluxBackend } from "./backends/miniflux";
import { ReadeckBackend } from "./backends/readeck";
import { DrizzleOverlayStore } from "./overlay-store";
import { ElevenLabsBackend } from "./backends/elevenlabs";
import { UnificationService } from "./unify";
import type { AppDeps } from "./app";

/**
 * Constructs the real dependency graph from `config` + the glue DB pool: the
 * MiniFlux + Readeck adapters, the drizzle-backed overlay store, and the
 * unification service over all three. Adapter/pool construction is connection-
 * lazy, so importing this module performs no I/O.
 */
export function buildRealDeps(): AppDeps {
  const rss = new MinifluxBackend({
    baseUrl: config.MINIFLUX_URL,
    apiToken: config.MINIFLUX_API_TOKEN || undefined,
    basic: config.MINIFLUX_BASIC,
  });
  const readLater = new ReadeckBackend({
    baseUrl: config.READECK_URL,
    apiToken: config.READECK_API_TOKEN,
  });
  const overlay = new DrizzleOverlayStore(db);
  const unify = new UnificationService(rss, readLater, overlay);
  const tts = new ElevenLabsBackend();
  return { rss, readLater, overlay, unify, tts };
}
