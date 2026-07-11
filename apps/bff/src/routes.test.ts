import { beforeEach, describe, expect, it } from "vitest";
import {
  Card,
  DiscoveryCandidate,
  DiscoveryConfig,
  DiscoveryProfile,
  DiscoveryRun,
  DiscoverySeed,
  DiscoveryVote,
  Feed,
  FINISHED_THRESHOLD,
  PlayerState,
  type BackendPage,
  type BackendResource,
  type BackendListParams,
  type CandidateStatus,
  type CreateCandidateInput,
  type CreateRunRequest,
  type CreateViewRequest,
  type FeedFolder,
  type Highlight,
  type NewHighlight,
  type ReadLaterBackend,
  type RssBackend,
  type SearchResult,
  type Source,
  type SourceThemeSummary,
  type SavedView,
  type Tag,
  type TagSuggestion,
  type TermVector,
  type TtsProvider,
  type UpdateDiscoverySettingsRequest,
  type UpdateRunRequest,
  type UpdateViewRequest,
  type VoteValue,
} from "@lectern/shared";
import { createHash } from "node:crypto";
import { normalizeUrl } from "./discovery-url";
import { groupFollowSuggestions } from "./overlay-store";
import { buildApp, type AppDeps } from "./app";
import type { TtsRouter } from "./backends/tts-router";
import { BackendHttpError } from "./errors";
import type { SourceThemeTokens } from "./source-theme";
import { config } from "./config";
import {
  mergeOverlay,
  UnificationService,
  type ChangedDocuments,
  type DocumentRef,
  type DocumentsPage,
  type ListDocumentsParams,
  type MaintenanceFilter,
  type Overlay,
  type OverlayPatch,
  type OverlayStore,
  type PodcastEpisodeRecord,
} from "./unify";

// ---- In-memory fakes (implement the real interfaces; no network) -----------

function makeCard(over: Partial<Card> & { id: string; source: Card["source"] }): Card {
  return Card.parse({
    sourceId: over.id.split(":")[1],
    category: over.source === "miniflux" ? "rss" : "article",
    location: over.source === "miniflux" ? "feed" : "later",
    title: "Untitled",
    url: "https://example.com/" + over.id,
    savedAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    ...over,
  });
}

class FakeRssBackend implements RssBackend {
  entries = new Map<string, Card>();
  content = new Map<string, string>();
  feeds: Feed[] = [];
  reads = new Map<string, boolean>();
  folders: FeedFolder[] = [];
  refreshed = 0;
  imported: string[] = [];

  async listEntries(): Promise<BackendPage<Card>> {
    return { items: [...this.entries.values()], nextCursor: null };
  }
  async getEntryContent(sourceId: string): Promise<string> {
    return this.content.get(sourceId) ?? "<article>rss</article>";
  }
  async setRead(sourceId: string, read: boolean): Promise<void> {
    this.reads.set(sourceId, read);
  }
  async setReadMany(sourceIds: string[], read: boolean): Promise<void> {
    for (const id of sourceIds) this.reads.set(id, read);
  }
  removed: string[] = [];
  async setRemoved(sourceIds: string[]): Promise<void> {
    for (const id of sourceIds) {
      this.removed.push(id);
      this.entries.delete(id);
    }
  }
  async setStarred(): Promise<void> {}
  async refresh(): Promise<void> {
    this.refreshed++;
  }
  async exportOpml(): Promise<string> {
    return "<opml/>";
  }
  async listFeeds(): Promise<{ feeds: Feed[]; folders: FeedFolder[] }> {
    return { feeds: this.feeds, folders: this.folders };
  }
  async subscribe(input: { feedUrl: string; folderId?: string }): Promise<Feed> {
    const feed = Feed.parse({
      id: String(this.feeds.length + 1),
      title: "New feed",
      feedUrl: input.feedUrl,
      folderId: input.folderId ?? null,
    });
    this.feeds.push(feed);
    return feed;
  }
  async updateFeed(id: string, patch: { folderId?: string | null; title?: string }): Promise<Feed> {
    const feed = this.feeds.find((f) => f.id === id);
    if (!feed) throw new Error(`no feed ${id}`);
    if (patch.title !== undefined) feed.title = patch.title;
    if (patch.folderId !== undefined) feed.folderId = patch.folderId;
    return feed;
  }
  async deleteFeed(id: string): Promise<void> {
    this.feeds = this.feeds.filter((f) => f.id !== id);
  }
  async importOpml(opml: string): Promise<string> {
    this.imported.push(opml);
    return "Feeds imported";
  }
}

class FakeReadLaterBackend implements ReadLaterBackend {
  bookmarks = new Map<string, Card>();
  highlights = new Map<string, Highlight[]>();
  content = new Map<string, string>();
  private seq = 0;

  async list(params: BackendListParams = {}): Promise<BackendPage<Card>> {
    const all = [...this.bookmarks.values()];
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const limit = params.pageSize ?? 50;
    const items = all.slice(offset, offset + limit);
    const next = offset + items.length;
    return { items, nextCursor: next < all.length ? String(next) : null };
  }
  async get(sourceId: string): Promise<Card> {
    const card = this.bookmarks.get(sourceId);
    if (!card) throw new Error(`not found: ${sourceId}`);
    return card;
  }
  async getContent(sourceId: string): Promise<string> {
    return this.content.get(sourceId) ?? "<article>readeck</article>";
  }
  resources = new Map<string, { contentType: string; bytes: Buffer }>();
  resourceCalls: { sourceId: string; ref: string }[] = [];
  async getResource(sourceId: string, ref: string): Promise<BackendResource> {
    this.resourceCalls.push({ sourceId, ref });
    const hit = this.resources.get(ref) ?? {
      contentType: "image/png",
      bytes: Buffer.from("PNGDATA"),
    };
    return {
      contentType: hit.contentType,
      contentLength: hit.bytes.length,
      body: (async function* () {
        yield new Uint8Array(hit.bytes);
      })(),
    };
  }
  async save(input: { url: string; html?: string; labels?: string[] }): Promise<string> {
    const sourceId = `b${++this.seq}`;
    this.bookmarks.set(
      sourceId,
      makeCard({
        id: `readeck:${sourceId}`,
        source: "readeck",
        url: input.url,
        title: "Saved",
        tags: input.labels ?? [],
      }),
    );
    return sourceId;
  }
  async createBookmark(input: {
    url: string;
    labels?: string[];
    archived?: boolean;
  }): Promise<string> {
    const sourceId = `b${++this.seq}`;
    this.bookmarks.set(
      sourceId,
      makeCard({
        id: `readeck:${sourceId}`,
        source: "readeck",
        url: input.url,
        title: "Imported",
        tags: input.labels ?? [],
        location: input.archived ? "archive" : "later",
      }),
    );
    return sourceId;
  }
  async setReadingProgress(
    sourceId: string,
    progress: number,
    anchor: string | null,
  ): Promise<void> {
    const card = await this.get(sourceId);
    this.bookmarks.set(sourceId, { ...card, readingProgress: progress, readAnchor: anchor });
  }
  async setArchived(sourceId: string, archived: boolean): Promise<void> {
    const card = await this.get(sourceId);
    this.bookmarks.set(sourceId, { ...card, location: archived ? "archive" : "later" });
  }
  async setLabels(sourceId: string, labels: string[]): Promise<void> {
    const card = await this.get(sourceId);
    this.bookmarks.set(sourceId, { ...card, tags: labels });
  }
  deleted: string[] = [];
  async delete(sourceId: string): Promise<void> {
    this.deleted.push(sourceId);
    this.bookmarks.delete(sourceId);
  }
  async listHighlights(sourceId: string): Promise<Highlight[]> {
    return this.highlights.get(sourceId) ?? [];
  }
  async addHighlight(sourceId: string, input: NewHighlight): Promise<Highlight> {
    const highlight: Highlight = {
      id: `h${++this.seq}`,
      documentId: `readeck:${sourceId}`,
      createdAt: "2026-06-02T00:00:00Z",
      ...input,
    };
    const list = this.highlights.get(sourceId) ?? [];
    list.push(highlight);
    this.highlights.set(sourceId, list);
    return highlight;
  }
  async removeHighlight(sourceId: string, highlightId: string): Promise<void> {
    const list = this.highlights.get(sourceId) ?? [];
    this.highlights.set(
      sourceId,
      list.filter((h) => h.id !== highlightId),
    );
  }
}

class FakeOverlayStore implements OverlayStore {
  index = new Map<string, Card>();
  overlays = new Map<string, OverlayPatch>();
  rssHighlights = new Map<string, Highlight[]>();
  views = new Map<string, SavedView>();
  deleted = new Map<string, string>();
  ttsConfig: {
    provider: TtsProvider;
    apiKey: string | null;
    voiceId: string;
    modelId: string;
  } = {
    provider: "elevenlabs",
    apiKey: null,
    voiceId: "rachel",
    modelId: "eleven_flash_v2_5",
  };
  audioCache = new Map<
    string,
    { mime: string; bytes: Buffer; documentId: string; charCount: number }
  >();
  private seq = 0;

  async listDocuments(params: ListDocumentsParams): Promise<DocumentsPage> {
    const all: Card[] = [];
    for (const id of this.index.keys()) {
      if (this.deleted.has(id)) continue;
      const card = await this.getIndexedCard(id);
      if (card) all.push(card);
    }
    let f = all;
    if (params.location) f = f.filter((c) => c.location === params.location);
    if (params.category) f = f.filter((c) => c.category === params.category);
    if (params.source) f = f.filter((c) => c.source === params.source);
    if (params.tag) f = f.filter((c) => c.tags.includes(params.tag as string));
    if (params.search) {
      const q = params.search.toLowerCase();
      f = f.filter((c) => c.title.toLowerCase().includes(q) || c.url.toLowerCase().includes(q));
    }
    f.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
    const offset = params.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
    const page = f.slice(offset, offset + params.pageSize);
    const nextCursor = offset + page.length < f.length ? String(offset + page.length) : null;
    return { cards: page, nextCursor };
  }

  async documentsChangedSince(since: string | undefined): Promise<ChangedDocuments> {
    const cards: Card[] = [];
    for (const id of this.index.keys()) {
      if (this.deleted.has(id)) continue;
      const card = await this.getIndexedCard(id);
      if (card && (!since || card.updatedAt > since)) cards.push(card);
    }
    const deletedIds: string[] = [];
    if (since) for (const [id, at] of this.deleted) if (at > since) deletedIds.push(id);
    return { cards, deletedIds };
  }

  async softDeleteMissing(source: Source, presentIds: Set<string>): Promise<number> {
    let n = 0;
    const now = new Date().toISOString();
    for (const [id, card] of this.index) {
      if (card.source !== source || this.deleted.has(id)) continue;
      if (!presentIds.has(id)) {
        this.deleted.set(id, now);
        n++;
      }
    }
    return n;
  }

