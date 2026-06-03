/**
 * Read an OPML file's contents as trimmed text, ready to hand to
 * `importOpml({ opml })`. Throws on an empty file so the caller surfaces a clear
 * error instead of POSTing an empty import the backend would reject.
 */
export async function readOpmlFile(file: File): Promise<string> {
	const text = (await file.text()).trim();
	if (!text) throw new Error('OPML file is empty.');
	return text;
}
