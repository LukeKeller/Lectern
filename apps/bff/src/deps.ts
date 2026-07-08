import { config } from "./config";
import { db } from "./db/client";
import { MinifluxBackend } from "./backends/miniflux";
import { ReadeckBackend } from "./backends/readeck";
import { DrizzleOverlayStore } from "./overlay-store";
import { ElevenLabsBackend } from "./backends/elevenlabs";
import { KokoroBackend } from "./backends/kokoro";
import { ProviderTtsRouter } from "./backends/tts-router";
import { UnificationService } from "./unify";
import type { AppDeps } from "./app";

/**
 * Fires a content-discovery run on the worker. Injectable so route tests can
 * fake it; the real impl POSTs to `${DISCOVERY_URL}/run` and never throws (a
 * down worker must not 500 the user's "Discover now" request).
 */
export interface DiscoveryTrigger {
  triggerRun(): Promise<void>;
}

/** Real trigger client: a fire-and-forget POST to the worker's `/run`. Errors
 *  are swallowed/logged, not thrown, so an unreachable worker is a no-op. */
export function buildDiscoveryTrigger(): DiscoveryTrigger {
  return {
    async triggerRun(): Promise<void> {
      try {
        await fetch(`${config.DISCOVERY_URL}/run`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.DISCOVERY_TOKEN}` },
        });
      } catch (err) {
        console.error("[lectern] discovery triggerRun failed:", err);
      }
    },
  };
}

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
  const unify = new UnificationService(overlay);
  const tts = new ProviderTtsRouter({
    elevenlabs: new ElevenLabsBackend(),
    kokoro: new KokoroBackend({ baseUrl: config.KOKORO_BASE_URL }),
  });
  const discovery = buildDiscoveryTrigger();
  return { rss, readLater, overlay, unify, tts, discovery };
}