  async softDelete(ids: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const id of ids) if (this.index.has(id)) this.deleted.set(id, now);
  }

  async listByLocation(location: string): Promise<DocumentRef[]> {
    const out: DocumentRef[] = [];
    for (const [id, base] of this.index) {
      if (this.deleted.has(id)) continue;
      const card = await this.getIndexedCard(id);
      if (card?.location === location)
        out.push({ id, source: base.source, sourceId: base.sourceId });
    }
    return out;
  }

  async listReadBySource(source: Source): Promise<DocumentRef[]> {
    const out: DocumentRef[] = [];
    for (const [id, card] of this.index) {
      if (this.deleted.has(id) || card.source !== source) continue;
      if (card.readState === "finished")
        out.push({ id, source: card.source, sourceId: card.sourceId });
    }
    return out;
  }

  async listReadEmail(): Promise<DocumentRef[]> {
    const out: DocumentRef[] = [];
    for (const [id, card] of this.index) {
      if (this.deleted.has(id) || card.category !== "email") continue;
      if (card.readState === "finished" || card.readingProgress >= FINISHED_THRESHOLD)
        out.push({ id, source: card.source, sourceId: card.sourceId });
    }
    return out;
  }

  async listForMaintenance(filter: MaintenanceFilter): Promise<DocumentRef[]> {
    const out: DocumentRef[] = [];
    for (const [id, card] of this.index) {
      if (this.deleted.has(id)) continue;
      if (filter.location && card.location !== filter.location) continue;
      if (filter.category && card.category !== filter.category) continue;
      if (filter.source && card.source !== filter.source) continue;
      const ts = new Date(filter.dateField === "updatedAt" ? card.updatedAt : card.savedAt);
      const match = filter.inclusive ? ts <= filter.before : ts < filter.before;
      if (match) out.push({ id, source: card.source, sourceId: card.sourceId });
    }
    return out;
  }

  async markIndexedReadMany(ids: string[], read: boolean): Promise<void> {
    for (const id of ids) await this.markIndexedRead(id, read);
  }

  async listEmailSenders(): Promise<{ name: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const [id, card] of this.index) {
      if (this.deleted.has(id) || card.category !== "email") continue;
      const name = card.author ?? "";
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }));
  }

  async listEmailDocsBySender(sender: string): Promise<DocumentRef[]> {
    const target = sender.trim().toLowerCase();
    const out: DocumentRef[] = [];
    for (const [id, card] of this.index) {
      if (this.deleted.has(id) || card.category !== "email") continue;
      if ((card.author ?? "").toLowerCase() === target)
        out.push({ id, source: card.source, sourceId: card.sourceId });
    }
    return out;
  }

  emailIgnore: string[] = [];
  async getEmailIgnoreList(): Promise<string[]> {
    return this.emailIgnore;
  }
  async setEmailIgnoreList(senders: string[]): Promise<void> {
    const seen = new Set<string>();
    this.emailIgnore = [];
    for (const s of senders) {
      const t = s.trim();
      const k = t.toLowerCase();
      if (!t || seen.has(k)) continue;
      seen.add(k);
      this.emailIgnore.push(t);
    }
  }

  contents = new Map<string, string>();
  async getContent(id: string): Promise<{ html: string } | null> {
    const html = this.contents.get(id);
    return html === undefined ? null : { html };
  }
  async putContent(id: string, html: string): Promise<void> {
    if (html.trim()) this.contents.set(id, html);
  }
  async searchContent(q: string, limit: number): Promise<SearchResult[]> {
    const needle = q.toLowerCase();
    const hits: SearchResult[] = [];
    for (const [id, html] of this.contents) {
      if (this.deleted.has(id)) continue;
      const text = html.replace(/<[^>]+>/g, " ");
      const at = text.toLowerCase().indexOf(needle);
      if (at >= 0) hits.push({ id, snippet: text.slice(at, at + 60).trim(), rank: 1 });
    }
    return hits.slice(0, limit);
  }
  async relatedDocuments(id: string, limit: number): Promise<Card[] | null> {
    if (!this.index.has(id) || this.deleted.has(id)) return null;
    const out: Card[] = [];
    for (const other of this.index.keys()) {
      if (other === id || this.deleted.has(other)) continue;
      const card = await this.getIndexedCard(other);
      if (card) out.push(card);
      if (out.length >= limit) break;
    }
    return out;
  }
  async tagSuggestions(id: string): Promise<TagSuggestion[] | null> {
    if (!this.index.has(id) || this.deleted.has(id)) return null;
    return [];
  }

  async getOverlays(ids: string[]): Promise<Record<string, Overlay>> {
    const out: Record<string, Overlay> = {};
    for (const id of ids) {
      const o = this.overlays.get(id);
      if (o) out[id] = o;
    }
    return out;
  }
  async getRssHighlightCounts(ids: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const id of ids) {
      const c = this.rssHighlights.get(id)?.length ?? 0;
      if (c > 0) out[id] = c;
    }
    return out;
  }
  async getIndexedCard(id: string): Promise<Card | null> {
    const base = this.index.get(id);
    if (!base) return null;
    return mergeOverlay(base, this.overlays.get(id), this.rssHighlights.get(id)?.length ?? 0);
  }
  async upsertIndex(card: Card): Promise<void> {
    this.index.set(card.id, card);
    this.deleted.delete(card.id);
    this.overlays.set(card.id, {
      location: card.location,
      tags: card.tags,
      note: card.note,
      readProgress: card.readingProgress,
      readAnchor: card.readAnchor,
    });
  }
  async indexFromBackend(card: Card): Promise<void> {
    this.index.set(card.id, card);
    this.deleted.delete(card.id);
  }
  async isIndexed(id: string): Promise<boolean> {
    return this.index.has(id);
  }
  async markIndexedRead(id: string, read: boolean): Promise<void> {
    const base = this.index.get(id);
    if (base) this.index.set(id, { ...base, readState: read ? "finished" : "unopened" });
  }
  async deleteDocument(id: string): Promise<void> {
    this.index.delete(id);
    this.overlays.delete(id);
    this.rssHighlights.delete(id);
  }
  async upsertOverlay(id: string, patch: OverlayPatch): Promise<void> {
    this.overlays.set(id, { ...this.overlays.get(id), ...patch });
  }
  async listTags(): Promise<Tag[]> {
    const counts = new Map<string, number>();
    for (const id of this.index.keys()) {
      const card = await this.getIndexedCard(id);
      for (const tag of card?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }));
  }
  async listViews(): Promise<SavedView[]> {
    return [...this.views.values()].sort((a, b) => a.position - b.position);
  }
  async createView(input: CreateViewRequest): Promise<SavedView> {
    const view: SavedView = {
      id: `v${++this.seq}`,
      createdAt: "2026-06-02T00:00:00Z",
      updatedAt: "2026-06-02T00:00:00Z",
      ...input,
    };
    this.views.set(view.id, view);
    return view;
  }
  async updateView(id: string, patch: UpdateViewRequest): Promise<SavedView | null> {
    const view = this.views.get(id);
    if (!view) return null;
    const next = { ...view, ...patch, updatedAt: "2026-06-03T00:00:00Z" };
    this.views.set(id, next);
    return next;
  }
  async deleteView(id: string): Promise<boolean> {
    return this.views.delete(id);
  }
  async listRssHighlights(documentId: string): Promise<Highlight[]> {
    return this.rssHighlights.get(documentId) ?? [];
  }
  async addRssHighlight(documentId: string, input: NewHighlight): Promise<Highlight> {
    const highlight: Highlight = {
      id: `rh${++this.seq}`,
      documentId,
      createdAt: "2026-06-02T00:00:00Z",
      ...input,
    };
    const list = this.rssHighlights.get(documentId) ?? [];
    list.push(highlight);
    this.rssHighlights.set(documentId, list);
    return highlight;
  }
  async removeRssHighlight(highlightId: string): Promise<boolean> {
    for (const [docId, list] of this.rssHighlights) {
      const next = list.filter((h) => h.id !== highlightId);
      if (next.length !== list.length) {
        this.rssHighlights.set(docId, next);
        return true;
      }
    }
    return false;
  }

  async getTtsConfig() {
    return { ...this.ttsConfig };
  }
  async setTtsConfig(patch: {
    provider?: TtsProvider;
    apiKey?: string | null;
    voiceId?: string;
    modelId?: string;
  }) {
    if (patch.provider !== undefined) this.ttsConfig.provider = patch.provider;
    if (patch.apiKey !== undefined) this.ttsConfig.apiKey = patch.apiKey ? patch.apiKey : null;
    if (patch.voiceId !== undefined) this.ttsConfig.voiceId = patch.voiceId;
    if (patch.modelId !== undefined) this.ttsConfig.modelId = patch.modelId;
  }
  async getCachedAudio(contentHash: string) {
    const hit = this.audioCache.get(contentHash);
    return hit ? { mime: hit.mime, bytes: hit.bytes } : null;
  }
  async putCachedAudio(row: {
    contentHash: string;
    documentId: string;
    mime: string;
    bytes: Buffer;
    charCount: number;
  }) {
    if (!this.audioCache.has(row.contentHash)) {
      this.audioCache.set(row.contentHash, {
        mime: row.mime,
        bytes: row.bytes,
        documentId: row.documentId,
        charCount: row.charCount,
      });
    }
  }

  accentCache = new Map<string, string>();
  async getAccent(documentId: string): Promise<string | null | undefined> {
    if (!this.accentCache.has(documentId)) return undefined;
    const c = this.accentCache.get(documentId);
    return c === "" ? null : c;
  }
  async putAccent(documentId: string, color: string | null) {
    this.accentCache.set(documentId, color ?? "");
  }

  sourceThemeCache = new Map<string, { tokens: SourceThemeTokens; fetchedAt: Date }>();
  async getSourceTheme(
    host: string,
  ): Promise<{ tokens: SourceThemeTokens; fetchedAt: Date } | undefined> {
    return this.sourceThemeCache.get(host);
  }
  async putSourceTheme(host: string, theme: SourceThemeTokens) {
    this.sourceThemeCache.set(host, { tokens: theme, fetchedAt: new Date() });
  }
  async listSourceThemes(): Promise<SourceThemeSummary[]> {
    return [...this.sourceThemeCache.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([host, { tokens, fetchedAt }]) => ({
        host,
        accent: tokens.accent,
        accentDark: tokens.accentDark,
        background: tokens.background,
        backgroundDark: tokens.backgroundDark,
        text: tokens.text,
        link: tokens.link,
        bodyFont: tokens.bodyFont,
        displayFont: tokens.displayFont,
        faviconUrl: tokens.faviconUrl,
        siteName: tokens.siteName,
        derivation: tokens.derivation,
        fetchedAt: fetchedAt.toISOString(),
      }));
  }
  async clearSourceThemes(): Promise<void> {
    this.sourceThemeCache.clear();
  }

  player: PlayerState = PlayerState.parse({});
  async getPlayerState() {
    return this.player;
  }
  async setPlayerState(state: PlayerState) {
    this.player = PlayerState.parse({ ...state, updatedAt: "2026-06-04T00:00:00Z" });
    return this.player;
  }

  podcastToken: string | null = null;
  podcastEpisodes = new Map<string, PodcastEpisodeRecord>();
  async getPodcastToken() {
    return this.podcastToken;
  }
  async ensurePodcastToken() {
    if (!this.podcastToken) this.podcastToken = "feedtoken";
    return this.podcastToken;
  }
  async regeneratePodcastToken() {
    this.podcastToken = `feedtoken-${this.podcastEpisodes.size}-rotated`;
    return this.podcastToken;
  }
  async addPodcastEpisode(row: Omit<PodcastEpisodeRecord, "addedAt">) {
    const existing = this.podcastEpisodes.get(row.documentId);
    this.podcastEpisodes.set(row.documentId, {
      ...row,
      addedAt: existing?.addedAt ?? new Date("2026-06-04T00:00:00Z"),
    });
  }
  async listPodcastEpisodes() {
    return [...this.podcastEpisodes.values()].sort(
      (a, b) => b.addedAt.getTime() - a.addedAt.getTime(),
    );
  }
  async getPodcastEpisode(documentId: string) {
    return this.podcastEpisodes.get(documentId) ?? null;
  }

  // --- content discovery ---
  discoveryCandidates = new Map<string, DiscoveryCandidate>();
  candidateTermVectors = new Map<string, TermVector>();
  discoveryVotes: DiscoveryVote[] = [];
  processedVoteIds = new Set<number>();
  discoveryProfileRow: DiscoveryProfile | null = null;
  discoverySettings: DiscoveryConfig = DiscoveryConfig.parse({});
  discoveryRuns = new Map<string, DiscoveryRun>();
  private voteSeq = 0;

  async listCandidates(params: { status?: CandidateStatus; limit: number }) {
    let all = [...this.discoveryCandidates.values()];
    if (params.status) all = all.filter((c) => c.status === params.status);
    all.sort((a, b) => b.score - a.score);
    return all.slice(0, params.limit);
  }

  async insertCandidates(inputs: CreateCandidateInput[]) {
    const savedNorm = new Set<string>();
    for (const card of this.index.values()) if (card.url) savedNorm.add(normalizeUrl(card.url));
    const seen = new Set<string>();
    let inserted = 0;
    for (const input of inputs) {
      const norm = normalizeUrl(input.url);
      if (seen.has(norm)) continue;
      seen.add(norm);
      if (savedNorm.has(norm)) continue;
      const id = `disc:${createHash("sha1").update(norm).digest("hex")}`;
      if (this.discoveryCandidates.has(id)) continue;
      this.discoveryCandidates.set(
        id,
        DiscoveryCandidate.parse({
          id,
          url: input.url,
          title: input.title ?? null,
          excerpt: input.excerpt ?? null,
          fetcher: input.fetcher,
          score: input.score,
          status: "active",
          vote: null,
          runId: input.runId ?? null,
          author: input.author ?? null,
          siteName: input.siteName ?? null,
          imageUrl: input.imageUrl ?? null,
          publishedAt: input.publishedAt ?? null,
          firstSeenAt: "2026-06-01T00:00:00Z",
        }),
      );
      this.candidateTermVectors.set(id, input.termVector);
      inserted++;
    }
    return { inserted, skipped: inputs.length - inserted };
  }

  async getCandidate(id: string) {
    return this.discoveryCandidates.get(id) ?? null;
  }

  async setCandidateStatus(id: string, status: CandidateStatus, vote?: VoteValue | null) {
    const c = this.discoveryCandidates.get(id);
    if (!c) return null;
    const updated = { ...c, status, ...(vote !== undefined ? { vote } : {}) };
    this.discoveryCandidates.set(id, updated);
    return updated;
  }

  async recordVote(candidateId: string, value: VoteValue) {
    const c = this.discoveryCandidates.get(candidateId);
    if (!c) return null;
    this.discoveryVotes.push(
      DiscoveryVote.parse({
        id: ++this.voteSeq,
        candidateId,
        value,
        termVector: this.candidateTermVectors.get(candidateId) ?? {},
        createdAt: "2026-06-05T00:00:00Z",
      }),
    );
    const status = value === "down" ? "dismissed" : "active";
    const updated = { ...c, vote: value, status: status as CandidateStatus };
    this.discoveryCandidates.set(candidateId, updated);
    return updated;
  }

  async clearCandidates(ids?: string[]) {
    let cleared = 0;
    for (const [id, c] of this.discoveryCandidates) {
      if (c.status !== "active") continue;
      if (ids && ids.length > 0 && !ids.includes(id)) continue;
      this.discoveryCandidates.set(id, { ...c, status: "dismissed" as CandidateStatus });
      cleared++;
    }
    return cleared;
  }

  async listUnprocessedVotes() {
    return this.discoveryVotes.filter((v) => !this.processedVoteIds.has(v.id));
  }

  async putDiscoveryProfile(profile: DiscoveryProfile, processedVoteIds: number[]) {
    this.discoveryProfileRow = DiscoveryProfile.parse({
      ...profile,
      updatedAt: "2026-06-06T00:00:00Z",
    });
    for (const id of processedVoteIds) this.processedVoteIds.add(id);
    return this.discoveryProfileRow;
  }

  async getDiscoveryProfile() {
    return this.discoveryProfileRow ?? DiscoveryProfile.parse({});
  }

  async getDiscoverySettings() {
    return this.discoverySettings;
  }

  async setDiscoverySettings(patch: UpdateDiscoverySettingsRequest) {
    const next = { ...this.discoverySettings };
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.topics !== undefined) next.topics = patch.topics;
    if (patch.seedUrls !== undefined) next.seedUrls = patch.seedUrls;
    if (patch.fetchers !== undefined) next.fetchers = patch.fetchers;
    if (patch.schedule !== undefined) next.schedule = patch.schedule;
    if (patch.searxngUrl !== undefined) next.searxngUrl = patch.searxngUrl;
    if (patch.braveApiKey !== undefined) next.braveApiKey = patch.braveApiKey ?? "";
    if (patch.crawlDepth !== undefined) next.crawlDepth = patch.crawlDepth;
    if (patch.crawlTimeMs !== undefined) next.crawlTimeMs = patch.crawlTimeMs;
    if (patch.rocchio !== undefined) next.rocchio = patch.rocchio;
    if (patch.targetCount !== undefined) next.targetCount = patch.targetCount;
    if (patch.mutedDomains !== undefined) next.mutedDomains = patch.mutedDomains;
    if (patch.followDismissed !== undefined) next.followDismissed = patch.followDismissed;
    this.discoverySettings = DiscoveryConfig.parse(next);
  }

  async suggestFollowDomains(minSignals: number) {
    // Union saved + up-voted candidates by id, mirroring the Drizzle store.
    const byId = new Map<string, { url: string; title: string | null }>();
    for (const c of this.discoveryCandidates.values()) {
      if (c.status === "saved") byId.set(c.id, { url: c.url, title: c.title });
    }
    for (const v of this.discoveryVotes) {
      if (v.value !== "up") continue;
      const c = this.discoveryCandidates.get(v.candidateId);
      if (c && !byId.has(c.id)) byId.set(c.id, { url: c.url, title: c.title });
    }
    return groupFollowSuggestions([...byId.values()], minSignals);
  }

  async buildDiscoverySeed() {
    return DiscoverySeed.parse({ docs: [], tags: [] });
  }

  async createRun(input: CreateRunRequest) {
    const run = DiscoveryRun.parse({
      id: input.id,
      status: "running",
      stage: input.stage,
      trigger: input.trigger,
      stats: {},
      error: null,
      startedAt: "2026-06-07T00:00:00Z",
      updatedAt: "2026-06-07T00:00:00Z",
      finishedAt: null,
    });
    this.discoveryRuns.set(run.id, run);
    return run;
  }

  async updateRun(id: string, patch: UpdateRunRequest) {
    const existing = this.discoveryRuns.get(id);
    if (!existing) return null;
    const next = { ...existing };
    if (patch.stage !== undefined) next.stage = patch.stage;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.error !== undefined) next.error = patch.error;
    if (patch.stats !== undefined) next.stats = { ...existing.stats, ...patch.stats };
    next.updatedAt = "2026-06-08T00:00:00Z";
    if (patch.status !== undefined && patch.status !== "running")
      next.finishedAt = "2026-06-08T00:00:00Z";
    const parsed = DiscoveryRun.parse(next);
    this.discoveryRuns.set(id, parsed);
    return parsed;
  }

  async listRuns(limit: number) {
    return [...this.discoveryRuns.values()]
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
      .slice(0, limit);
  }

  async getLatestRun() {
    return (await this.listRuns(1))[0] ?? null;
  }

  async getRun(id: string) {
    return this.discoveryRuns.get(id) ?? null;
  }
}

