/**
 * Text chunking shared by the TTS backends. Synthesis engines cap the characters
 * per request (and very long requests time out), so long article bodies are split
 * into chunks that are synthesized separately and concatenated. Splitting prefers
 * paragraph boundaries, falls back to sentences, then hard-splits so a single
 * oversized paragraph can't blow the per-request limit.
 */

/**
 * Split text into chunks no longer than `limit` characters, preferring paragraph
 * boundaries and falling back to sentence then hard splits.
 */
export function chunkText(text: string, limit: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };
  for (const para of paragraphs) {
    for (const piece of para.length > limit ? splitToLimit(para, limit) : [para]) {
      if (current && current.length + piece.length + 2 > limit) flush();
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  flush();
  return chunks;
}

/** Break an oversized string into ≤limit pieces on sentence then hard bounds. */
function splitToLimit(text: string, limit: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    for (const unit of sentence.length > limit ? hardSplit(sentence, limit) : [sentence]) {
      if (buf && buf.length + unit.length + 1 > limit) {
        out.push(buf.trim());
        buf = "";
      }
      buf = buf ? `${buf} ${unit}` : unit;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function hardSplit(text: string, limit: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += limit) out.push(text.slice(i, i + limit));
  return out;
}
