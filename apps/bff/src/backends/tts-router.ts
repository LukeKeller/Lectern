import type { TtsProvider } from "@lectern/shared";
import type { TtsBackend } from "./elevenlabs";

/**
 * Selects the TTS backend for the configured provider. The active provider lives
 * in the glue DB (per-user setting), so the right adapter is resolved per request
 * rather than wired once at startup.
 */
export interface TtsRouter {
  forProvider(provider: TtsProvider): TtsBackend;
}

export class ProviderTtsRouter implements TtsRouter {
  constructor(private readonly backends: Record<TtsProvider, TtsBackend>) {}

  forProvider(provider: TtsProvider): TtsBackend {
    return this.backends[provider] ?? this.backends.elevenlabs;
  }
}
