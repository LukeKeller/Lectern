import type { Highlight, Location, Mutation, NewHighlight } from "@lectern/shared";
import { locationToReadeckArchived, type OverlayStore } from "./unify";
import type { ReadLaterBackend, RssBackend } from "@lectern/shared";
import { parseId, type ParsedId } from "./ids";

/**
 * Per-field write routing, shared by `PATCH /documents/:id` and `POST /sync`.
 * Each unified field is owned by exactly one store:
 *   - Readeck owns: reading progress, archive flag, labels, highlights.
 *   - MiniFlux owns: nothing user-writable (entry tags are feed-derived).
 *   - The glue DB owns: unified location, note, title, RSS progress/highlights,
 *     and unified tags for RSS documents.
 */
export interface MutationDeps {
  rss: RssBackend;
  readLater: ReadLaterBackend;
  overlay: OverlayStore;
}

export async function applyLocation(
  deps: MutationDeps,
  parsed: ParsedId,
  id: string,
  location: Location,
): Promise<void> {
  if (parsed.source === "readeck") {
    await deps.readLater.setArchived(parsed.sourceId, locationToReadeckArchived(location));
  }
  // Store the unified location in the glue overlay for both sources; for Readeck
  // non-archive locations (shortlist/later/inbox) have no native equivalent.
  await deps.overlay.upsertOverlay(id, { location });
}

export async function applyTags(
  deps: MutationDeps,
  parsed: ParsedId,
  id: string,
  tags: string[],
): Promise<void> {
  if (parsed.source === "readeck") {
    await deps.readLater.setLabels(parsed.sourceId, tags);
  }
  // Always mirror into the index so the read path (now index-backed) reflects
  // the change immediately, before the next backend poll.
  await deps.overlay.upsertOverlay(id, { tags });
}

export async function applyProgress(
  deps: MutationDeps,
  parsed: ParsedId,
  id: string,
  progress: number,
  anchor: string | null,
): Promise<void> {
  if (parsed.source === "readeck") {
    await deps.readLater.setReadingProgress(parsed.sourceId, progress, anchor);
  }
  await deps.overlay.upsertOverlay(id, { readProgress: progress, readAnchor: anchor });
}

export async function applyNote(
  deps: MutationDeps,
  _parsed: ParsedId,
  id: string,
  note: string | null,
): Promise<void> {
  await deps.overlay.upsertOverlay(id, { note });
}

export async function applyAddHighlight(
  deps: MutationDeps,
  parsed: ParsedId,
  id: string,
  input: NewHighlight,
): Promise<Highlight> {
  return parsed.source === "readeck"
    ? deps.readLater.addHighlight(parsed.sourceId, input)
    : deps.overlay.addRssHighlight(id, input);
}

export async function applyRemoveHighlight(
  deps: MutationDeps,
  parsed: ParsedId,
  highlightId: string,
): Promise<void> {
  if (parsed.source === "readeck") {
    await deps.readLater.removeHighlight(parsed.sourceId, highlightId);
  } else {
    const ok = await deps.overlay.removeRssHighlight(highlightId);
    if (!ok) throw new Error(`highlight not found: ${highlightId}`);
  }
}

/** Apply a single queued offline mutation to its owning store. */
export async function applyMutation(deps: MutationDeps, m: Mutation): Promise<void> {
  const parsed = parseId(m.id);
  if (!parsed) throw new Error(`invalid document id: ${m.id}`);
  switch (m.type) {
    case "setLocation":
      return applyLocation(deps, parsed, m.id, m.location);
    case "setReadingProgress":
      return applyProgress(deps, parsed, m.id, m.readingProgress, m.readAnchor);
    case "setTags":
      return applyTags(deps, parsed, m.id, m.tags);
    case "setNote":
      return applyNote(deps, parsed, m.id, m.note);
    case "delete":
      return deps.overlay.deleteDocument(m.id);
    case "addHighlight":
      await applyAddHighlight(deps, parsed, m.id, {
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
      return applyRemoveHighlight(deps, parsed, m.highlightId);
  }
}
