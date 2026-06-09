# Phase D — Print-Surface Polish (Magazine / Newspaper)

Read `README.md` in this directory first (guardrails, verification, commit rules).
Packets D1-D13 are code changes; D14 is a diagnostic writeup only.
If quoted "Current code" does not match the file, stop and report the mismatch.

---

### D1: Extract one shared two-line drop-cap recipe and key it off the first flow band
**Priority:** P1 · **Depends on:** none
**Files:**
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/styles/drop-cap.css` (new)
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte`
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** Three competing drop-cap specs (3.2em/3.1em/3.4em, line-height 0.7–0.72) all produce a cap ~1.4 lines tall with its foot in dead air, two of them in accent color. One ink-colored recipe, optically sized to exactly two lines, with `initial-letter` where supported. Decision: the recipe lives in a new plain (non-Svelte-scoped) stylesheet `src/lib/styles/drop-cap.css` imported by both components — `{@html}` content carries no Svelte scope attribute, so a global class-keyed file is the one-recipe option that works whether or not the Phase B `prose.css` exists; when Phase B lands, fold this file into it.

**Steps:**

1. Create `/Users/luke/git/luke/Lectern/apps/web/src/lib/styles/drop-cap.css` with exactly this content (tabs for indentation, matching repo Prettier style):

```css
/**
 * Shared drop-cap recipe for the print surfaces (MagazineReader, FlipReader).
 * Plain global stylesheet — the capped paragraphs come from sanitized {@html}
 * content, which carries no Svelte scope attribute. Apply the `drop-cap` class
 * to the DIRECT parent of the article's paragraphs; set `--dc-leading` on that
 * container to its body line-height (defaults to 1.7) so the float fallback
 * spans exactly two lines. The cap is ink (var(--text)), never accent, and it
 * inherits the body face by design.
 *
 * Known limitation: when the opening paragraph starts with a quotation mark,
 * ::first-letter (and initial-letter) style the quote + letter pair together,
 * producing an oversized “W. CSS cannot exclude those paragraphs; the ink
 * color keeps the worst case quiet.
 *
 * Fold into the shared prose.css when the prose layer (Phase B) lands.
 */
.drop-cap > p:first-of-type::first-letter {
	font-weight: 700;
	color: var(--text);
}
@supports (initial-letter: 3) or (-webkit-initial-letter: 3) {
	.drop-cap > p:first-of-type::first-letter {
		-webkit-initial-letter: 3;
		initial-letter: 3;
		margin-right: 0.12em;
	}
}
@supports not ((initial-letter: 3) or (-webkit-initial-letter: 3)) {
	.drop-cap > p:first-of-type::first-letter {
		float: left;
		/* cap height ≈ 0.74em, so 2 lines of leading ÷ 0.74 fills exactly 2 lines */
		font-size: calc(2 * var(--dc-leading, 1.7) * 0.74em);
		line-height: 1;
		padding-right: 0.08em;
	}
}
```

2. `MagazineReader.svelte:12` — import the stylesheet. Current code:

```ts
	import { scrollIntoViewMotion } from '$lib/motion';
```

Change to:

```ts
	import { scrollIntoViewMotion } from '$lib/motion';
	import '$lib/styles/drop-cap.css';
```

3. `MagazineReader.svelte:184` — apply the class. Current code:

```svelte
				<div class="mr-body">{@html html[card.id]}</div>
```

Change to:

```svelte
				<div class="mr-body drop-cap">{@html html[card.id]}</div>
```

4. `MagazineReader.svelte:477-486` — delete the old recipe. Current code (delete the whole block, comment included):

```css
	/* Serif drop cap on the opening paragraph of each feature. */
	.mr-body :global(p:first-of-type)::first-letter {
		float: left;
		font-family: var(--font-serif);
		font-size: 3.2em;
		line-height: 0.72;
		font-weight: 700;
		padding: 0.02em 0.08em 0 0;
		color: var(--accent);
	}
```

(`.mr-body` line-height is 1.7, the recipe default — no `--dc-leading` override needed.)

5. `FlipReader.svelte:7` — import the stylesheet. Current code:

```ts
	import { getArticleHtml, prefetchArticles } from '$lib/content';
```

Change to:

```ts
	import { getArticleHtml, prefetchArticles } from '$lib/content';
	import '$lib/styles/drop-cap.css';
```

6. `FlipReader.svelte:17` — tag the first FLOW band in the band model. Current code:

```ts
	type Band = { kind: 'flow' | 'full'; html: string };
```

Change to:

```ts
	type Band = { kind: 'flow' | 'full'; html: string; lede?: boolean };
```

7. `FlipReader.svelte:19` — Current code:

```ts
		if (typeof DOMParser === 'undefined' || !raw) return [{ kind: 'flow', html: raw }];
```

Change to:

```ts
		if (typeof DOMParser === 'undefined' || !raw) return [{ kind: 'flow', html: raw, lede: true }];
```

8. `FlipReader.svelte:64-65` (end of `splitBands`) — Current code:

```ts
		flush();
		return out.length ? out : [{ kind: 'flow', html: raw }];
```

Change to:

```ts
		flush();
		// The drop cap belongs to the first *flow* band — image-led articles whose
		// first band is a full-width figure would otherwise never get one.
		const firstFlow = out.find((b) => b.kind === 'flow');
		if (firstFlow) firstFlow.lede = true;
		return out.length ? out : [{ kind: 'flow', html: raw, lede: true }];
	}
```

9. `FlipReader.svelte:266-267` — key the cap off the tagged band. Current code:

```svelte
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="fr-band">{@html band.html}</div>
```

Change to:

```svelte
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="fr-band" class:drop-cap={band.lede}>{@html band.html}</div>
```

10. `FlipReader.svelte:271-274` — magazine (non-band) branch. Current code:

```svelte
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="fr-body">{@html html}</div>
					{/if}
```

Change to:

```svelte
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="fr-body" class:drop-cap={kind === 'magazine'}>{@html html}</div>
					{/if}
```

11. `FlipReader.svelte:597-605` — delete the old newspaper recipe. Current code (delete whole block):

