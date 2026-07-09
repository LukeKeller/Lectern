import type { DiscoverySeed, RocchioWeights, TermVector } from "../discovery";
import { termFrequencies, tokenize } from "./tokenize";
import { computeIdf, tfidfVector } from "./tfidf";

/**
 * Rocchio relevance feedback (no LLM): the interest profile is nudged toward
 * liked documents and away from disliked ones.
 *
 *   profile' = a * profile + b * mean(liked) - c * mean(disliked)
 *
 * Negative weights are clamped to 0 (a term can't have negative interest) and
 * only the top-K terms by weight are retained, bounding profile growth.
 */

/** Retain at most this many terms after an update, keeping the heaviest. */
export const DEFAULT_TOP_K = 500;

export function updateProfile(
  profile: TermVector,
  liked: TermVector[],
  disliked: TermVector[],
  w: RocchioWeights,
  topK = DEFAULT_TOP_K,
): TermVector {
  const out: TermVector = {};
  const accumulate = (vec: TermVector, factor: number): void => {
    for (const [term, v] of Object.entries(vec)) {
      out[term] = (out[term] ?? 0) + v * factor;
    }
  };

  accumulate(profile, w.a);
  accumulate(mean(liked), w.b);
  accumulate(mean(disliked), -w.c);

  // Clamp non-positive weights to 0 (drop them from the sparse map).
  for (const term of Object.keys(out)) {
    const v = out[term];
    if (v === undefined || v <= 0) delete out[term];
  }

  return topKTerms(out, topK);
}

/** Component-wise mean of a set of sparse vectors (empty set -> `{}`). */
function mean(vecs: TermVector[]): TermVector {
  if (vecs.length === 0) return {};
  const sum: TermVector = {};
  for (const vec of vecs) {
    for (const [term, v] of Object.entries(vec)) {
      sum[term] = (sum[term] ?? 0) + v;
    }
  }
  const out: TermVector = {};
  for (const [term, v] of Object.entries(sum)) out[term] = v / vecs.length;
  return out;
}

/** Keep the `k` heaviest terms, dropping the rest. */
function topKTerms(vec: TermVector, k: number): TermVector {
  const entries = Object.entries(vec).sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, k));
}

/** The initial profile built from the library seed corpus. */
export interface SeedProfile {
  /** L2-normalized TF-IDF profile vector. */
  vector: TermVector;
  /** IDF map over the seed corpus, reused to weight future candidate vectors. */
  idf: TermVector;
  /** Number of pseudo-documents that fed the IDF. */
  docCount: number;
}

/**
 * Turn a `DiscoverySeed` into an initial profile + IDF using the shared
 * tokenizer. Each seed doc becomes a pseudo-document whose term frequencies are
 * scaled by `doc.weight`; each tag becomes a pseudo-document whose term is
 * repeated in proportion to its weight. The aggregate TF across all
 * pseudo-documents is TF-IDF weighted and normalized to form the profile.
 */
export function buildSeedProfile(seed: DiscoverySeed): SeedProfile {
  const docsTerms: TermVector[] = [];
  const aggregate: TermVector = {};

  const addPseudoDoc = (tf: TermVector): void => {
    docsTerms.push(tf);
    for (const [term, v] of Object.entries(tf)) {
      aggregate[term] = (aggregate[term] ?? 0) + v;
    }
  };

  for (const doc of seed.docs) {
    // Fold the doc weight into its term frequencies.
    addPseudoDoc(termFrequencies(tokenize(doc.text), doc.weight));
  }

  for (const tag of seed.tags) {
    // Repeat the tag's terms ∝ its weight so heavier tags carry more mass.
    const repeat = Math.max(1, Math.round(tag.weight));
    const tokens = tokenize(tag.name);
    const repeated: string[] = [];
    for (let i = 0; i < repeat; i++) repeated.push(...tokens);
    addPseudoDoc(termFrequencies(repeated));
  }

  const { idf, docCount } = computeIdf(docsTerms);
  const vector = tfidfVector(aggregate, idf);
  return { vector, idf, docCount };
}
