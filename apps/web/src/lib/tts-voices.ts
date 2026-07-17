import type { TtsProvider, TtsVoice } from '@lectern/shared';

/**
 * ElevenLabs' classic premade voices. These IDs are public and stable, and work
 * for any account WITHOUT the "Voices read" API permission — so the voice picker
 * always has options even when `GET /v1/voices` is forbidden for a scoped key.
 * Account-specific voices are merged in on top when the key can list them.
 */
export const BUILTIN_VOICES: TtsVoice[] = [
	{ id: '9BWtsMINqrJLrRacOk9x', name: 'Aria' },
	{ id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger' },
	{ id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
	{ id: 'FGY2WhTYpPnrIDTdsKH5', name: 'Laura' },
	{ id: 'IKne3meq5aSn9XLyUdCD', name: 'Charlie' },
	{ id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George' },
	{ id: 'N2lVS1w4EtoT3dr4eOWO', name: 'Callum' },
	{ id: 'SAz9YHcvj6GT2YYXdXww', name: 'River' },
	{ id: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam' },
	{ id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte' },
	{ id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice' },
	{ id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda' },
	{ id: 'bIHbv24MWmeRgasZH58o', name: 'Will' },
	{ id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica' },
	{ id: 'cjVigY5qzO86Huf0OWal', name: 'Eric' },
	{ id: 'iP95p4xoKVk53GoZ742B', name: 'Chris' },
	{ id: 'nPczCjzI2devNBz1zQrb', name: 'Brian' },
	{ id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel' },
	{ id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily' },
	{ id: 'pqHfZKP75CvOlQylNhV4', name: 'Bill' },
	{ id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' }
];

/**
 * A curated subset of Kokoro's open-weight voices with friendly labels. The
 * self-hosted Kokoro service can list its full set (merged in on top via
 * `voiceOptions`); this guarantees sensible options even before that loads.
 */
export const KOKORO_VOICES: TtsVoice[] = [
	{ id: 'af_heart', name: 'Heart (US, female)' },
	{ id: 'af_bella', name: 'Bella (US, female)' },
	{ id: 'af_nicole', name: 'Nicole (US, female)' },
	{ id: 'af_sky', name: 'Sky (US, female)' },
	{ id: 'am_adam', name: 'Adam (US, male)' },
	{ id: 'am_michael', name: 'Michael (US, male)' },
	{ id: 'am_onyx', name: 'Onyx (US, male)' },
	{ id: 'bf_emma', name: 'Emma (UK, female)' },
	{ id: 'bf_isabella', name: 'Isabella (UK, female)' },
	{ id: 'bm_george', name: 'George (UK, male)' },
	{ id: 'bm_lewis', name: 'Lewis (UK, male)' }
];

/**
 * A curated subset of Piper's open-weight English voices with friendly labels.
 * The self-hosted Piper service can list its installed voices (merged in on top
 * via `voiceOptions`); this guarantees sensible options even before that loads.
 */
export const PIPER_VOICES: TtsVoice[] = [
	{ id: 'en_US-lessac-medium', name: 'Lessac (US)' },
	{ id: 'en_US-amy-medium', name: 'Amy (US, female)' },
	{ id: 'en_US-ryan-high', name: 'Ryan (US, male)' },
	{ id: 'en_US-hfc_female-medium', name: 'HFC Female (US)' },
	{ id: 'en_US-hfc_male-medium', name: 'HFC Male (US)' },
	{ id: 'en_GB-alba-medium', name: 'Alba (UK, female)' },
	{ id: 'en_GB-northern_english_male-medium', name: 'Northern English (UK, male)' }
];

/** Default voice for each provider, used when switching providers. */
export const DEFAULT_VOICE: Record<TtsProvider, string> = {
	elevenlabs: '21m00Tcm4TlvDq8ikWAM', // Rachel
	kokoro: 'af_heart',
	piper: 'en_US-lessac-medium'
};

/**
 * Built-in voices for the active provider plus any service/account voices
 * (deduped by id), guaranteeing the currently-selected id is always present so
 * it shows as selected even if it's a custom voice not in the built-in set.
 */
export function voiceOptions(
	account: TtsVoice[],
	current: string,
	provider: TtsProvider = 'elevenlabs'
): TtsVoice[] {
	const builtin: Record<TtsProvider, TtsVoice[]> = {
		elevenlabs: BUILTIN_VOICES,
		kokoro: KOKORO_VOICES,
		piper: PIPER_VOICES
	};
	const out: TtsVoice[] = [...(builtin[provider] ?? BUILTIN_VOICES)];
	for (const v of account) if (!out.some((o) => o.id === v.id)) out.push(v);
	if (current && !out.some((o) => o.id === current))
		out.push({ id: current, name: 'Custom voice' });
	return out;
}