class FakeTtsBackend {
  calls: { text: string; voiceId: string; modelId: string }[] = [];
  voices = [{ id: "rachel", name: "Rachel" }];
  voicesError = false;
  async synthesize(text: string, opts: { apiKey: string; voiceId: string; modelId: string }) {
    this.calls.push({ text, voiceId: opts.voiceId, modelId: opts.modelId });
    return Buffer.from(`audio:${text.length}`);
  }
  async listVoices() {
    if (this.voicesError)
      throw new BackendHttpError("elevenlabs", 401, null, "no voices permission");
    return this.voices;
  }
  usage = {
    tier: "creator",
    status: "active",
    characterCount: 12_345,
    characterLimit: 100_000,
    nextResetUnix: 1_750_000_000,
  };
  async getUsage() {
    return this.usage;
  }
}

/** In-memory discovery trigger: counts calls (and can be told to throw to
 *  exercise the `triggered:false` path). */
class FakeDiscoveryTrigger {
  calls = 0;
  shouldThrow = false;
  async triggerRun(): Promise<void> {
    this.calls++;
    if (this.shouldThrow) throw new Error("worker unreachable");
  }
}

// ---- Test harness ----------------------------------------------------------

interface Harness {
  deps: AppDeps & {
    rss: FakeRssBackend;
    readLater: FakeReadLaterBackend;
    overlay: FakeOverlayStore;
    tts: TtsRouter;
    discovery: FakeDiscoveryTrigger;
  };
  /** The single fake backend the router resolves to (for call assertions). */
  tts: FakeTtsBackend;
  discovery: FakeDiscoveryTrigger;
}

function makeHarness(): Harness {
  const rss = new FakeRssBackend();
  const readLater = new FakeReadLaterBackend();
  const overlay = new FakeOverlayStore();
  const unify = new UnificationService(overlay);
  const tts = new FakeTtsBackend();
  const discovery = new FakeDiscoveryTrigger();
  // One fake serves every provider; the router just hands it back.
  const ttsRouter: TtsRouter = { forProvider: () => tts };
  return { deps: { rss, readLater, overlay, unify, tts: ttsRouter, discovery }, tts, discovery };
}

const TOKEN = config.LECTERN_API_TOKEN;
const auth = { authorization: `Bearer ${TOKEN}` };

let harness: Harness;

beforeEach(() => {
  harness = makeHarness();
});

function app() {
  return buildApp(harness.deps);
}

