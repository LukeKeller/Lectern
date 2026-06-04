import type { TtsVoice } from '@lectern/shared';

/**
 * ElevenLabs' classic premade voices. These IDs are public and stable, and work
 * for any account WITHOUT the "Voices read" API permission — so the voice picker
 * always has options even when `GET /v1/voices` is forbidden for a scoped key.
 * Account-specific voices are merged in on top when the key can list them.
 */
export const BUILTIN_VOICES: TtsVoice[] = [
	{ id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel' },
	{ id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi' },
	{ id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella' },
	{ id: 'ErXwobaYiN019PkySvjV', name: 'Antoni' },
	{ id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli' },
	{ id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh' },
	{ id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold' },
	{ id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam' },
	{ id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam' }
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
