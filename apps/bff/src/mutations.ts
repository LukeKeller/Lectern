import {
  FINISHED_THRESHOLD,
  type Highlight,
  type Location,
  type Mutation,
  type NewHighlight,
  type ReadLaterBackend,
  type RssBackend,
} from "@lectern/shared";
import { locationToReadeckArchived, type DocumentStore, type HighlightStore } from "./unify";
import { parseId, type ParsedId } from "./ids";

/**
 * The write path, shared by `PATCH /documents/:id`, the highlight/delete routes,
 * and `POST /sync`. This class is the single home for the field-ownership map
 * that used to live in a prose comment. Two invariants hold here:
 *
 *  1. Dual-write. An overlay-owned field (location, tags, note, reading progress)
 *     is written to the glue overlay AND mirrored to its backend when a backend
 *     owns it. The overlay column wins on merge (see `unify.mergeOverlay`), so the
 *     index-backed read path reflects the change immediately, before the next poll.
 *  2. Source routing lives in exactly ONE place (`toBackend`). Adding a backend
 *     (a third source — e.g. an email-newsletter path) means editing that switch,
 *     not every method.
 *
 * Ownership:
 *  - Readeck (backend): archive flag, reading progress, labels, deletion.
 *  - MiniFlux (backend): read state, removal. Nothing else is user-writable
 *    (entry tags are feed-derived).
 *  - Glue DB: unified location, tags, note, title, RSS progress/anchor, highlights
 *    (all sources), the read-state mirror, and tombstones.
 */
export interface MutationDeps {
  rss: RssBackend;
  readLater: ReadLaterBackend;
  overlay: DocumentStore & HighlightStore;
}

/**
 * A write that a backend owns, named by aspect. The discriminant lets `toBackend`
 * be the one switch over `source` — the ownership map as code, not prose.
 */
type BackendWrite =
  | { aspect: "archived"; value: boolean }
  | { aspect: "labels"; value: string[] }
  | { aspect: "progress"; value: number; anchor: string | null }
  | { aspect: "read"; value: boolean }
  | { aspect: "removed" };

export class MutationApplier {
  constructor(private readonly deps: MutationDeps) {}

  /** Apply a single queued offline mutation to its owning store(s). */
  async apply(m: Mutation): Promise<void> {
    const parsed = parseId(m.id);
    if (!parsed) throw new Error(`invalid document id: ${m.id}`);
    switch (m.type) {
      case "setLocation":
        return this.setLocation(parsed, m.id, m.location);
      case "setReadingProgress":
        return this.setProgress(parsed, m.id, m.readingProgress, m.readAnchor);
      case "setTags":
        return this.setTags(parsed, m.id, m.tags);
      case "setNote":
        return this.setNote(m.id, m.note);
      case "delete":
        return this.delete(parsed, m.id);
      case "addHighlight":
        await this.addHighlight(m.id, {
          text: m.text,
          color: m.color,
          note: m.note,
          startSelector: m.startSelector,
          startOffset: m.startOffset,
          endSelector: m.endSelector,
          endOffset: m.endOffset,
        });
        return;
      case "removeHighlight":
        return this.removeHighlight(m.highlightId);
      case "markRead":
        return this.markRead(parsed, m.id, m.read);
    }
  }

  /**
   * The ONLY place that maps an aspect to a backend call per source. A backend
   * that has no home for an aspect simply no-ops here — the glue overlay write in
   * the caller still records the change. Backend writes run BEFORE the overlay
   * write, so a backend failure aborts the mutation (surfaced as a sync conflict)
   * rather than leaving the overlay ahead of a backend that never accepted it.
   */
  private async toBackend(parsed: ParsedId, write: BackendWrite): Promise<void> {
    if (parsed.source === "readeck") {
      const b = this.deps.readLater;
      switch (write.aspect) {
        case "archived":
          return b.setArchived(parsed.sourceId, write.value);
        case "labels":
          return b.setLabels(parsed.sourceId, write.value);
        case "progress":
          return b.setReadingProgress(parsed.sourceId, write.value, write.anchor);
        case "removed":
          return b.delete(parsed.sourceId);
        case "read":
          // Readeck read-state is derived from archive + progress, not set directly.
          return;
      }
    }
    if (parsed.source === "miniflux") {
      switch (write.aspect) {
        case "read":
          return this.deps.rss.setRead(parsed.sourceId, write.value);
        case "removed":
          return void this.deps.rss.setRemoved([parsed.sourceId]);
        default:
          // MiniFlux owns nothing else user-writable.
          return;
      }
    }
  }