/** Simulate the ingestion poll: index every backend item into the overlay so the
 *  index-backed read path (GET /documents, GET /sync) can see backend-seeded data. */
async function poll(): Promise<void> {
  for (const card of harness.deps.rss.entries.values()) {
    await harness.deps.overlay.indexFromBackend(card);
  }
  for (const card of harness.deps.readLater.bookmarks.values()) {
    await harness.deps.overlay.indexFromBackend(card);
  }
}

describe("auth", () => {
  it("rejects /api/v1 without a bearer token (401)", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/documents" });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it("rejects /api/v1 with a wrong bearer token (401)", async () => {
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents",
      headers: { authorization: "Bearer nope" },
    });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it("allows /api/v1 with the correct bearer token", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/documents", headers: auth });
    expect(res.statusCode).toBe(200);
    await a.close();
  });

  it("serves the openapi document without auth", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(res.json().openapi).toBe("3.1.0");
    await a.close();
  });
});

describe("documents", () => {
  it("lists merged documents from both backends and applies filters", async () => {
    harness.deps.rss.entries.set(
      "1",
      makeCard({ id: "miniflux:1", source: "miniflux", tags: ["dev"] }),
    );
    harness.deps.readLater.bookmarks.set(
      "b1",
      makeCard({ id: "readeck:b1", source: "readeck", tags: ["news"] }),
    );
    const a = app();
    await poll();

    const all = await a.inject({ method: "GET", url: "/api/v1/documents", headers: auth });
    expect(all.statusCode).toBe(200);
    expect(all.json().count).toBe(2);

    const filtered = await a.inject({
      method: "GET",
      url: "/api/v1/documents?source=miniflux",
      headers: auth,
    });
    expect(filtered.json().results).toHaveLength(1);
    expect(filtered.json().results[0].id).toBe("miniflux:1");

    const byTag = await a.inject({
      method: "GET",
      url: "/api/v1/documents?tag=news",
      headers: auth,
    });
    expect(byTag.json().results).toHaveLength(1);
    expect(byTag.json().results[0].id).toBe("readeck:b1");
    await a.close();
  });

  it("rejects an invalid pageSize (400)", async () => {
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents?pageSize=abc",
      headers: auth,
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });

  it("gets a readeck document live and overlays glue note", async () => {
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    harness.deps.overlay.overlays.set("readeck:b1", { note: "remember this" });
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().note).toBe("remember this");
    await a.close();
  });

  it("gets an rss document from the index", async () => {
    await harness.deps.overlay.indexFromBackend(makeCard({ id: "miniflux:5", source: "miniflux" }));
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents/miniflux:5",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("miniflux:5");
    await a.close();
  });

  it("captures article content on first read and serves the owned copy after", async () => {
    harness.deps.readLater.content.set("b1", "<article>hello world body</article>");
    const a = app();
    const first = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(first.json().html).toContain("hello world");
    // Backend changes; we keep serving the captured copy (ownership / resilience).
    harness.deps.readLater.content.set("b1", "<article>CHANGED</article>");
    const second = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(second.json().html).toContain("hello world");
    expect(second.json().html).not.toContain("CHANGED");
    await a.close();
  });

  it("re-extracts from the source and overwrites the cache on ?refresh=1", async () => {
    harness.deps.readLater.content.set("b1", "<article>original capture</article>");
    const a = app();
    // First read captures and owns the copy.
    const first = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(first.json().html).toContain("original capture");
    // The source now has a better/fuller body; a plain read still serves the cache.
    harness.deps.readLater.content.set("b1", "<article>fuller fixed body</article>");
    const cached = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(cached.json().html).toContain("original capture");
    // refresh=1 bypasses the cache, re-extracts, and overwrites it.
    const refreshed = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content?refresh=1",
      headers: auth,
    });
    expect(refreshed.json().html).toContain("fuller fixed body");
    // Subsequent plain reads now serve the refreshed copy.
    const after = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(after.json().html).toContain("fuller fixed body");
    await a.close();
  });

  it("ignores a cached body with no readable text and re-fetches it", async () => {
    // An earlier failed scrape cached empty markup for a feed item; the reader
    // should re-fetch (and now get the feed-provided body) instead of showing blank.
    await harness.deps.overlay.putContent("miniflux:42", "<p></p><p></p>");
    harness.deps.rss.content.set("42", "<article>full bluesky post</article>");
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents/miniflux:42/content",
      headers: auth,
    });
    expect(res.json().html).toContain("full bluesky post");
    await a.close();
  });

  it("full-text searches owned article bodies", async () => {
    harness.deps.readLater.content.set("b1", "<article>the quick brown fox jumps</article>");
    const a = app();
    // Capture the body via the content endpoint, then search it.
    await a.inject({ method: "GET", url: "/api/v1/documents/readeck:b1/content", headers: auth });
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/search?q=brown%20fox",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json().results as { id: string }[]).map((r) => r.id)).toContain("readeck:b1");
    // A miss returns no rows.
    const miss = await a.inject({
      method: "GET",
      url: "/api/v1/search?q=nonexistentzzz",
      headers: auth,
    });
    expect(miss.json().results).toHaveLength(0);
    await a.close();
  });

  it("saves a document via Readeck and returns a Card (201)", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: auth,
      payload: { url: "https://example.com/post", tags: ["read"], location: "later" },
    });
    expect(res.statusCode).toBe(201);
    const card = res.json();
    expect(card.source).toBe("readeck");
    expect(card.tags).toEqual(["read"]);
    expect(harness.deps.overlay.index.has(card.id)).toBe(true);
    await a.close();
  });

  it("rejects saving an invalid url (400)", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents",
      headers: auth,
      payload: { url: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("validation");
    await a.close();
  });

  it("updates a readeck document: archive flag + glue note", async () => {
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/documents/readeck:b1",
      headers: auth,
      payload: { location: "archive", note: "done" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().location).toBe("archive");
    expect(res.json().note).toBe("done");
    expect(harness.deps.readLater.bookmarks.get("b1")!.location).toBe("archive");
    await a.close();
  });

  it("updates an rss document via the glue overlay", async () => {
    await harness.deps.overlay.indexFromBackend(makeCard({ id: "miniflux:7", source: "miniflux" }));
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/documents/miniflux:7",
      headers: auth,
      payload: { tags: ["saved"], readingProgress: 0.5 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tags).toEqual(["saved"]);
    expect(res.json().readingProgress).toBe(0.5);
    await a.close();
  });

  it("full-deletes an rss document: removes it at MiniFlux and tombstones it", async () => {
    harness.deps.rss.entries.set("9", makeCard({ id: "miniflux:9", source: "miniflux" }));
    await poll();
    const a = app();
    const res = await a.inject({
      method: "DELETE",
      url: "/api/v1/documents/miniflux:9",
      headers: auth,
    });
    expect(res.statusCode).toBe(204);
    // Removed at the source so the poll can't re-add it...
    expect(harness.deps.rss.removed).toContain("9");
    // ...and tombstoned locally (row kept so /sync reports the deletion).
    expect(harness.deps.overlay.deleted.has("miniflux:9")).toBe(true);
    await a.close();
  });

  it("full-deletes a readeck document: deletes the bookmark and tombstones it", async () => {
    harness.deps.readLater.bookmarks.set("b9", makeCard({ id: "readeck:b9", source: "readeck" }));
    await poll();
    const a = app();
    const res = await a.inject({
      method: "DELETE",
      url: "/api/v1/documents/readeck:b9",
      headers: auth,
    });
    expect(res.statusCode).toBe(204);
    expect(harness.deps.readLater.deleted).toContain("b9");
    expect(harness.deps.overlay.deleted.has("readeck:b9")).toBe(true);
    await a.close();
  });

  it("bulk-deletes the archive across both sources and tombstones them", async () => {
    harness.deps.readLater.bookmarks.set(
      "b1",
      makeCard({ id: "readeck:b1", source: "readeck", location: "archive" }),
    );
    harness.deps.rss.entries.set(
      "1",
      makeCard({ id: "miniflux:1", source: "miniflux", location: "archive" }),
    );
    harness.deps.readLater.bookmarks.set(
      "b2",
      makeCard({ id: "readeck:b2", source: "readeck", location: "later" }),
    );
    await poll();
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/bulk-delete",
      headers: auth,
      payload: { scope: "archive" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(2);
    expect(harness.deps.readLater.deleted).toContain("b1");
    expect(harness.deps.rss.removed).toContain("1");
    expect(harness.deps.overlay.deleted.has("readeck:b1")).toBe(true);
    expect(harness.deps.overlay.deleted.has("miniflux:1")).toBe(true);
    // The non-archived bookmark is untouched.
    expect(harness.deps.overlay.deleted.has("readeck:b2")).toBe(false);
    await a.close();
  });

  it("bulk-deletes read feed items via MiniFlux setRemoved only", async () => {
    harness.deps.rss.entries.set(
      "1",
      makeCard({ id: "miniflux:1", source: "miniflux", readState: "finished" }),
    );
    harness.deps.rss.entries.set(
      "2",
      makeCard({ id: "miniflux:2", source: "miniflux", readState: "unopened" }),
    );
    await poll();
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/bulk-delete",
      headers: auth,
      payload: { scope: "read-feed" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(1);
    expect(harness.deps.rss.removed).toEqual(["1"]);
    expect(harness.deps.overlay.deleted.has("miniflux:1")).toBe(true);
    expect(harness.deps.overlay.deleted.has("miniflux:2")).toBe(false);
    await a.close();
  });

  it("read-all deletes read feed items AND read newsletters, leaving unread", async () => {
    // Read + unread feed item.
    harness.deps.rss.entries.set(
      "1",
      makeCard({ id: "miniflux:1", source: "miniflux", readState: "finished" }),
    );
    harness.deps.rss.entries.set(
      "2",
      makeCard({ id: "miniflux:2", source: "miniflux", readState: "unopened" }),
    );
    // Read (progress complete) + unread newsletter.
    harness.deps.readLater.bookmarks.set(
      "e1",
      makeCard({
        id: "readeck:e1",
        source: "readeck",
        category: "email",
        readingProgress: 1,
      }),
    );
    harness.deps.readLater.bookmarks.set(
      "e2",
      makeCard({
        id: "readeck:e2",
        source: "readeck",
        category: "email",
        readingProgress: 0,
      }),
    );
    await poll();
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/bulk-delete",
      headers: auth,
      payload: { scope: "read-all" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(2);
    expect(harness.deps.overlay.deleted.has("miniflux:1")).toBe(true);
    expect(harness.deps.overlay.deleted.has("readeck:e1")).toBe(true);
    expect(harness.deps.overlay.deleted.has("miniflux:2")).toBe(false);
    expect(harness.deps.overlay.deleted.has("readeck:e2")).toBe(false);
    await a.close();
  });

  it("returns article content routed to the owning backend", async () => {
    harness.deps.readLater.content.set("b1", "<article>hello</article>");
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "readeck:b1", html: "<article>hello</article>" });
    await a.close();
  });
});

