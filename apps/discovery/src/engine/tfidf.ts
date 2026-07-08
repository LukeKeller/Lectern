import type { TermVector } from "@lectern/shared";

/**
 * Classic TF-IDF vector-space scoring (no LLM). Documents are sparse
 * term->weight maps; similarity is cosine over L2-normalized vectors.
 */

/**
 * Fallback IDF for a term absent from the corpus (e.g. a candidate term the
 * profile has never seen). A modest positive weight keeps it contributing but
 * not dominating.
 */
export const DEFAULT_IDF = 1;

/**
 * Smoothed inverse document frequency over a set of per-document term vectors.
 * `idf(t) = ln((N + 1) / (df(t) + 1)) + 1` — the +1 smoothing avoids div-by-zero
 * and keeps every idf strictly positive.
 */
export function computeIdf(docsTerms: TermVector[]): { idf: TermVector; docCount: number } {
  const docCount = docsTerms.length;
  const df: TermVector = {};
  for (const doc of docsTerms) {
    for (const term of Object.keys(doc)) {
      df[term] = (df[term] ?? 0) + 1;
    }
  }
  const idf: TermVector = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log((docCount + 1) / (count + 1)) + 1;
  }
  return { idf, docCount };
}

/**
 * TF-IDF weight a term-frequency vector against a precomputed IDF map, then
 * L2-normalize. Terms missing from `idf` fall back to `defaultIdf`.
 */
export function tfidfVector(tf: TermVector, idf: TermVector, defaultIdf = DEFAULT_IDF): TermVector {
  const weighted: TermVector = {};
  for (const [term, freq] of Object.entries(tf)) {
    weighted[term] = freq * (idf[term] ?? defaultIdf);
  }
  return l2normalize(weighted);
}

/** Scale a sparse vector to unit L2 length. A zero vector maps to `{}`. */
export function l2normalize(vec: TermVector): TermVector {
  let sumSq = 0;
  for (const v of Object.values(vec)) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) return {};
  const out: TermVector = {};
  for (const [term, v] of Object.entries(vec)) out[term] = v / norm;
  return out;
}

/**
 * Cosine similarity of two sparse vectors: the dot product of their
 * L2-normalized forms. Iterates the smaller vector for efficiency. Returns a
 * value in [0, 1] for non-negative inputs (0 = orthogonal, 1 = identical).
 */
export function cosine(a: TermVector, b: TermVector): number {
  const an = l2normalize(a);
  const bn = l2normalize(b);
  const [small, large] =
    Object.keys(an).length <= Object.keys(bn).length ? [an, bn] : [bn, an];
  let dot = 0;
  for (const [term, v] of Object.entries(small)) {
    const other = large[term];
    if (other !== undefined) dot += v * other;
  }
  return dot;
}