  /**
   * Unified location. Readeck maps non-archive locations (shortlist/later/inbox)
   * to `is_archived=false`; the unified location itself is glue-owned for both
   * sources (Readeck has no native equivalent for the non-archive locations).
   */
  async setLocation(parsed: ParsedId, id: string, location: Location): Promise<void> {
    await this.toBackend(parsed, {
      aspect: "archived",
      value: locationToReadeckArchived(location),
    });
    await this.deps.overlay.upsertOverlay(id, { location });
  }

  async setTags(parsed: ParsedId, id: string, tags: string[]): Promise<void> {
    await this.toBackend(parsed, { aspect: "labels", value: tags });
    await this.deps.overlay.upsertOverlay(id, { tags });
  }

  async setProgress(
    parsed: ParsedId,
    id: string,
    progress: number,
    anchor: string | null,
  ): Promise<void> {
    await this.toBackend(parsed, { aspect: "progress", value: progress, anchor });
    await this.deps.overlay.upsertOverlay(id, { readProgress: progress, readAnchor: anchor });
    // Scrolling past the finished threshold marks the article read. Readeck
    // derives this from the stored progress (see `deriveReadeckReadState`), but
    // MiniFlux owns read-state independently of progress, so flip its read flag
    // here — otherwise the next poll would re-derive the entry as unread.
    if (parsed.source === "miniflux" && progress >= FINISHED_THRESHOLD) {
      await this.toBackend(parsed, { aspect: "read", value: true });
      await this.deps.overlay.markIndexedRead(id, true);
    }
  }

  /** Note is glue-owned for every source. */
  async setNote(id: string, note: string | null): Promise<void> {
    await this.deps.overlay.upsertOverlay(id, { note });
  }

  /** Title is glue-owned (PATCH only; there is no `setTitle` sync mutation). */
  async setTitle(id: string, title: string): Promise<void> {
    await this.deps.overlay.upsertOverlay(id, { title });
  }

  /**
   * Highlights are glue-owned for every source: the client computes stable
   * block-relative anchors and renders them itself, so we don't round-trip through
   * Readeck's annotation selector format. This keeps highlight counts consistent
   * under the index-backed read path.
   */
  async addHighlight(id: string, input: NewHighlight): Promise<Highlight> {
    return this.deps.overlay.addRssHighlight(id, input);
  }

  async removeHighlight(highlightId: string): Promise<void> {
    const ok = await this.deps.overlay.removeRssHighlight(highlightId);
    if (!ok) throw new Error(`highlight not found: ${highlightId}`);
  }

  /** RSS read-state lives in MiniFlux; mirror it into the index so the unread
   * feed/newspaper reflect "seen" immediately, before the next backend poll. */
  async markRead(parsed: ParsedId, id: string, read: boolean): Promise<void> {
    await this.toBackend(parsed, { aspect: "read", value: read });
    await this.deps.overlay.markIndexedRead(id, read);
  }

  /**
   * Full delete: remove AT THE SOURCE so the 5-minute poll can't re-add it (and
   * `indexFromBackend` can't clear the tombstone), then tombstone the local index
   * row so the deletion propagates to other devices via `/sync`.
   *  - Readeck: `DELETE /api/bookmarks/{id}` (404 treated as already-gone).
   *  - MiniFlux: set the entry `removed` (no hard delete exists); the poll excludes
   *    `removed` entries so it won't reappear.
   */
  async delete(parsed: ParsedId, id: string): Promise<void> {
    await this.toBackend(parsed, { aspect: "removed" });
    await this.deps.overlay.softDelete([id]);
  }
}