describe("bulk maintenance (age sweep)", () => {
  it("deletes feed items older than the cutoff at the source and tombstones them", async () => {
    harness.deps.rss.entries.set(
      "1",
      makeCard({ id: "miniflux:1", source: "miniflux", savedAt: "2026-05-01T00:00:00Z" }),
    );
    harness.deps.rss.entries.set(
      "2",
      makeCard({ id: "miniflux:2", source: "miniflux", savedAt: "2026-06-08T00:00:00Z" }),
    );
    await poll();
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/bulk-maintenance",
      headers: auth,
      payload: {
        action: "delete",
        location: "feed",
        before: "2026-06-01T00:00:00Z",
        dateField: "savedAt",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ action: "delete", affected: 1 });
    expect(harness.deps.rss.removed).toEqual(["1"]);
    expect(harness.deps.overlay.deleted.has("miniflux:1")).toBe(true);
    expect(harness.deps.overlay.deleted.has("miniflux:2")).toBe(false);
    await a.close();
  });

  it("marks old feed items read at the source without deleting them", async () => {
    harness.deps.rss.entries.set(
      "1",
      makeCard({ id: "miniflux:1", source: "miniflux", savedAt: "2026-05-01T00:00:00Z" }),
    );
    await poll();
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/bulk-maintenance",
      headers: auth,
      payload: { action: "mark-read", location: "feed", before: "2026-06-01T00:00:00Z" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ action: "mark-read", affected: 1 });
    expect(harness.deps.rss.reads.get("1")).toBe(true);
    expect(harness.deps.overlay.deleted.has("miniflux:1")).toBe(false);
    const card = await harness.deps.overlay.getIndexedCard("miniflux:1");
    expect(card?.readState).toBe("finished");
    await a.close();
  });
});

