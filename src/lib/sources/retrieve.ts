/**
 * Lexical retrieval (BM25) over a course's source chunks. Pure and deterministic:
 * no embeddings, no model download, fully offline (sovereign by default). It is
 * a `Retriever` behind a stable shape, so a semantic retriever can be swapped in
 * later without touching the generation pipeline.
 */

export interface ChunkDoc {
  sourceId: string;
  sourceName: string;
  ord: number;
  text: string;
}

export interface RetrievedChunk extends ChunkDoc {
  score: number;
}

const STOP = new Set(
  "the a an and or of to in on for with is are be as at by it this that i you he she we they di il lo la i gli le un una e o che a da in con su per tra fra non è sono come".split(
    /\s+/,
  ),
);

function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).filter(
    (t) => !STOP.has(t),
  );
}

const K1 = 1.5;
const B = 0.75;

/** Return the top-k chunks most relevant to the query (BM25). */
export function retrieve(
  query: string,
  chunks: ChunkDoc[],
  k = 5,
): RetrievedChunk[] {
  if (chunks.length === 0) return [];
  const docs = chunks.map((c) => ({ doc: c, terms: tokenize(c.text) }));
  const N = docs.length;
  const avgdl = docs.reduce((s, d) => s + d.terms.length, 0) / N || 1;

  // document frequency per term
  const df = new Map<string, number>();
  for (const { terms } of docs) {
    for (const t of new Set(terms)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = (t: string): number => {
    const n = df.get(t) ?? 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  const qTerms = [...new Set(tokenize(query))];

  const scored = docs.map(({ doc, terms }) => {
    const dl = terms.length;
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const q of qTerms) {
      const f = tf.get(q);
      if (!f) continue;
      score += idf(q) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * dl) / avgdl)));
    }
    return { ...doc, score };
  });

  return scored
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || a.ord - b.ord)
    .slice(0, k);
}
