import type { TtsVoice } from '@lectern/shared';

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
 * Built-in voices plus any account voices (deduped by id), guaranteeing the
 * currently-selected id is always present so it shows as selected even if it's
 * a custom voice not in the built-in set.
 */
export function voiceOptions(account: TtsVoice[], current: string): TtsVoice[] {
	const out: TtsVoice[] = [...BUILTIN_VOICES];
	for (const v of account) if (!out.some((o) => o.id === v.id)) out.push(v);
	if (current && !out.some((o) => o.id === current))
		out.push({ id: current, name: 'Custom voice' });
	return out;
}
