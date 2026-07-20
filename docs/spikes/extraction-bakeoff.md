# Extraction bake-off: Readability vs Readeck

Question: could Lectern drop Readeck and extract article text itself with a
library (`@mozilla/readability` + `linkedom`)? Run against the **real library**
(267 Readeck saves), 2026-06-03.

## Method

- Dumped all 267 Readeck bookmarks (`url`, `word_count`) from the live instance.
- For each URL: fetched it fresh (12s timeout, browser UA, follow redirects) and
  ran `@mozilla/readability` over the HTML parsed by `linkedom`.
- Compared the extracted word count to Readeck's stored `word_count`.
- Independently LLM-judged extraction quality on a 10-URL, distinct-host sample
  (clean / partial / junk).

## Results

| Outcome                                          | Count | %   |
| ------------------------------------------------ | ----- | --- |
| Extracted cleanly (`ok`)                         | 208   | 78% |
| Fetch/HTTP failure (403/401/404/410/400/timeout) | 38    | 14% |
| PDF (Readability can't)                          | 6     | 2%  |
| Thin (<50 words; likely JS-rendered)             | 15    | 6%  |

- **When Readability can fetch the HTML, it matches Readeck almost exactly:**
  median Readability/Readeck word ratio = **1.0**; of 203 `ok` pages with a
  Readeck baseline, **201 were comparable (0.5–1.6×)**, 0 thin, 2 longer.
- **Quality sample: 9/10 judged "clean"** by an independent LLM. The lone "junk"
  was `abcnews.com` — a _section index_ URL the user saved, not an article, so
  no extractor would do better.

## The big caveat

The 38 fetch failures are **re-fetch-now** failures: paywalls (401/403), dead
links (404/410), and expired signed URLs. Readeck has these cached because it
extracted them **at save time**, when the page was live (and, for paywalled
sites, possibly with the user's session). A from-scratch extractor would run at
save time too, so its real-world failure rate is **well below 14%** — most of
these would have succeeded when first saved.

## Recommendation

- **Extraction quality is not a reason to keep Readeck.** On real articles, a
  Readability library is on par (ratio 1.0, 9/10 clean).
- Readeck still earns its keep on: **PDFs (~2%)**, **JS-rendered pages (~6%)**
  (need a headless fallback), and as a **save-time cache** for ephemeral/paywalled
  pages.
- **Path chosen:** own the content (the `document_content` store) so re-fetch
  failures stop mattering, and keep Readeck as the extractor behind the
  `ReadLaterBackend` seam for now. Dropping it later is a low-risk one-adapter
  swap: Readability for the 90%+ text case, a headless browser for the thin ~6%,
  and a PDF text extractor for the ~2%. Re-run this bake-off at save time (not
  re-fetch) before committing to the swap.
