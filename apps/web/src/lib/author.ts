/**
 * Human-readable author from raw byline metadata. Feed and email captures often
 * carry machine forms — `Name <user@host>`, `user@host (Name)`, or a bare
 * address. Show the human name when one is present and never show the address;
 * for a bare address fall back to a humanized local part. The domain (often a
 * punycode `xn--` host) is dropped entirely rather than decoded — there is no
 * browser-safe punycode decoder and the domain is not a byline anyway.
 */
export function displayAuthor(raw: string): string {
	let author = raw.trim();
	if (!author) return raw;
	// "Name <user@host>": prefer the display name; a bare "<user@host>" falls
	// through to local-part handling below.
	const angled = author.match(/^(.*?)\s*<\s*([^\s<>]+@[^\s<>]+)\s*>$/);
	if (angled) {
		const name = angled[1]
			.trim()
			.replace(/^["']+|["']+$/g, '')
			.trim();
		if (name) return name;
		author = angled[2];
	}
	// "user@host (Name)": the display name trails in parentheses.
	const commented = author.match(/^[^\s()]+@[^\s()]+\s*\(([^)]*)\)$/);
	if (commented) {
		const name = commented[1].trim();
		if (name) return name;
		author = author.replace(/\s*\([^)]*\)$/, '');
	}
	// Bare address: humanize the local part and drop the domain entirely.
	const bare = author.match(/^([^\s@]+)@[^\s@]+$/);
	if (bare) {
		const local = bare[1]
			.replace(/["']/g, '')
			.replace(/[._+-]+/g, ' ')
			.trim();
		return local ? local.replace(/\b\p{L}/gu, (m) => m.toUpperCase()) : author;
	}
	// Already a human name (or an unrecognized form): pass through untouched.
	return author;
}