describe("newsletter ignore list", () => {
  it("ignores a sender, persists it, and deletes its already-saved emails", async () => {
    harness.deps.readLater.bookmarks.set(
      "e1",
      makeCard({ id: "readeck:e1", source: "readeck", category: "email", author: "Morning Brew" }),
    );
    harness.deps.readLater.bookmarks.set(
      "e2",
      makeCard({ id: "readeck:e2", source: "readeck", category: "email", author: "Stratechery" }),
    );
    await poll();
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/settings/email-ignore",
      headers: auth,
      payload: { sender: "Morning Brew" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.senders).toContain("Morning Brew");
    expect(body.removed).toBe(1);
    expect(harness.deps.readLater.deleted).toContain("e1");
    expect(harness.deps.overlay.deleted.has("readeck:e1")).toBe(true);
    expect(harness.deps.overlay.deleted.has("readeck:e2")).toBe(false);
    expect(await harness.deps.overlay.getEmailIgnoreList()).toEqual(["Morning Brew"]);
    await a.close();
  });

  it("lists known senders and removes one from the ignore list", async () => {
    harness.deps.readLater.bookmarks.set(
      "e2",
      makeCard({ id: "readeck:e2", source: "readeck", category: "email", author: "Stratechery" }),
    );
    await poll();
    await harness.deps.overlay.setEmailIgnoreList(["spam@x.com"]);
    const a = app();
    const get = await a.inject({
      method: "GET",
      url: "/api/v1/settings/email-ignore",
      headers: auth,
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().senders).toEqual(["spam@x.com"]);
    expect(get.json().known).toContainEqual({ name: "Stratechery", count: 1 });
    const del = await a.inject({
      method: "DELETE",
      url: "/api/v1/settings/email-ignore",
      headers: auth,
      payload: { sender: "spam@x.com" },
    });
    expect(del.statusCode).toBe(200);
    expect(del.json().senders).toEqual([]);
    await a.close();
  });
});

describe("highlights", () => {
  it("creates and lists an RSS highlight via the glue store", async () => {
    const a = app();
    const created = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/highlights",
      headers: auth,
      payload: {
        text: "key idea",
        startSelector: "p:nth-child(1)",
        startOffset: 0,
        endSelector: "p:nth-child(1)",
        endOffset: 8,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const listed = await a.inject({
      method: "GET",
      url: "/api/v1/documents/miniflux:1/highlights",
      headers: auth,
    });
    expect(listed.json().highlights).toHaveLength(1);

    const del = await a.inject({
      method: "DELETE",
      url: `/api/v1/highlights/${id}`,
      headers: auth,
    });
    expect(del.statusCode).toBe(204);
    await a.close();
  });
});

describe("tags", () => {
  it("returns aggregated tag counts", async () => {
    await harness.deps.overlay.indexFromBackend(
      makeCard({ id: "miniflux:1", source: "miniflux", tags: ["a", "b"] }),
    );
    await harness.deps.overlay.indexFromBackend(
      makeCard({ id: "miniflux:2", source: "miniflux", tags: ["a"] }),
    );
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/tags", headers: auth });
    expect(res.statusCode).toBe(200);
    const byName = Object.fromEntries(res.json().tags.map((t: Tag) => [t.name, t.count]));
    expect(byName.a).toBe(2);
    expect(byName.b).toBe(1);
    await a.close();
  });
});

describe("source themes", () => {
  it("lists cached source themes and clears them", async () => {
    await harness.deps.overlay.putSourceTheme("overreacted.io", {
      accent: "#2563eb",
      accentDark: "#60a5fa",
      background: "#eff4fb",
      backgroundDark: "#0f172a",
      text: "#1a202c",
      link: "#2563eb",
      bodyFont: null,
      displayFont: "Inter",
      faviconUrl: "https://overreacted.io/favicon.png",
      siteName: "overreacted",
      derivation: "literal",
    });
    const a = app();

    const listed = await a.inject({
      method: "GET",
      url: "/api/v1/source-themes",
      headers: auth,
    });
    expect(listed.statusCode).toBe(200);
    const themes = listed.json().themes as SourceThemeSummary[];
    expect(themes).toHaveLength(1);
    expect(themes[0]!.host).toBe("overreacted.io");
    expect(themes[0]!.accent).toBe("#2563eb");
    expect(themes[0]!.siteName).toBe("overreacted");

    const cleared = await a.inject({
      method: "DELETE",
      url: "/api/v1/source-themes",
      headers: auth,
    });
    expect(cleared.statusCode).toBe(204);

    const after = await a.inject({
      method: "GET",
      url: "/api/v1/source-themes",
      headers: auth,
    });
    expect(after.json().themes).toHaveLength(0);
    await a.close();
  });
});

describe("views", () => {
  it("supports create, list, update, and delete", async () => {
    const a = app();
    const view = {
      name: "Unread dev",
      query: { kind: "term", field: "location", op: "eq", value: "inbox" },
      pinned: true,
      sortBy: "savedAt",
      sortDir: "desc",
    };
    const created = await a.inject({
      method: "POST",
      url: "/api/v1/views",
      headers: auth,
      payload: view,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;

    const listed = await a.inject({ method: "GET", url: "/api/v1/views", headers: auth });
    expect(listed.json().views).toHaveLength(1);

    const updated = await a.inject({
      method: "PATCH",
      url: `/api/v1/views/${id}`,
      headers: auth,
      payload: { name: "Renamed" },
    });
    expect(updated.json().name).toBe("Renamed");

    const del = await a.inject({ method: "DELETE", url: `/api/v1/views/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);

    const missing = await a.inject({
      method: "DELETE",
      url: `/api/v1/views/${id}`,
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
    await a.close();
  });

  it("round-trips a saved view's icon and position", async () => {
    const a = app();
    const created = await a.inject({
      method: "POST",
      url: "/api/v1/views",
      headers: auth,
      payload: {
        name: "Reads",
        query: { kind: "term", field: "location", op: "eq", value: "later" },
        pinned: true,
        icon: "📚",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().icon).toBe("📚");
    const id = created.json().id;
    const updated = await a.inject({
      method: "PATCH",
      url: `/api/v1/views/${id}`,
      headers: auth,
      payload: { icon: "📰", position: 3 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().icon).toBe("📰");
    expect(updated.json().position).toBe(3);
    await a.close();
  });
});

describe("sync", () => {
  it("pulls a combined delta", async () => {
    harness.deps.rss.entries.set("1", makeCard({ id: "miniflux:1", source: "miniflux" }));
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    const a = app();
    await poll();
    const res = await a.inject({ method: "GET", url: "/api/v1/sync", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().cards).toHaveLength(2);
    expect(typeof res.json().cursor).toBe("string");
    await a.close();
  });

  it("returns the full library and reports deletions on the next pull", async () => {
    for (let i = 0; i < 4; i++) {
      harness.deps.readLater.bookmarks.set(
        `b${i}`,
        makeCard({ id: `readeck:b${i}`, source: "readeck", url: `https://x.test/${i}` }),
      );
    }
    harness.deps.rss.entries.set("1", makeCard({ id: "miniflux:1", source: "miniflux" }));
    const a = app();
    await poll();

    // Full snapshot (no cursor): every indexed document, no duplicates.
    const first = await a.inject({ method: "GET", url: "/api/v1/sync", headers: auth });
    const ids = (first.json().cards as { id: string }[]).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(5); // 4 read-later + 1 rss
    const cursor = first.json().cursor as string;

    // A backend item disappears (e.g. dedup); reconcile tombstones it.
    await new Promise((r) => setTimeout(r, 5));
    harness.deps.readLater.bookmarks.delete("b0");
    await harness.deps.overlay.softDeleteMissing(
      "readeck",
      new Set(["readeck:b1", "readeck:b2", "readeck:b3"]),
    );

    // The next pull reports the deletion instead of a stale card.
    const next = await a.inject({
      method: "GET",
      url: `/api/v1/sync?since=${encodeURIComponent(cursor)}`,
      headers: auth,
    });
    expect(next.json().deletedIds).toContain("readeck:b0");
    expect((next.json().cards as { id: string }[]).map((c) => c.id)).not.toContain("readeck:b0");
    await a.close();
  });

  it("pushes mutations and reports applied + conflicts", async () => {
    harness.deps.readLater.bookmarks.set("b1", makeCard({ id: "readeck:b1", source: "readeck" }));
    await harness.deps.overlay.indexFromBackend(makeCard({ id: "miniflux:2", source: "miniflux" }));
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: auth,
      payload: {
        mutations: [
          { type: "setLocation", id: "readeck:b1", location: "archive" },
          { type: "setTags", id: "miniflux:2", tags: ["x"] },
          { type: "removeHighlight", id: "miniflux:2", highlightId: "missing" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toBe(2);
    expect(res.json().conflicts).toHaveLength(1);
    expect(res.json().conflicts[0].id).toBe("miniflux:2");
    await a.close();
  });

  it("markRead flags an RSS entry read in MiniFlux and the index", async () => {
    harness.deps.rss.entries.set(
      "5",
      makeCard({ id: "miniflux:5", source: "miniflux", readState: "unopened" }),
    );
    await poll();
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: auth,
      payload: { mutations: [{ type: "markRead", id: "miniflux:5", read: true }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().applied).toBe(1);
    expect(harness.deps.rss.reads.get("5")).toBe(true);
    const card = await harness.deps.overlay.getIndexedCard("miniflux:5");
    expect(card?.readState).toBe("finished");
    await a.close();
  });

  it("rejects a malformed mutation payload (400)", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/sync",
      headers: auth,
      payload: { mutations: [{ type: "bogus", id: "x" }] },
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });
});

describe("feeds", () => {
  it("lists feeds and folders", async () => {
    harness.deps.rss.feeds = [
      Feed.parse({
        id: "1",
        title: "Simon Willison's Weblog",
        feedUrl: "https://simonwillison.net/atom/everything/",
        siteUrl: "http://simonwillison.net/",
        folderId: "2",
        folderTitle: "Lectern Spike",
        unreadCount: 29,
      }),
    ];
    harness.deps.rss.folders = [{ id: "2", title: "Lectern Spike", unreadCount: 29 }];
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/feeds", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.feeds).toHaveLength(1);
    expect(body.feeds[0].id).toBe("1");
    expect(body.folders).toEqual([{ id: "2", title: "Lectern Spike", unreadCount: 29 }]);
    await a.close();
  });

  it("rejects /feeds without a bearer token (401)", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/feeds" });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it("subscribes to a feed (201) and returns the created feed", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/feeds",
      headers: auth,
      payload: { feedUrl: "https://example.com/feed.xml", folderId: "2" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().feedUrl).toBe("https://example.com/feed.xml");
    expect(res.json().folderId).toBe("2");
    expect(harness.deps.rss.feeds).toHaveLength(1);
    await a.close();
  });

  it("rejects a non-url feedUrl (400)", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/feeds",
      headers: auth,
      payload: { feedUrl: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
    await a.close();
  });

  it("renames / moves a feed via PATCH (200)", async () => {
    harness.deps.rss.feeds = [
      Feed.parse({ id: "1", title: "Old", feedUrl: "https://example.com/feed.xml" }),
    ];
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/feeds/1",
      headers: auth,
      payload: { title: "New", folderId: "3" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("New");
    expect(res.json().folderId).toBe("3");
    await a.close();
  });

  it("unsubscribes via DELETE (204)", async () => {
    harness.deps.rss.feeds = [
      Feed.parse({ id: "1", title: "Old", feedUrl: "https://example.com/feed.xml" }),
    ];
    const a = app();
    const res = await a.inject({ method: "DELETE", url: "/api/v1/feeds/1", headers: auth });
    expect(res.statusCode).toBe(204);
    expect(harness.deps.rss.feeds).toHaveLength(0);
    await a.close();
  });

  it("refreshes all feeds (202)", async () => {
    const a = app();
    const res = await a.inject({ method: "POST", url: "/api/v1/feeds/refresh", headers: auth });
    expect(res.statusCode).toBe(202);
    expect(harness.deps.rss.refreshed).toBe(1);
    await a.close();
  });

  it("imports OPML (200) and returns a status message", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/feeds/import",
      headers: auth,
      payload: { opml: "<opml/>" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toBe("Feeds imported");
    expect(harness.deps.rss.imported).toEqual(["<opml/>"]);
    await a.close();
  });
});

describe("readwise import", () => {
  it("POST /import/readwise creates a bookmark per http row and reports counts", async () => {
    const a = app();
    const csv = [
      "Title,Source URL,Document tags,Location",
      "A,https://a.test/1,news,later",
      "B,https://b.test/2,,archive",
      "skipme,,,",
    ].join("\n");
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/import/readwise",
      headers: auth,
      payload: { csv },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 2, imported: 2, failed: 0 });
    expect(harness.deps.readLater.bookmarks.size).toBe(2);
    await a.close();
  });

  it("maps Readwise locations to unified locations so imported items are visible", async () => {
    const a = app();
    const csv = [
      "Title,Source URL,Document tags,Location",
      "New one,https://a.test/new,,new",
      "Later one,https://b.test/later,,later",
      "Short one,https://c.test/short,reading,shortlist",
      "Archived one,https://d.test/arch,,archive",
      "Feed one,https://e.test/feed,,feed",
    ].join("\n");
    const imp = await a.inject({
      method: "POST",
      url: "/api/v1/import/readwise",
      headers: auth,
      payload: { csv },
    });
    expect(imp.json()).toMatchObject({ total: 5, imported: 5, failed: 0 });

    const res = await a.inject({ method: "GET", url: "/api/v1/documents", headers: auth });
    const byUrl = new Map<string, string>(
      (res.json().results as { url: string; location: string }[]).map((c) => [c.url, c.location]),
    );
    // The Readwise "new" location is the unified inbox: the default landing list.
    // Without an overlay these would all collapse to Readeck's archived-derived
    // "later"/"archive" and never appear in Inbox/Shortlist.
    expect(byUrl.get("https://a.test/new")).toBe("inbox");
    expect(byUrl.get("https://b.test/later")).toBe("later");
    expect(byUrl.get("https://c.test/short")).toBe("shortlist");
    expect(byUrl.get("https://d.test/arch")).toBe("archive");
    expect(byUrl.get("https://e.test/feed")).toBe("later");
    await a.close();
  });
});

describe("text-to-speech", () => {
  it("reports unconfigured with default voice/model, never leaking a key", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/settings/tts", headers: auth });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.configured).toBe(false);
    expect(body.modelId).toBe("eleven_flash_v2_5");
    expect(body).not.toHaveProperty("apiKey");
    await a.close();
  });

  it("PATCH stores the key + voice/model and flips configured without echoing the key", async () => {
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/settings/tts",
      headers: auth,
      payload: { apiKey: "sk-secret", voiceId: "v1", modelId: "eleven_multilingual_v2" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      configured: true,
      voiceId: "v1",
      modelId: "eleven_multilingual_v2",
    });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(harness.deps.overlay.ttsConfig.apiKey).toBe("sk-secret");
    await a.close();
  });

  it("returns 409 for synthesis when no key is configured", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/audio",
      headers: auth,
    });
    expect(res.statusCode).toBe(409);
    expect(harness.tts.calls).toHaveLength(0);
    await a.close();
  });

  it("synthesizes audio once, then serves the cache on a re-listen", async () => {
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    const a = app();
    const first = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/audio",
      headers: auth,
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("audio/mpeg");
    expect(first.headers["x-tts-content-hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(harness.tts.calls).toHaveLength(1);
    // Synthesis ran over the extracted plain text ("rss"), not raw HTML.
    expect(harness.tts.calls[0]!.text).toBe("rss");

    const second = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/audio",
      headers: auth,
    });
    expect(second.statusCode).toBe(200);
    expect(second.headers["x-tts-content-hash"]).toBe(first.headers["x-tts-content-hash"]);
    // Cache hit: ElevenLabs was NOT called again.
    expect(harness.tts.calls).toHaveLength(1);
    await a.close();
  });

  it("speaks the title before the body when a title is supplied", async () => {
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/audio",
      headers: auth,
      payload: { title: "A Grand Title" },
    });
    expect(res.statusCode).toBe(200);
    expect(harness.tts.calls[0]!.text).toBe("A Grand Title.\n\nrss");
    await a.close();
  });

  it("lists voices only when configured", async () => {
    const a = app();
    const unset = await a.inject({
      method: "GET",
      url: "/api/v1/settings/tts/voices",
      headers: auth,
    });
    expect(unset.statusCode).toBe(409);
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    const ok = await a.inject({ method: "GET", url: "/api/v1/settings/tts/voices", headers: auth });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { voices: unknown[] }).voices).toHaveLength(1);
    await a.close();
  });

  it("returns an empty voice list (not 502) when the key lacks the Voices permission", async () => {
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    harness.tts.voicesError = true;
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/settings/tts/voices",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { voices: unknown[] }).voices).toEqual([]);
    await a.close();
  });

  it("reports account usage only when configured, mapping the reset to ISO", async () => {
    const a = app();
    const unset = await a.inject({
      method: "GET",
      url: "/api/v1/settings/tts/usage",
      headers: auth,
    });
    expect(unset.statusCode).toBe(409);
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    const ok = await a.inject({ method: "GET", url: "/api/v1/settings/tts/usage", headers: auth });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      tier: "creator",
      status: "active",
      characterCount: 12_345,
      characterLimit: 100_000,
      nextResetAt: new Date(1_750_000_000 * 1000).toISOString(),
    });
    await a.close();
  });

  it("synthesizes with the Kokoro provider without an API key", async () => {
    // Kokoro is server-configured (no key); selecting it makes TTS ready.
    harness.deps.overlay.ttsConfig.provider = "kokoro";
    harness.deps.overlay.ttsConfig.apiKey = null;
    harness.deps.overlay.ttsConfig.voiceId = "af_heart";
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/audio",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(harness.tts.calls).toHaveLength(1);
    expect(harness.tts.calls[0]!.voiceId).toBe("af_heart");
    await a.close();
  });

  it("lists Kokoro voices without an API key", async () => {
    harness.deps.overlay.ttsConfig.provider = "kokoro";
    harness.deps.overlay.ttsConfig.apiKey = null;
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/settings/tts/voices",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { voices: unknown[] }).voices).toHaveLength(1);
    await a.close();
  });

  it("reports usage as unavailable (409) for the Kokoro provider", async () => {
    harness.deps.overlay.ttsConfig.provider = "kokoro";
    harness.deps.overlay.ttsConfig.apiKey = null;
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/settings/tts/usage", headers: auth });
    expect(res.statusCode).toBe(409);
    await a.close();
  });

  it("PATCH switches the provider and reports it back as configured", async () => {
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/settings/tts",
      headers: auth,
      payload: { provider: "kokoro", voiceId: "af_heart" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: "kokoro", configured: true, voiceId: "af_heart" });
    expect(harness.deps.overlay.ttsConfig.provider).toBe("kokoro");
    await a.close();
  });

  it("previews a voice once then serves the cached sample", async () => {
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    const a = app();
    const first = await a.inject({
      method: "POST",
      url: "/api/v1/settings/tts/preview",
      headers: auth,
      payload: { voiceId: "voice-xyz" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("audio/mpeg");
    expect(harness.tts.calls).toHaveLength(1);
    expect(harness.tts.calls[0]!.voiceId).toBe("voice-xyz");

    const second = await a.inject({
      method: "POST",
      url: "/api/v1/settings/tts/preview",
      headers: auth,
      payload: { voiceId: "voice-xyz" },
    });
    expect(second.statusCode).toBe(200);
    expect(harness.tts.calls).toHaveLength(1); // cache hit, no re-synth
    await a.close();
  });

  it("returns 409 for a preview when no key is configured", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/settings/tts/preview",
      headers: auth,
      payload: { voiceId: "v" },
    });
    expect(res.statusCode).toBe(409);
    await a.close();
  });

  it("saves and returns the cross-device player state", async () => {
    const a = app();
    const empty = await a.inject({ method: "GET", url: "/api/v1/settings/player", headers: auth });
    expect(empty.statusCode).toBe(200);
    expect((empty.json() as { queue: unknown[] }).queue).toEqual([]);

    const saved = await a.inject({
      method: "PATCH",
      url: "/api/v1/settings/player",
      headers: auth,
      payload: { queue: [{ id: "miniflux:1", title: "A" }], index: 0, position: 42, rate: 1.5 },
    });
    expect(saved.statusCode).toBe(200);
    const body = saved.json() as {
      index: number;
      position: number;
      rate: number;
      updatedAt: string;
    };
    expect(body.position).toBe(42);
    expect(body.rate).toBe(1.5);
    expect(body.updatedAt).toBeTruthy();

    const reloaded = await a.inject({
      method: "GET",
      url: "/api/v1/settings/player",
      headers: auth,
    });
    expect((reloaded.json() as { queue: { id: string }[] }).queue[0]!.id).toBe("miniflux:1");
    await a.close();
  });
});