```css
	/* Drop cap on the very first paragraph of the first band only. */
	.flip.newspaper .fr-bands > .fr-band:first-child :global(p:first-of-type)::first-letter {
		float: left;
		font-family: var(--font-serif);
		font-weight: 800;
		font-size: 3.1em;
		line-height: 0.72;
		padding: 0.06em 0.08em 0 0;
	}
```

12. `FlipReader.svelte:656-663` — delete the old magazine recipe. Current code (delete whole block):

```css
	.flip.magazine .fr-body :global(p:first-of-type)::first-letter {
		float: left;
		font-weight: 800;
		font-size: 3.4em;
		line-height: 0.7;
		padding: 0.04em 0.1em 0 0;
		color: var(--accent);
	}
```

13. `FlipReader.svelte:652-655` — parameterize the magazine leading (its body is 1.75, not the 1.7 default). Current code:

```css
	.flip.magazine .fr-body {
		font-size: 1.12rem;
		line-height: 1.75;
	}
```

Change to:

```css
	.flip.magazine .fr-body {
		--dc-leading: 1.75;
		font-size: 1.12rem;
		line-height: 1.75;
	}
```

**Do not:** set `font-family` or accent color on the cap; use `:global(p:first-of-type)` descendant selectors (the old MagazineReader selector capped the first `p` inside *every* container, including blockquotes — the `>` child combinator in the new recipe is deliberate); touch the `::first-line` rules (D2 deletes them); line numbers are pre-phase — locate by the quoted code.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/magazine` → open an issue → caps are ink, exactly two lines tall, on the first paragraph of each article; `/newspaper` → "Read edition" → cap on the first flow band only; flip to an article whose content opens with an image — the cap appears on the first text band after it. Repeat one spot-check on Dark theme (cap must be `--text`, not accent).

**Acceptance:**
- One recipe file; zero `::first-letter` rules left in either component's `<style>`.
- Caps render in `var(--text)` on all themes; `initial-letter: 3` path active in Safari/Chrome, float fallback two lines elsewhere.
- Image-led newspaper articles get a cap on their first flow band.
- Leading-quote caveat documented in the CSS file as a known limitation.

---

### D2: Delete the faux small-caps ::first-line rules
**Priority:** P1 · **Depends on:** none (line numbers are pre-D1; locate by quoted code)
**Files:**
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte`
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** The bundled/system serifs carry no `smcp` feature, so browsers synthesize counterfeit shrunken caps over a viewport-dependent run of text. Straight deletions.

**Steps:**

1. `MagazineReader.svelte:487-491` — delete this entire block:

```css
	/* Small-caps lead-in on the opening line, paired with the drop cap. */
	.mr-body :global(p:first-of-type)::first-line {
		font-variant-caps: small-caps;
		letter-spacing: 0.02em;
	}
```

2. `FlipReader.svelte:606-610` — delete this entire block:

```css
	/* Small-caps lead-in on the opening line — the classic newspaper entry. */
	.flip.newspaper .fr-bands > .fr-band:first-child :global(p:first-of-type)::first-line {
		font-variant-caps: small-caps;
		letter-spacing: 0.03em;
	}
```

3. `FlipReader.svelte:664-667` — delete this entire block:

```css
	.flip.magazine .fr-body :global(p:first-of-type)::first-line {
		font-variant-caps: small-caps;
		letter-spacing: 0.02em;
	}
```

**Do not:** delete any neighboring `::first-letter` blocks (D1 owns those); add a replacement lead-in (out of scope).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/magazine` issue and `/newspaper` "Read edition" — opening lines render in normal mixed case at body size.

**Acceptance:**
- `grep -n "first-line" apps/web/src/lib/components/MagazineReader.svelte apps/web/src/lib/components/FlipReader.svelte` returns nothing.
- No synthesized small caps on any opening line.

---

### D3: Fleuron economy — margin between continuation bands, ❧ only for source `<hr>`
**Priority:** P1 · **Depends on:** D1 (quotes assume D1 applied)
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** A floret every ~130 words puts ~14 ornaments in a 2,000-word feature, demoting ❧ to noise. Continuation bands separate with the existing `.fr-band + .fr-band` 1.6em margin (FlipReader.svelte:560-562, already present); ❧ is reserved for breaks the source authored (`<hr>`). Article boundaries already carry their own marks (`.mr-sep` in MagazineReader, page turns in FlipReader).

**Steps:**

1. `FlipReader.svelte:24-37` — remove `HR` from the FULL set. Current code:

```ts
		const FULL = new Set([
			'FIGURE',
			'IMG',
			'TABLE',
			'PRE',
			'BLOCKQUOTE',
			'H1',
			'H2',
			'H3',
			'H4',
			'HR',
			'VIDEO',
			'IFRAME'
		]);
```

Change to:

```ts
		const FULL = new Set([
			'FIGURE',
			'IMG',
			'TABLE',
			'PRE',
			'BLOCKQUOTE',
			'H1',
			'H2',
			'H3',
			'H4',
			'VIDEO',
			'IFRAME'
		]);
```

2. `FlipReader.svelte:17` (post-D1) — add the break kind. Current code:

```ts
	type Band = { kind: 'flow' | 'full'; html: string; lede?: boolean };
```

Change to:

```ts
	type Band = { kind: 'flow' | 'full' | 'break'; html: string; lede?: boolean };
```

3. `FlipReader.svelte:52-56` — emit a break band for `<hr>`. Current code:

```ts
			if (el && FULL.has(tag)) {
				flush();
				out.push({ kind: 'full', html: el.outerHTML });
				continue;
			}
```

Change to:

```ts
			if (el && tag === 'HR') {
				// A source-authored thematic break — the one place the floret belongs.
				flush();
				out.push({ kind: 'break', html: '' });
				continue;
			}
			if (el && FULL.has(tag)) {
				flush();
				out.push({ kind: 'full', html: el.outerHTML });
				continue;
			}
