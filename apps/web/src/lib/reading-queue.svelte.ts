/**
 * The ordered list of document ids the user is reading "down" — a snapshot of a
 * list's visible cards, captured when a card is opened. The reader uses it to
 * auto-advance to the next document after triaging (Readwise behaviour). It is a
 * transient in-memory queue: a fresh open from any list replaces it, so the
 * "next" document always reflects the most recent list the user came from.
 */
class ReadingQueue {
	ids = $state<string[]>([]);

	/** Replace the queue with a list's ordered ids (called on card open). */
	set(ids: string[]): void {
		this.ids = ids;
	}

	/** The id immediately after `id` in the queue, or undefined if last/absent. */
	nextAfter(id: string): string | undefined {
		const i = this.ids.indexOf(id);
		return i >= 0 ? this.ids[i + 1] : undefined;
	}

	clear(): void {
		this.ids = [];
	}
}

export const readingQueue = new ReadingQueue();