describe("podcast", () => {
  beforeEach(async () => {
    harness.deps.rss.entries.set(
      "1",
      makeCard({ id: "miniflux:1", source: "miniflux", title: "My Article" }),
    );
    await poll();
  });

  it("returns 409 when publishing with no key configured", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/podcast",
      headers: auth,
    });
    expect(res.statusCode).toBe(409);
    expect(harness.tts.calls).toHaveLength(0);
    await a.close();
  });

  it("renders once, returns episode metadata, and is idempotent per document", async () => {
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    const a = app();
    const first = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/podcast",
      headers: auth,
    });
    expect(first.statusCode).toBe(201);
    const ep = first.json() as Record<string, unknown>;
    expect(ep.documentId).toBe("miniflux:1");
    expect(ep.title).toBe("My Article");
    expect(ep.byteLength).toBeGreaterThan(0);
    // Title is spoken before the body, exactly like Listen.
    expect(harness.tts.calls[0]!.text).toBe("My Article.\n\nrss");
    expect(harness.tts.calls).toHaveLength(1);

    // Re-publishing reuses the cached audio (no second ElevenLabs call) and keeps
    // a single episode for the document.
    const second = await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/podcast",
      headers: auth,
    });
    expect(second.statusCode).toBe(201);
    expect(harness.tts.calls).toHaveLength(1);

    const settings = await a.inject({
      method: "GET",
      url: "/api/v1/settings/podcast",
      headers: auth,
    });
    const s = settings.json() as { feedUrl: string; episodeCount: number };
    expect(s.episodeCount).toBe(1);
    expect(s.feedUrl).toMatch(/\/podcast\/.+\/feed\.xml$/);
    await a.close();
  });

  it("serves a tokenized RSS feed and 404s an unknown token", async () => {
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    const a = app();
    await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/podcast",
      headers: auth,
    });
    const token = await harness.deps.overlay.ensurePodcastToken();

    const bad = await a.inject({ method: "GET", url: "/podcast/not-the-token/feed.xml" });
    expect(bad.statusCode).toBe(404);

    const feed = await a.inject({ method: "GET", url: `/podcast/${token}/feed.xml` });
    expect(feed.statusCode).toBe(200);
    expect(feed.headers["content-type"]).toContain("application/rss+xml");
    expect(feed.body).toContain("<itunes:");
    expect(feed.body).toContain("My Article");
    expect(feed.body).toContain("<enclosure");
    expect(feed.body).toContain(`/podcast/${token}/ep/miniflux%3A1.mp3`);
    await a.close();
  });

  it("streams episode audio and honours Range requests", async () => {
    harness.deps.overlay.ttsConfig.apiKey = "sk";
    const a = app();
    await a.inject({
      method: "POST",
      url: "/api/v1/documents/miniflux:1/podcast",
      headers: auth,
    });
    const token = await harness.deps.overlay.ensurePodcastToken();
    const url = `/podcast/${token}/ep/miniflux:1.mp3`;

    const full = await a.inject({ method: "GET", url });
    expect(full.statusCode).toBe(200);
    expect(full.headers["content-type"]).toContain("audio/mpeg");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    const total = Number(full.headers["content-length"]);
    expect(total).toBeGreaterThan(0);

    const ranged = await a.inject({ method: "GET", url, headers: { range: "bytes=0-3" } });
    expect(ranged.statusCode).toBe(206);
    expect(ranged.headers["content-range"]).toBe(`bytes 0-3/${total}`);
    expect(Number(ranged.headers["content-length"])).toBe(4);

    const missing = await a.inject({ method: "GET", url: `/podcast/${token}/ep/miniflux:999.mp3` });
    expect(missing.statusCode).toBe(404);
    await a.close();
  });
});