```

4. `FlipReader.svelte:258-269` (post-D1) — render ❧ only for break bands; drop the flow-flow ornament. Current code:

```svelte
							{#each bands as band, i (i)}
								{#if i > 0 && band.kind === 'flow' && bands[i - 1].kind === 'flow'}
									<div class="fr-break" aria-hidden="true">❧</div>
								{/if}
								{#if band.kind === 'full'}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="fr-full">{@html band.html}</div>
								{:else}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="fr-band" class:drop-cap={band.lede}>{@html band.html}</div>
								{/if}
							{/each}
```

Change to:

```svelte
							{#each bands as band, i (i)}
								{#if band.kind === 'break'}
									<div class="fr-break" aria-hidden="true">❧</div>
								{:else if band.kind === 'full'}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="fr-full">{@html band.html}</div>
								{:else}
									<!-- eslint-disable-next-line svelte/no-at-html-tags -->
									<div class="fr-band" class:drop-cap={band.lede}>{@html band.html}</div>
								{/if}
							{/each}
```

5. `FlipReader.svelte:558-562` — correct the now-stale comment. Current code:

```css
	/* Breathing room between consecutive bands; the floret rule (.fr-break) carries
	   the visible separation, so no border is needed when bands sit back-to-back. */
	.fr-band + .fr-band {
		margin-top: 1.6em;
	}
```

Change to:

```css
	/* Continuation bands separate with margin alone — the floret (.fr-break) is
	   reserved for source-authored <hr> breaks. */
	.fr-band + .fr-band {
		margin-top: 1.6em;
	}
```

**Do not:** delete the `.fr-break` CSS block (lines 564-583 — still used for `<hr>`); remove the `i` loop variable (it is the `{#each}` key).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Newsprint theme): `/newspaper` → "Read edition" → a long article shows bands separated by whitespace only; an article whose source HTML contains `<hr>` shows exactly one ❧ at that spot.

**Acceptance:**
- No ❧ between auto-split continuation bands; 1.6em margin only.
- `<hr>` in source content renders as the flanked-floret `.fr-break`.
- `splitBands` unit behavior unchanged for headings/media (still `full` bands).

---

### D4: Real folios — reading minutes in the magazine TOC, no fake Issue No.
**Priority:** P1 · **Depends on:** none
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/magazine/+page.svelte`

**Why:** Dotted leaders to invented page numbers and a hash-derived "Issue No." are fake data on a brand whose word is trustworthy. Put real data in the slot: per-article reading minutes (`card.readingTimeMinutes` — verified, `packages/shared/src/model.ts:75`, nullable int) in the folio position, total issue minutes on the cover. Decision on "Issue No.": drop the line entirely — the cover already shows the tag name (`.cover-title`) and article count (`.cover-count`); fold total minutes into the count line instead of inventing any numbering.

**Steps:**

1. Lines 31-37 — delete the fake issue number. Current code (delete whole block):

```ts
	// A stable two-digit issue number per publication, so each cover wears a
	// consistent "No." the way a real magazine masthead would.
	function issueNo(tag: string): number {
		let h = 7;
		for (let i = 0; i < tag.length; i++) h = (h * 17 + tag.charCodeAt(i)) % 90;
		return h + 9;
	}
```

(Keep `pad()` at lines 38-40 — still used for TOC numerals.)

2. Lines 55-66 — replace synthetic folios with minutes. Current code:

```ts
	// Synthetic folios: front matter fills the opening leaves, then each article
	// spans a couple of pages, giving the contents real ascending page numbers.
	function folios(list: Card[]): number[] {
		const out: number[] = [];
		let page = 11;
		for (const c of list) {
			out.push(page);
			const span = c.readingTimeMinutes ?? Math.max(1, Math.round((c.wordCount ?? 700) / 220));
			page += Math.max(2, Math.ceil(span / 3) * 2);
		}
		return out;
	}
```

Change to:

```ts
	// Honest folios: reading minutes per article (estimated from word count when
	// the source didn't supply them) instead of invented page numbers.
	function minutesOf(card: Card): number {
		return card.readingTimeMinutes ?? Math.max(1, Math.round((card.wordCount ?? 700) / 220));
	}
	function totalMinutes(list: Card[]): number {
		return list.reduce((sum, c) => sum + minutesOf(c), 0);
	}
```

3. Lines 84-104 — the TOC entry snippet drops the folio parameter and prints minutes. Current code:

```svelte
{#snippet tocEntry(magazine: Magazine, index: number, num: number, folio: number)}
	{@const card = magazine.cards[index]}
	{#if card}
		<li>
			<a
				class="entry"
				href={resolve('/read/[id]', { id: card.id })}
				onclick={(e) => openMagazine(e, magazine, card.id)}
			>
				<span class="num">{pad(num)}</span>
				<span class="entry-main">
					<span class="entry-row">
						<span class="entry-title">{card.title}</span>
						<span class="folio">{folio}</span>
					</span>
					{#if meta(card)}<span class="entry-by">{meta(card)}</span>{/if}
				</span>
			</a>
		</li>
	{/if}
{/snippet}
```

Change to:

```svelte
{#snippet tocEntry(magazine: Magazine, index: number, num: number)}
	{@const card = magazine.cards[index]}
	{#if card}
		<li>
			<a
				class="entry"
				href={resolve('/read/[id]', { id: card.id })}
				onclick={(e) => openMagazine(e, magazine, card.id)}
			>
				<span class="num">{pad(num)}</span>
				<span class="entry-main">
					<span class="entry-row">
						<span class="entry-title">{card.title}</span>
						<span class="folio">{minutesOf(card)} min</span>
					</span>
					{#if meta(card)}<span class="entry-by">{meta(card)}</span>{/if}
				</span>
			</a>
		</li>
	{/if}
{/snippet}
```

4. Line 145 — delete the precomputed folios. Current code (delete the line):

```svelte
			{@const featFolios = folios(featured.cards)}
```

5. Line 187 — drop the folio argument. Current code:

```svelte
								{@render tocEntry(featured, i + 1, i + 1, featFolios[i + 1])}
```

Change to:

```svelte
								{@render tocEntry(featured, i + 1, i + 1)}
```

6. Lines 153-154 (hero cover) — drop Issue No., add total minutes. Current code:

```svelte
					<p class="cover-no">Issue No. {pad(issueNo(featured.tag))}</p>
					<p class="cover-count">{plural(featured.cards.length, 'article')}</p>
```

Change to:

```svelte
					<p class="cover-count">
						{plural(featured.cards.length, 'article')} · {totalMinutes(featured.cards)} min
					</p>
```

7. Lines 201-202 (shelf covers) — same treatment. Current code:

```svelte
							<p class="cover-no">Issue No. {pad(issueNo(issue.tag))}</p>
							<p class="cover-count">{plural(issue.cards.length, 'article')}</p>
```

Change to:

```svelte
							<p class="cover-count">
								{plural(issue.cards.length, 'article')} · {totalMinutes(issue.cards)} min
							</p>
```

8. Lines 373-380 — delete the orphaned `.cover-no` CSS. Current code (delete whole block):

```css
	.cover-no {
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		margin: 0;
		color: color-mix(in srgb, white 80%, hsl(var(--hue) 45% 30%));
	}
```

**Do not:** delete `pad()` (still used at line 93); touch the dotted-leader CSS at 541-557 — the leaders now point at "12 min" and stay as-is.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/magazine` — hero TOC entries show "… ····· 12 min" with leaders intact; covers show "8 articles · 74 min" and no "Issue No." anywhere; a card with null `readingTimeMinutes` still shows an estimated "≥1 min".

**Acceptance:**
- No invented page numbers or issue numbers remain (`grep -n "issueNo\|folios(" apps/web/src/routes/magazine/+page.svelte` is empty).
- Folio slot shows per-article minutes with dotted leaders; cover count line shows article count plus cumulative issue minutes.

---

### D5: Short-item handling in FlipReader — single ragged column, no costume
**Priority:** P1 · **Depends on:** D1, D3 (quotes assume both applied)
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** A 20-word RSS post currently gets two justified columns, a drop cap, and "hap-pen" split across columns. Under 90 words: one left-ragged column, no drop cap, no end mark, and "Read the full story" directly under the snippet.

**Steps:**

1. `FlipReader.svelte:17` (post-D3) — Current code:

```ts
	type Band = { kind: 'flow' | 'full' | 'break'; html: string; lede?: boolean };
```

Change to:

```ts
	type Band = { kind: 'flow' | 'full' | 'break'; html: string; lede?: boolean; short?: boolean };
```

2. `FlipReader.svelte:20` — short-circuit `splitBands` for short items. Current code:

```ts
		const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, 'text/html');
```

Change to:

```ts
		const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, 'text/html');
		// Short items (RSS snippets) skip the broadsheet costume entirely: one
		// ragged column, no drop cap (no `lede`), full-story link right below.
		const totalWords = (doc.body.textContent ?? '').trim().split(/\s+/).filter(Boolean).length;
		if (totalWords < 90) return [{ kind: 'flow', html: raw, short: true }];
```

3. `FlipReader.svelte:103-105` — derive the flag. Current code:

```ts
	const bands = $derived(
		kind === 'newspaper' && !loading && !error && html ? splitBands(html) : null
	);
```

Change to:

```ts
	const bands = $derived(
		kind === 'newspaper' && !loading && !error && html ? splitBands(html) : null
	);
	const isShort = $derived(bands?.[0]?.short === true);
```

4. `FlipReader.svelte:257` — tag the wrapper. Current code:

```svelte
						<div class="fr-body fr-bands">
```

Change to:

```svelte
						<div class="fr-body fr-bands" class:fr-short={isShort}>
```

5. `FlipReader.svelte:270-282` (post-D3) — short link under the snippet; suppress endmark and bottom link for shorts. Current code:

```svelte
						</div>
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="fr-body" class:drop-cap={kind === 'magazine'}>{@html html}</div>
					{/if}

					{#if !loading && !error}
						<p class="endmark" aria-hidden="true">∎</p>
					{/if}

					<a class="open-full" href={resolve('/read/[id]', { id: current.id })}>
						Open in full reader <Icon name="back" size={13} />
					</a>
```

Change to:

```svelte
						</div>
						{#if isShort}
							<a class="open-full short-link" href={resolve('/read/[id]', { id: current.id })}>
								Read the full story <Icon name="back" size={13} />
							</a>
						{/if}
					{:else}
						<!-- eslint-disable-next-line svelte/no-at-html-tags -->
						<div class="fr-body" class:drop-cap={kind === 'magazine'}>{@html html}</div>
					{/if}

					{#if !loading && !error && !isShort}
						<p class="endmark" aria-hidden="true">∎</p>
					{/if}

					{#if !isShort}
						<a class="open-full" href={resolve('/read/[id]', { id: current.id })}>
							Open in full reader <Icon name="back" size={13} />
						</a>
					{/if}
```

6. CSS — after the `.fr-band + .fr-band` rule (post-D3 comment "Continuation bands separate with margin alone…", originally FlipReader.svelte:560-562), add:

```css
	/* Short items: a single ragged column — no columns, no justification. */
	.fr-short .fr-band {
		columns: 1;
		text-align: left;
	}
```

7. CSS — after the `.open-full:hover` rule (FlipReader.svelte:681-683):

```css
	.open-full:hover {
		color: var(--accent);
	}
```

add immediately below it:

```css
	/* For short items the link sits directly under the snippet. */
	.open-full.short-link {
		margin-top: 0.9rem;
	}
```

**Do not:** set `lede: true` on the short band (that is what keeps the drop cap off — the `class:drop-cap={band.lede}` binding stays falsy); add a second `<Icon>` import (already imported).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Newsprint theme): `/newspaper` → "Read edition" → flip to a short RSS item: one left-aligned column, no drop cap, no ∎, "Read the full story" right under the text; a long article is unchanged (columns, drop cap, bottom "Open in full reader").

**Acceptance:**
- Items under 90 words render single-column, ragged, capless.
- "Read the full story" link sits directly below the snippet for shorts only; long articles keep the bottom link.
- No hyphen splits across columns possible on shorts (there are no columns).

---

### D6: Page-turn motion — 180ms cubicOut, instant scroll, reduced-motion respected
**Priority:** P1 · **Depends on:** none
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** The 220ms fly races a simultaneous CSS smooth scroll-to-top — two animations fighting over one paint. Shorter eased slide, instant scroll reset, and stillness for readers who asked for it (`prefersReducedMotion` helper already exists in `$lib/motion`).

**Steps:**

1. `FlipReader.svelte:3-4` — imports. Current code:

```ts
	import { onMount, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
```

Change to:

```ts
	import { onMount, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
```

2. `FlipReader.svelte:8` — Current code:

```ts
	import { getSync } from '$lib/sync';
```

Change to:

```ts
	import { getSync } from '$lib/sync';
	import { prefersReducedMotion } from '$lib/motion';
```

3. `FlipReader.svelte:149-158` — instant scroll reset in `go()`. Current code:

```ts
	function go(delta: number) {
		const next = index + delta;
		if (next < 0 || next >= total) return;
		// Turning forward marks the story you're leaving as read — the natural
		// "I've read this" signal. Turning back never un-reads.
		if (delta > 0) setRead(pages[index], true);
		dir = delta;
		index = next;
		stageEl?.scrollTo({ top: 0 });
	}
```

Change to:

```ts
	function go(delta: number) {
		const next = index + delta;
		if (next < 0 || next >= total) return;
		// Turning forward marks the story you're leaving as read — the natural
		// "I've read this" signal. Turning back never un-reads.
		if (delta > 0) setRead(pages[index], true);
		dir = delta;
		index = next;
		stageEl?.scrollTo({ top: 0, behavior: 'instant' });
	}

	// Page-turn motion: one short eased slide. The scroll reset above is instant
	// so the two never animate against each other, and the slide is skipped
	// entirely under prefers-reduced-motion (Svelte transitions ignore the CSS
	// media query, so gate it here).
	function pageFly() {
		if (prefersReducedMotion()) return { duration: 0 };
		return { x: dir >= 0 ? 24 : -24, duration: 180, easing: cubicOut, opacity: 0 };
	}
```

4. `FlipReader.svelte:237` — Current code:

```svelte
				<article class="page" in:fly={{ x: dir >= 0 ? 36 : -36, duration: 220, opacity: 0 }}>
```

Change to:

```svelte
				<article class="page" in:fly={pageFly()}>
```

5. `FlipReader.svelte:437-442` — drop CSS smooth scrolling on the stage. Current code:

```css
	.stage {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		scroll-behavior: smooth;
	}
```

Change to:

```css
	.stage {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
	}
```

**Do not:** add an `out:` transition (the keyed block replaces pages; an outro would double-render); use `scrollBehavior()` from motion.ts here (we want instant for everyone, not just reduced-motion users).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/newspaper` → "Read edition" → arrow-key through pages: one crisp 180ms slide, page starts at the top instantly, no scroll animation underneath. Enable "Reduce motion" in OS settings → page swaps with no slide.

**Acceptance:**
- Turn animates 180ms `cubicOut`, x offset 24px.
- `stageEl.scrollTo` is `behavior: 'instant'`; no `scroll-behavior: smooth` on `.stage`.
- Reduced-motion users get an instant swap (duration 0).

---

### D7: Auto-mark the last article read at end of scroll
**Priority:** P1 · **Depends on:** none
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** `go()` (FlipReader.svelte:149-158) marks read only on a *forward* turn; the final page has no forward turn, so the cover-to-cover reader's last story is never marked. Observe the page's running foot (`.runfoot`, always rendered at the very bottom of every page and untouched by D11) entering the stage viewport on the final page.

**Steps:**

1. `FlipReader.svelte:92` — add the element ref. Current code:

```ts
	let stageEl = $state<HTMLElement | null>(null);
```

Change to:

```ts
	let stageEl = $state<HTMLElement | null>(null);
	let footEl = $state<HTMLElement | null>(null);
```

2. After the `setRead` function (FlipReader.svelte:141-147), whose current code is:

```ts
	// Mark a story read/unread: optimistic local set + queued sync mutation.
	function setRead(card: Card | undefined, read: boolean) {
		if (!card) return;
		if (read) readIds.add(card.id);
		else readIds.delete(card.id);
		const sync = getSync();
		void sync.enqueue({ type: 'markRead', id: card.id, read }).then(() => sync.flush());
	}
```

add immediately below it:

```ts
	// The final page has no forward turn, so go()'s auto-mark can never fire for
	// it. Instead, when the running foot of the last page scrolls into view, the
	// story has been read to the end — mark it. The {#key index} block recreates
	// the foot per page, so bind:this re-fires and this effect re-runs.
	$effect(() => {
		const el = footEl;
		const card = current;
		if (!el || !card || loading || error || index !== total - 1) return;
		if (readIds.has(card.id)) return;
		const io = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) {
					io.disconnect();
					setRead(card, true);
				}
			},
			{ root: stageEl, threshold: 0.5 }
		);
		io.observe(el);
		return () => io.disconnect();
	});
```

3. `FlipReader.svelte:284` — bind the foot. Current code:

```svelte
					<footer class="runfoot" aria-hidden="true">{index + 1}</footer>
```

Change to:

```svelte
					<footer class="runfoot" aria-hidden="true" bind:this={footEl}>{index + 1}</footer>
```

**Do not:** observe the `.endmark` element (D11 deletes it); mark on pages other than `total - 1` (forward turns already handle those); skip the `loading`/`error` guards — the foot is rendered during the skeleton and would otherwise mark a short page read before its content exists.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/newspaper` → "Read edition" → jump to the last page (ArrowRight to the end), scroll to the bottom: the "Mark read" pill in the flip bar switches to "Read" without clicking; toggling it back to unread does not re-mark while you stay on the page bottom is already observed-and-disconnected (re-scrolling after a re-render may re-mark — acceptable). Close the flip reader: the story is read in the edition.

**Acceptance:**
- Reaching the bottom of the final page marks that story read (pill reflects it; sync mutation enqueued).
- Earlier pages are unaffected; behavior of forward-turn marking unchanged.
- Observer is disconnected on page change/unmount (no leaks; effect cleanup returns `io.disconnect`).

---

### D8: Pull-quote treatment for full-width blockquotes
**Priority:** P1 · **Depends on:** none
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** Blockquotes are promoted to full-width bands (`FULL` set, FlipReader.svelte:24-37) but `.fr-full` only gives them margin (586-588), so they set as ~90ch italic walls. Give them a real pull-quote: bounded measure, centered, rules above and below.

**Steps:**

1. After the `.fr-full` media rule block, `FlipReader.svelte:589-596`. Current code (for location only — do not modify):

```css
	.fr-full :global(img),
	.fr-full :global(figure),
	.fr-full :global(video),
	.fr-full :global(iframe),
	.fr-full :global(table),
	.fr-full :global(pre) {
		max-width: 100%;
	}
```

Add immediately below it:

```css
	/* Full-width blockquotes read as pull quotes, not 90ch walls: a bounded,
	   centered measure with rules above and below instead of the side stripe.
	   .fr-body .fr-full out-specifies the base .fr-body blockquote rule. */
	.fr-body .fr-full :global(blockquote) {
		max-width: 30em;
		margin: 1.8em auto;
		padding: 0.9em 0;
		border: 0;
		border-top: 1px solid var(--border-strong);
		border-bottom: 1px solid var(--border-strong);
		text-align: center;
		font-size: 1.3rem;
		font-style: italic;
	}
```

**Do not:** edit the base `.fr-body :global(blockquote)` rule (520-528) — it still styles inline quotes in the magazine flip body; rely on rule order for the override (the `.fr-body .fr-full` compound wins on specificity regardless of position, but keep it after anyway).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Newsprint theme): `/newspaper` → "Read edition" → an article containing a blockquote shows it centered at ≤30em with hairline top/bottom rules, no left border, no left padding, larger italic type.

**Acceptance:**
- `.fr-full` blockquotes: max-width 30em, centered, 1.3rem italic, top+bottom `--border-strong` rules, no side border.
- Base blockquote styling elsewhere unchanged.

---

### D9: Swipe guard — don't turn the page after panning an embed
**Priority:** P1 · **Depends on:** none
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** Horizontally panning a code block or table ends as a wide-`dx` touch, which `onTouchEnd` reads as a page turn.

**Steps:**

1. `FlipReader.svelte:179-189` — Current code:

```ts
	let touchX = 0;
	let touchY = 0;
	function onTouchStart(e: TouchEvent) {
		touchX = e.changedTouches[0]?.clientX ?? 0;
		touchY = e.changedTouches[0]?.clientY ?? 0;
	}
	function onTouchEnd(e: TouchEvent) {
		const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX;
		const dy = (e.changedTouches[0]?.clientY ?? 0) - touchY;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
	}
```

Change to:

```ts
	let touchX = 0;
	let touchY = 0;
	// A swipe that starts inside a horizontally pannable embed is panning that
	// embed, never a page turn.
	let touchInPannable = false;
	function onTouchStart(e: TouchEvent) {
		touchX = e.changedTouches[0]?.clientX ?? 0;
		touchY = e.changedTouches[0]?.clientY ?? 0;
		const target = e.target instanceof Element ? e.target : null;
		touchInPannable = !!target?.closest('pre, table, iframe, video');
	}
	function onTouchEnd(e: TouchEvent) {
		if (touchInPannable) return;
		const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX;
		const dy = (e.changedTouches[0]?.clientY ?? 0) - touchY;
		if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
	}
```

**Do not:** call `preventDefault` or change the threshold math; guard keyboard/button turns (only touch is affected).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (phone emulation, 390px, Paper theme): `/newspaper` → "Read edition" → on an article with a wide code block, drag the code block sideways: it scrolls, the page does not turn; swiping on plain text still turns.

**Acceptance:**
- Touch gestures beginning inside `pre`, `table`, `iframe`, or `video` never trigger `go()`.
- Normal swipes elsewhere on the page still turn.

---

### D10: "↑ Contents" scrolls to the contents, not article 1
**Priority:** P1 · **Depends on:** none
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte`

**Why:** The button at MagazineReader.svelte:195-197 jumps to `magazine.cards[0]` — the first *article* — instead of the `nav.mr-toc` contents block above it.

**Steps:**

1. Line 104 — give the nav an id. Current code:

```svelte
	<nav class="mr-toc" aria-label="Contents">
```

Change to:

```svelte
	<nav class="mr-toc" id="mr-contents" aria-label="Contents">
```

2. Lines 195-197 — scroll to it (the `scrollIntoViewMotion` helper is already imported at line 12 and honors reduced motion). Current code:

```svelte
				<button type="button" class="mr-top" onclick={() => jump(magazine.cards[0]!.id)}>
					↑ Contents
				</button>
```

Change to:

```svelte
				<button
					type="button"
					class="mr-top"
					onclick={() =>
						scrollIntoViewMotion(document.getElementById('mr-contents'), { block: 'start' })}
				>
					↑ Contents
				</button>
```

3. Lines 298-304 — give the target scroll breathing room. Current code:

```css
	.mr-toc {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.25rem;
		margin-bottom: 2.5rem;
		background: var(--surface);
	}
```

Change to:

```css
	.mr-toc {
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: 1rem 1.25rem;
		margin-bottom: 2.5rem;
		background: var(--surface);
		scroll-margin-top: 1.5rem;
	}
```

**Do not:** remove the `jump()` function (still used by TOC links and `startId`); render more than one `MagazineReader` at a time exists nowhere, so the static id is safe.

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/magazine` → open an issue → scroll into article 3 → click "↑ Contents": the viewport lands on the Contents card, not article 1's headline.

**Acceptance:**
- "↑ Contents" lands on `nav#mr-contents` with 1.5rem clearance.
- TOC entry clicks and `startId` deep-links still work via `jump()`.

---

### D11: Tombstone on the last line of copy
**Priority:** P1 · **Depends on:** D5 (FlipReader template quote includes `!isShort`)
**Files:**
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte`
- `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte`

**Why:** The standalone right-aligned ∎ floats on its own line, disconnected from the copy it ends. Decision: always add the `::after` tombstone to the last paragraph AND delete the standalone element — when content doesn't end in a `<p>` (image, embed), a tombstone after a picture is noise rather than a full stop, so silently omitting it there is the simpler robust behavior (no `:has()` gymnastics, no JS detection).

**Steps:**

1. `MagazineReader.svelte:185` — delete the standalone mark. Current code (delete the line):

```svelte
					<p class="mr-end" aria-hidden="true">∎</p>
```

2. `MagazineReader.svelte:562-569` — replace the `.mr-end` CSS. Current code:

```css
	/* End-of-article mark — a small printed full stop to the feature. */
	.mr-end {
		margin: 1.4rem 0 0;
		text-align: right;
		color: var(--text-muted);
		font-size: 1.15rem;
		line-height: 1;
	}
```

Change to:

```css
	/* End-of-article tombstone, set on the final line of copy itself. Articles
	   that end in an image/embed get no mark — deliberate, not a bug. */
	.mr-body > :global(p:last-child)::after {
		content: '\2002\220E';
		color: var(--text-muted);
	}
```

3. `FlipReader.svelte:276-278` (post-D5) — delete the standalone mark. Current code (delete whole block):

```svelte
					{#if !loading && !error && !isShort}
						<p class="endmark" aria-hidden="true">∎</p>
					{/if}
```

4. `FlipReader.svelte:612-620` — replace the `.endmark` CSS (the comment covers both endmark and runfoot; runfoot stays). Current code:

```css
	/* End-of-article mark and a running foot folio give each page a printed
	   beginning-middle-end, the depth a real leaf carries. */
	.endmark {
		margin: 1.6rem 0 0;
		text-align: right;
		color: var(--text-muted);
		font-size: 1.15rem;
		line-height: 1;
	}
```

Change to:

```css
	/* End-of-article tombstone on the final line of copy itself (no mark when
	   the article ends in an image/embed — deliberate), plus a running foot
	   folio so each page keeps a printed beginning-middle-end. */
	.fr-body:not(.fr-bands) > :global(p:last-child)::after,
	.fr-bands:not(.fr-short) > .fr-band:last-child > :global(p:last-child)::after {
		content: '\2002\220E';
		color: var(--text-muted);
	}
```

**Do not:** use `p:last-of-type` descendant selectors (they'd stamp a tombstone on the last `p` of *every* nested container — blockquotes, list items); add the mark to `.fr-short` snippets (excluded by `:not(.fr-short)` and by D5's intent).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/magazine` issue — each article's final paragraph ends with " ∎" in muted ink on the same line, and no floating right-aligned ∎ remains; `/newspaper` → "Read edition" — same on the last band's last paragraph; an article ending in an image shows no mark.

**Acceptance:**
- `∎` renders appended to the final paragraph's last line (en-space separated, `--text-muted`).
- No standalone `.mr-end`/`.endmark` elements remain in either template.
- Short flip items and image-ending articles carry no tombstone.

---

### D12: Magazine kicker — UI face, muted ink, no triage state in the text
**Priority:** P1 · **Depends on:** none
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/MagazineReader.svelte`

**Why:** The kicker is mono + accent with triage state ("3 / 12 · read") spliced into a typographic element. Adopt FlipReader's kicker spec — quoted here from `FlipReader.svelte:455-464`:

```css
	.kicker {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
```

State already lives on the action buttons (`.mr-actions button.active`, MagazineReader.svelte:444-448) and the TOC (`.toc-state`).

**Steps:**

1. `MagazineReader.svelte:128-131` — strip triage state from the text. Current code:

```svelte
						<span class="mr-kicker">
							{i + 1} / {magazine.cards.length}
							{#if marked[card.id]}· {marked[card.id]}{/if}
						</span>
```

Change to:

```svelte
						<span class="mr-kicker">
							{i + 1} / {magazine.cards.length}
						</span>
```

2. `MagazineReader.svelte:394-401` — adopt the FlipReader spec. Current code:

```css
	.mr-kicker {
		display: inline-block;
		font-family: var(--font-mono, ui-monospace, monospace);
		font-size: var(--text-2xs);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
```

— note: if the file instead shows `color: var(--accent);` and no `font-variant-numeric` line (the pre-phase state), match on the selector and replace the whole block either way. Change to:

```css
	/* Kicker matches FlipReader's spec: UI face, 0.14em tracking, uppercase,
	   muted ink. Triage state lives on the action buttons, not in the kicker. */
	.mr-kicker {
		display: inline-block;
		font-family: var(--font-ui);
		font-size: var(--text-2xs);
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
```

**Do not:** touch `.mr-actions` or `.toc-state`; remove the `marked` record (still drives buttons, TOC, and `.archived` opacity).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/magazine` issue — kicker reads "3 / 12" in the UI sans, muted, uppercase; mark an article read: kicker text unchanged, the check button fills and the TOC entry strikes through.

**Acceptance:**
- Kicker shows only "n / total" in `--font-ui` at `--text-2xs`, 0.14em tracking, `--text-muted`.
- Triage state visible exclusively on buttons/TOC.

---

### D13: Cover decoration — hairline rules, matte foil, deduped cover art
**Priority:** P1 · **Depends on:** none
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/routes/magazine/+page.svelte`

**Why:** 2px white side-stripes and a glossy gradient "foil" are the banned decorative stripe/sheen; and because every issue takes "first article with an image", overlapping tags repeat the same cover photo across the shelf. Dedupe in display order; exhausted issues fall back to the existing typographic (gradient-only) cover.

**Steps:**

1. Lines 397-403 (`.cover-lines li`) — hairline. Current code:

```css
	.cover-lines li {
		font-family: var(--font-serif);
		font-size: clamp(0.95rem, 1.4vw, 1.1rem);
		line-height: 1.22;
		padding-left: 0.6rem;
		border-left: 2px solid color-mix(in srgb, white 55%, transparent);
```

Change only the border line, to:

```css
		border-left: 1px solid color-mix(in srgb, white 55%, transparent);
```

2. Lines 418-429 (`.foil`) — matte hairline instead of gloss. Current code:

```css
	.foil {
		display: block;
		height: 2px;
		border-radius: var(--radius-full);
		background: linear-gradient(
			90deg,
			transparent,
			color-mix(in srgb, white 78%, transparent),
			color-mix(in srgb, white 30%, transparent),
			transparent
		);
	}
```

Change to:

```css
	.foil {
		display: block;
		height: 1px;
		background: color-mix(in srgb, white 40%, transparent);
	}
```

3. Lines 48-52 — replace first-image-wins with a display-order dedupe. Current code (delete):

```ts
	// The cover art is the first article in the issue that carries an image.
	function coverArt(list: Card[]): string | null {
		for (const c of list) if (c.coverImage) return c.coverImage;
		return null;
	}
```

Replace with (a `$derived` map so the claim order is computed once per card change, never mutated during render):

```ts
	// Each cover claims a distinct image: walk the issues in display order and
	// let each take the first article image no earlier issue already claimed.
	// When the pool is exhausted the cover falls back to the typographic
	// (gradient-only) treatment.
	const coverArtByTag = $derived.by(() => {
		const used = new Set<string>();
		const map = new Map<string, string | null>();
		for (const issue of issues) {
			let art: string | null = null;
			for (const c of issue.cards) {
				if (c.coverImage && !used.has(c.coverImage)) {
					art = c.coverImage;
					used.add(c.coverImage);
					break;
				}
			}
			map.set(issue.tag, art);
		}
		return map;
	});
```

4. Lines 106-119 — the snippet looks art up by tag (it no longer needs the card list). Current code:

```svelte
{#snippet coverArtLayers(list: Card[], tag: string, eager = false)}
	{@const art = coverArt(list)}
	{#if art && !failedArt.has(tag)}
```

Change to:

```svelte
{#snippet coverArtLayers(tag: string, eager = false)}
	{@const art = coverArtByTag.get(tag) ?? null}
	{#if art && !failedArt.has(tag)}
```

(the rest of the snippet body — `<img class="cover-art" …>` and `.cover-tint` — is unchanged).

5. Line 151 (hero call site) — Current code:

```svelte
					{@render coverArtLayers(featured.cards, featured.tag, true)}
```

Change to:

```svelte
					{@render coverArtLayers(featured.tag, true)}
```

6. Line 198 (shelf call site) — Current code:

```svelte
							{@render coverArtLayers(issue.cards, issue.tag)}
```

Change to:

```svelte
							{@render coverArtLayers(issue.tag)}
```

**Do not:** mutate `used` inside the snippet (render-impure; the `$derived.by` map is the whole point); change the `failedArt` fallback flow — a failed image still drops that one cover to the gradient; touch the 55% mix on `.cover-lines li` (width only).

**Verify:** `pnpm -r typecheck && pnpm -r lint && pnpm -r test`. Manual (Paper theme): `/magazine` with two issues sharing articles — each cover shows a different photo; with more issues than distinct images, surplus covers render the tinted-gradient typographic cover; cover line rules and the foot rule are 1px hairlines, no gloss gradient.

**Acceptance:**
- No image URL appears on two covers simultaneously.
- Pool exhaustion → gradient-only cover (no broken/empty art).
- `.cover-lines li` 1px; `.foil` is a flat 1px `color-mix(in srgb, white 40%, transparent)` rule.

---

### D14: DIAGNOSTIC — blank page after a turn in FlipReader (investigation note, no fix)
**Priority:** P2 · **Depends on:** D6 (re-test after it lands; the motion change may shrink or mask the window)
**Files:** `/Users/luke/git/luke/Lectern/apps/web/src/lib/components/FlipReader.svelte` (read-only)

**Why:** Live walkthrough hit a multi-second blank page after a turn — content present in the DOM but paint delayed. This packet is notes for a human or stronger model; do not change code under it.

**Steps (investigation plan, not edits):**
1. **Reproduce:** `/newspaper` → "Read edition" on an image-heavy edition; turn pages rapidly (hold ArrowRight) on a throttled network (DevTools "Slow 4G") and 6x CPU throttle. Also try turning *while* the previous article's images are still loading.
2. **Suspects, in likelihood order:**
   - **Synchronous `splitBands` in a `$derived`** (FlipReader.svelte:103-105 → 18-66): `DOMParser.parseFromString` + per-node serialization over a long article runs on the main thread the moment `html` resolves — this lands mid-transition and can block the first paint of the new page.
   - **`in:fly` starting at `opacity: 0`** (line 237): if the transition's first frame is painted but subsequent frames are starved (by the parse above or image decode), the page sits near-invisible until the main thread frees — "content in DOM, paint delayed" matches exactly.
   - **`{#key index}` teardown + rebuild** (line 236): the whole article subtree (including loaded `<img>`s) is destroyed and recreated each turn; large band counts make this expensive.
   - **Image decode:** freshly inserted `<img>`s decode synchronously-ish on first paint; no `decoding="async"` is set on `{@html}` content.
3. **Instrument:**
   - Add temporary `onintrostart`/`onintroend` handlers on the `.page` article logging `performance.now()`; compare against a `requestAnimationFrame` timestamp logged right after `index = next` in `go()` — a gap ≫180ms confirms a starved transition.
   - Wrap `splitBands(html)` in `performance.mark`/`measure`; log duration vs article word count.
   - Record a Performance trace of one bad turn; look for a long "Parse HTML"/scripting block inside the transition window and `Image Decode` slices after it.
4. **Candidate remedies to evaluate (do not implement here):** move `splitBands` off the turn path (compute when `getArticleHtml` resolves during *prefetch*, cache `Band[]` per id alongside the html cache); start `fly` at `opacity: 1` so a starved transition shows a static page instead of a blank one; add `decoding="async"` to imgs during sanitize.

**Do not:** ship any code change from this packet; conflate this with the D6 double-animation fix — re-reproduce after D6 first.

**Verify:** n/a (diagnostic). Success = a trace pinning the blank window on one of the suspects above.

**Acceptance:**
- Reproduction recipe confirmed or refuted post-D6.
- Trace evidence identifying the blocking phase (parse vs decode vs transition starvation), attached to a follow-up issue.
