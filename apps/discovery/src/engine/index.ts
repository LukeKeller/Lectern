// Classic IR engine: tokenization, TF-IDF cosine scoring, and Rocchio
// relevance feedback. No LLM anywhere.
export { tokenize, termFrequencies, surfaceForms } from "./tokenize";
export { computeIdf, tfidfVector, cosine, l2normalize, DEFAULT_IDF } from "./tfidf";
export { updateProfile, buildSeedProfile, DEFAULT_TOP_K, type SeedProfile } from "./rocchio";