describe("article images", () => {
  it("rewrites article images to the same-origin proxy in the content response", async () => {
    harness.deps.readLater.content.set("b1", '<p>hi</p><img src="img/a.jpg">');
    const a = app();
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/documents/readeck:b1/content",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const html = res.json().html as string;
    expect(html).toContain("/media/documents/readeck%3Ab1/image?u=img%2Fa.jpg");
    expect(html).not.toContain('src="img/a.jpg"');
    await a.close();
  });

  it("streams a readeck article image through the proxy without a bearer token", async () => {
    harness.deps.readLater.resources.set("img/a.jpg", {
      contentType: "image/jpeg",
      bytes: Buffer.from("JPEGBYTES"),
    });
    const a = app();
    // No Authorization header: the proxy lives outside the /api/v1 bearer scope.
    const res = await a.inject({
      method: "GET",
      url: "/media/documents/readeck:b1/image?u=img%2Fa.jpg",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.rawPayload.toString()).toBe("JPEGBYTES");
    expect(harness.deps.readLater.resourceCalls).toEqual([{ sourceId: "b1", ref: "img/a.jpg" }]);
    await a.close();
  });

  it("rejects malformed image proxy requests", async () => {
    const a = app();
    const noRef = await a.inject({ method: "GET", url: "/media/documents/readeck:b1/image" });
    expect(noRef.statusCode).toBe(400);
    const badId = await a.inject({ method: "GET", url: "/media/documents/nope/image?u=x" });
    expect(badId.statusCode).toBe(404);
    await a.close();
  });
});

describe("discovery", () => {
  function candidateInput(over: Partial<CreateCandidateInput> = {}): CreateCandidateInput {
    return {
      url: "https://example.com/article",
      fetcher: "searxng",
      score: 0.5,
      termVector: { ml: 2, ai: 1 },
      ...over,
    };
  }

  /** Seed candidates through the service-facing bulk-insert endpoint, then read
   *  them back so tests use the store-assigned ids. */
  async function seedCandidates(
    a: ReturnType<typeof app>,
    inputs: CreateCandidateInput[],
  ): Promise<DiscoveryCandidate[]> {
    await a.inject({
      method: "POST",
      url: "/api/v1/discovery/candidates",
      headers: auth,
      payload: { candidates: inputs },
    });
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/candidates",
      headers: auth,
    });
    return res.json().candidates as DiscoveryCandidate[];
  }

  it("lists candidates most-relevant first and filters by status", async () => {
    const a = app();
    await seedCandidates(a, [
      candidateInput({ url: "https://a.test/low", score: 0.1 }),
      candidateInput({ url: "https://b.test/high", score: 0.9 }),
    ]);
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/candidates",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const candidates = res.json().candidates as DiscoveryCandidate[];
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.url).toBe("https://b.test/high"); // higher score first

    // Dismiss one, then filter by status.
    await harness.deps.overlay.setCandidateStatus(candidates[0]!.id, "dismissed");
    const active = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/candidates?status=active",
      headers: auth,
    });
    expect(active.json().candidates as DiscoveryCandidate[]).toHaveLength(1);
    expect((active.json().candidates as DiscoveryCandidate[])[0]!.url).toBe("https://a.test/low");
    await a.close();
  });

  it("clears candidates without recording a vote (all active, or by id)", async () => {
    const a = app();
    const cands = await seedCandidates(a, [
      candidateInput({ url: "https://a.test/1", score: 0.5 }),
      candidateInput({ url: "https://b.test/2", score: 0.4 }),
      candidateInput({ url: "https://c.test/3", score: 0.3 }),
    ]);
    // Clear just one by id.
    const one = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/candidates/clear",
      headers: auth,
      payload: { ids: [cands[0]!.id] },
    });
    expect(one.json()).toEqual({ cleared: 1 });
    // No vote was recorded (clear != down-vote).
    expect(await harness.deps.overlay.listUnprocessedVotes()).toHaveLength(0);
    // Clear the rest (no ids = all active).
    const rest = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/candidates/clear",
      headers: auth,
      payload: {},
    });
    expect(rest.json()).toEqual({ cleared: 2 });
    const active = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/candidates?status=active",
      headers: auth,
    });
    expect(active.json().candidates as DiscoveryCandidate[]).toHaveLength(0);
    await a.close();
  });

  it("bulk-insert dedups by normalized URL and skips already-saved documents", async () => {
    // A document already saved for one of the URLs (utm + trailing slash differ,
    // but it normalizes to the same thing) must be skipped.
    harness.deps.overlay.index.set(
      "readeck:b1",
      makeCard({ id: "readeck:b1", source: "readeck", url: "https://saved.test/post" }),
    );
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/candidates",
      headers: auth,
      payload: {
        candidates: [
          candidateInput({ url: "https://new.test/1" }),
          candidateInput({ url: "https://new.test/1?utm_source=x" }), // dup of the first
          candidateInput({ url: "https://saved.test/post/?utm_medium=y" }), // already saved
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ inserted: 1, skipped: 2 });
    await a.close();
  });

  it("votes a candidate up: records the vote (with term vector) and keeps it active", async () => {
    const a = app();
    const [candidate] = await seedCandidates(a, [candidateInput({ url: "https://a.test/up" })]);
    const res = await a.inject({
      method: "POST",
      url: `/api/v1/discovery/candidates/${candidate!.id}/vote`,
      headers: auth,
      payload: { value: "up" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().vote).toBe("up");
    expect(res.json().status).toBe("active"); // signal only — stays visible

    const votes = await harness.deps.overlay.listUnprocessedVotes();
    expect(votes).toHaveLength(1);
    expect(votes[0]!.value).toBe("up");
    expect(votes[0]!.termVector).toEqual({ ml: 2, ai: 1 });
    await a.close();
  });

  it("votes a candidate down: records the vote and dismisses it", async () => {
    const a = app();
    const [candidate] = await seedCandidates(a, [candidateInput({ url: "https://a.test/down" })]);
    const res = await a.inject({
      method: "POST",
      url: `/api/v1/discovery/candidates/${candidate!.id}/vote`,
      headers: auth,
      payload: { value: "down" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().vote).toBe("down");
    expect(res.json().status).toBe("dismissed");
    expect(await harness.deps.overlay.listUnprocessedVotes()).toHaveLength(1);
    await a.close();
  });

  it("404s a vote on an unknown candidate", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/candidates/disc:nope/vote",
      headers: auth,
      payload: { value: "up" },
    });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it("saves a candidate to Readeck, indexes it, and marks it saved", async () => {
    const a = app();
    const [candidate] = await seedCandidates(a, [candidateInput({ url: "https://a.test/save" })]);
    const res = await a.inject({
      method: "POST",
      url: `/api/v1/discovery/candidates/${candidate!.id}/save`,
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("saved");
    // Pushed to Readeck and indexed into the library.
    const saved = [...harness.deps.readLater.bookmarks.values()];
    expect(saved.some((c) => c.url === "https://a.test/save")).toBe(true);
    expect(harness.deps.overlay.index.size).toBe(1);
    await a.close();
  });

  it("404s a save on an unknown candidate", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/candidates/disc:nope/save",
      headers: auth,
    });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it("never leaks the Brave key via GET settings, but returns it via GET config", async () => {
    const a = app();
    const patch = await a.inject({
      method: "PATCH",
      url: "/api/v1/discovery/settings",
      headers: auth,
      payload: { enabled: true, braveApiKey: "brv-secret", topics: ["ml"] },
    });
    expect(patch.statusCode).toBe(200);
    const settings = patch.json() as Record<string, unknown>;
    expect(settings.enabled).toBe(true);
    expect(settings.braveConfigured).toBe(true);
    expect(settings).not.toHaveProperty("braveApiKey");
    expect(JSON.stringify(settings)).not.toContain("brv-secret");

    const get = await a.inject({ method: "GET", url: "/api/v1/discovery/settings", headers: auth });
    expect(JSON.stringify(get.json())).not.toContain("brv-secret");

    // The worker-only config endpoint DOES return the key.
    const config = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/config",
      headers: auth,
    });
    expect(config.statusCode).toBe(200);
    expect(config.json().braveApiKey).toBe("brv-secret");
    expect(config.json()).not.toHaveProperty("braveConfigured");
    await a.close();
  });

  it("PATCH leaves the Brave key unchanged when omitted, clears it on empty", async () => {
    const a = app();
    await a.inject({
      method: "PATCH",
      url: "/api/v1/discovery/settings",
      headers: auth,
      payload: { braveApiKey: "brv-secret" },
    });
    // Omitting braveApiKey leaves it configured.
    const unchanged = await a.inject({
      method: "PATCH",
      url: "/api/v1/discovery/settings",
      headers: auth,
      payload: { schedule: "0 0 * * *" },
    });
    expect(unchanged.json().braveConfigured).toBe(true);
    // Clearing it with "" turns configured off.
    const cleared = await a.inject({
      method: "PATCH",
      url: "/api/v1/discovery/settings",
      headers: auth,
      payload: { braveApiKey: "" },
    });
    expect(cleared.json().braveConfigured).toBe(false);
    await a.close();
  });

  it("opens a run then progresses its stage and status via PATCH", async () => {
    const a = app();
    const create = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/runs",
      headers: auth,
      payload: { id: "run-1", trigger: "manual", stage: "starting" },
    });
    expect(create.statusCode).toBe(201);
    expect(create.json()).toMatchObject({ id: "run-1", status: "running", stage: "starting" });
    expect(create.json().finishedAt).toBeNull();

    // A mid-run progress update advances the stage and writes the stats snapshot
    // (the worker PATCHes cumulative counts each step).
    const progress = await a.inject({
      method: "PATCH",
      url: "/api/v1/discovery/runs/run-1",
      headers: auth,
      payload: { stage: "scoring", stats: { fetched: 40, perFetcher: { searxng: 40 } } },
    });
    expect(progress.json().stage).toBe("scoring");
    expect(progress.json().stats.fetched).toBe(40);
    expect(progress.json().stats.perFetcher).toEqual({ searxng: 40 });
    expect(progress.json().status).toBe("running");
    expect(progress.json().finishedAt).toBeNull();

    // Completing the run stamps finishedAt.
    const done = await a.inject({
      method: "PATCH",
      url: "/api/v1/discovery/runs/run-1",
      headers: auth,
      payload: { status: "succeeded", stats: { fetched: 40, inserted: 5 } },
    });
    expect(done.json().status).toBe("succeeded");
    expect(done.json().stats).toMatchObject({ fetched: 40, inserted: 5 });
    expect(done.json().finishedAt).not.toBeNull();

    // The Activity page reads the latest + the history.
    const latest = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/runs/latest",
      headers: auth,
    });
    expect(latest.json().run.id).toBe("run-1");
    const list = await a.inject({ method: "GET", url: "/api/v1/discovery/runs", headers: auth });
    expect(list.json().runs as DiscoveryRun[]).toHaveLength(1);
    await a.close();
  });

  it("404s a PATCH on an unknown run", async () => {
    const a = app();
    const res = await a.inject({
      method: "PATCH",
      url: "/api/v1/discovery/runs/missing",
      headers: auth,
      payload: { stage: "x" },
    });
    expect(res.statusCode).toBe(404);
    await a.close();
  });

  it("triggers a run (202) via the discovery client, and reports failure without a 5xx", async () => {
    const a = app();
    const ok = await a.inject({ method: "POST", url: "/api/v1/discovery/run", headers: auth });
    expect(ok.statusCode).toBe(202);
    expect(ok.json()).toEqual({ triggered: true, runId: null });
    expect(harness.discovery.calls).toBe(1);

    // A trigger failure yields triggered:false (never a 5xx — the worker may be down).
    harness.discovery.shouldThrow = true;
    const down = await a.inject({ method: "POST", url: "/api/v1/discovery/run", headers: auth });
    expect(down.statusCode).toBe(202);
    expect(down.json()).toEqual({ triggered: false, runId: null });
    await a.close();
  });

  it("reseeds the profile to an empty default and stamps seededAt", async () => {
    const a = app();
    // Seed a non-empty profile, then reseed clears it.
    await harness.deps.overlay.putDiscoveryProfile(
      DiscoveryProfile.parse({ vector: { ml: 1 }, idf: { ml: 2 }, docCount: 3 }),
      [],
    );
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/profile/reseed",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().vector).toEqual({});
    expect(res.json().idf).toEqual({});
    expect(res.json().seededAt).not.toBeNull();
    await a.close();
  });

  it("persists the profile and marks folded-in votes processed (worker PUT)", async () => {
    const a = app();
    const [candidate] = await seedCandidates(a, [candidateInput({ url: "https://a.test/v" })]);
    await harness.deps.overlay.recordVote(candidate!.id, "up");
    const votes = await harness.deps.overlay.listUnprocessedVotes();
    expect(votes).toHaveLength(1);

    const res = await a.inject({
      method: "PUT",
      url: "/api/v1/discovery/profile",
      headers: auth,
      payload: {
        profile: DiscoveryProfile.parse({ vector: { ml: 0.5 }, docCount: 1 }),
        processedVoteIds: [votes[0]!.id],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().vector).toEqual({ ml: 0.5 });
    // The folded-in vote is no longer unprocessed.
    expect(await harness.deps.overlay.listUnprocessedVotes()).toHaveLength(0);
    await a.close();
  });

  it("serves the empty default profile before any run", async () => {
    const a = app();
    const res = await a.inject({ method: "GET", url: "/api/v1/discovery/profile", headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "default", vector: {}, idf: {}, docCount: 0 });
    await a.close();
  });

  // ---- auto-follow suggestions (Milestone B) ----
  /** Seed candidates for a host, save some and up-vote others to build the
   *  distinct positive-signal count follow suggestions are derived from. */
  async function seedFollowSignals(
    a: ReturnType<typeof app>,
    host: string,
    saved: number,
    upvoted: number,
  ): Promise<void> {
    const inputs: CreateCandidateInput[] = [];
    for (let i = 0; i < saved + upvoted; i++) {
      inputs.push(candidateInput({ url: `https://${host}/post-${i}`, title: `${host} #${i}` }));
    }
    const cands = await seedCandidates(a, inputs);
    // The seed returns candidates for THIS host (plus any earlier ones); pick ours.
    const mine = cands.filter((c) => new URL(c.url).hostname === host);
    for (let i = 0; i < saved; i++) {
      await harness.deps.overlay.setCandidateStatus(mine[i]!.id, "saved");
    }
    for (let i = saved; i < saved + upvoted; i++) {
      await harness.deps.overlay.recordVote(mine[i]!.id, "up");
    }
  }

  it("suggests domains at/above the follow threshold, sorted by signal count", async () => {
    const a = app();
    await seedFollowSignals(a, "aeon.co", 2, 1); // 3 signals -> suggested
    await seedFollowSignals(a, "quanta.org", 4, 0); // 4 signals -> suggested first
    await seedFollowSignals(a, "rare.io", 1, 1); // 2 signals -> below threshold
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/follow-suggestions",
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const suggestions = res.json().suggestions as { domain: string; signalCount: number }[];
    expect(suggestions.map((s) => s.domain)).toEqual(["quanta.org", "aeon.co"]);
    expect(suggestions[0]!.signalCount).toBe(4);
    await a.close();
  });

  it("excludes already-followed domains (matched on feed site + feed url host)", async () => {
    const a = app();
    await seedFollowSignals(a, "aeon.co", 3, 0);
    await seedFollowSignals(a, "quanta.org", 3, 0);
    // Follow aeon.co by site URL, quanta.org by feed URL — both must be excluded.
    harness.deps.rss.feeds.push(
      Feed.parse({
        id: "1",
        title: "Aeon",
        feedUrl: "https://f.aeon.co/rss",
        siteUrl: "https://www.aeon.co",
      }),
      Feed.parse({ id: "2", title: "Quanta", feedUrl: "https://quanta.org/feed" }),
    );
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/follow-suggestions",
      headers: auth,
    });
    expect(res.json().suggestions as unknown[]).toHaveLength(0);
    await a.close();
  });

  it("excludes dismissed domains and dedupes the dismiss list", async () => {
    const a = app();
    await seedFollowSignals(a, "aeon.co", 3, 0);
    const dismiss = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/follow/dismiss",
      headers: auth,
      payload: { domain: "aeon.co" },
    });
    expect(dismiss.json()).toEqual({ dismissed: true });
    // A second dismiss is idempotent (no duplicate in followDismissed).
    await a.inject({
      method: "POST",
      url: "/api/v1/discovery/follow/dismiss",
      headers: auth,
      payload: { domain: "aeon.co" },
    });
    expect((await harness.deps.overlay.getDiscoverySettings()).followDismissed).toEqual([
      "aeon.co",
    ]);
    const res = await a.inject({
      method: "GET",
      url: "/api/v1/discovery/follow-suggestions",
      headers: auth,
    });
    expect(res.json().suggestions as unknown[]).toHaveLength(0);
    await a.close();
  });

  it("follows a domain via MiniFlux site-url autodiscovery", async () => {
    const a = app();
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/follow",
      headers: auth,
      payload: { domain: "aeon.co" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().feed.feedUrl).toBe("https://aeon.co/");
    expect(harness.deps.rss.feeds).toHaveLength(1);
    await a.close();
  });

  it("returns 422 when no feed can be discovered for the domain", async () => {
    const a = app();
    harness.deps.rss.subscribe = async () => {
      throw new Error("no feed found");
    };
    const res = await a.inject({
      method: "POST",
      url: "/api/v1/discovery/follow",
      headers: auth,
      payload: { domain: "nofeed.example" },
    });
    expect(res.statusCode).toBe(422);
    await a.close();
  });
});
