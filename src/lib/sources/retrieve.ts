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

/**
 * A prebuilt BM25 index over a corpus. Building it (tokenising every chunk,
 * counting document frequencies) is the expensive part, and it does not change
 * between queries, so a course that writes 15 modules from the same corpus
 * builds this once instead of 15 times.
 */
export interface Bm25Index {
  docs: { doc: ChunkDoc; tf: Map<string, number>; dl: number }[];
  df: Map<string, number>;
  avgdl: number;
  N: number;
}

export function buildIndex(chunks: ChunkDoc[]): Bm25Index {
  const docs = chunks.map((c) => {
    const terms = tokenize(c.text);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { doc: c, tf, dl: terms.length };
  });
  const N = docs.length;
  const avgdl = N ? docs.reduce((s, d) => s + d.dl, 0) / N : 1;
  const df = new Map<string, number>();
  for (const { tf } of docs) {
    for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { docs, df, avgdl, N };
}

// Maximal Marginal Relevance: how much a candidate's relevance is discounted by
// how similar it already is to what has been picked. 0.7 keeps relevance in the
// lead while still breaking up near-duplicate excerpts, which is the common case
// when a corpus repeats the same passage across files (a runbook copied into a
// wiki). Without this the top-k can be five phrasings of one fact, starving the
// module of the rest of the material.
const MMR_LAMBDA = 0.7;

// Above this similarity a candidate is treated as a near-duplicate of something
// already picked and skipped outright, however relevant it is: the same passage
// copied across two files should occupy one slot, not two. Kept high (near
// identical) so genuinely distinct-but-related chunks are not dropped. If only
// duplicates remain, k is still filled rather than returning fewer than asked.
const DEDUP_SIM = 0.9;

/** Cosine similarity between two term-frequency maps (0..1). */
function cosineTf(a: Map<string, number>, b: Map<string, number>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, f] of small) {
    const g = large.get(t);
    if (g) dot += f * g;
  }
  if (dot === 0) return 0;
  let na = 0;
  for (const f of a.values()) na += f * f;
  let nb = 0;
  for (const f of b.values()) nb += f * f;
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/**
 * Top-k chunks most relevant to the query, scored against a prebuilt index and
 * diversified with MMR so near-duplicate excerpts do not crowd out coverage. The
 * first pick is always the most relevant chunk (nothing selected yet to be
 * similar to), so single-result callers see the same top hit as pure BM25.
 */
export function retrieveWith(
  index: Bm25Index,
  query: string,
  k = 5,
): RetrievedChunk[] {
  if (index.N === 0) return [];
  const idf = (t: string): number => {
    const n = index.df.get(t) ?? 0;
    return Math.log(1 + (index.N - n + 0.5) / (n + 0.5));
  };
  const qTerms = [...new Set(tokenize(query))];
  const scored = index.docs
    .map(({ doc, tf, dl }) => {
      let score = 0;
      for (const q of qTerms) {
        const f = tf.get(q);
        if (!f) continue;
        score +=
          idf(q) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * dl) / index.avgdl)));
      }
      return { doc, tf, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.ord - b.doc.ord);

  if (scored.length <= 1 || k <= 1) {
    return scored.slice(0, k).map(({ doc, score }) => ({ ...doc, score }));
  }

  // Greedy MMR over the relevant pool. Relevance is normalised by the top score
  // so it shares a scale with the [0,1] similarity term.
  const maxScore = scored[0]!.score;
  const pool = scored.slice(0, Math.max(k * 4, 12));
  const selected: typeof pool = [];
  while (selected.length < k && pool.length > 0) {
    let bestIdx = -1;
    let bestVal = -Infinity;
    // If every remaining candidate is a near-duplicate of a pick, fall back to
    // the most relevant of them so k is still filled.
    let fallbackIdx = 0;
    let fallbackRel = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i]!;
      let maxSim = 0;
      for (const s of selected) {
        const sim = cosineTf(cand.tf, s.tf);
        if (sim > maxSim) maxSim = sim;
      }
      const rel = maxScore ? cand.score / maxScore : 0;
      if (rel > fallbackRel) {
        fallbackRel = rel;
        fallbackIdx = i;
      }
      if (maxSim >= DEDUP_SIM) continue; // near-duplicate of a pick; skip
      const val = MMR_LAMBDA * rel - (1 - MMR_LAMBDA) * maxSim;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    const pick = bestIdx >= 0 ? bestIdx : fallbackIdx;
    selected.push(pool.splice(pick, 1)[0]!);
  }
  return selected.map(({ doc, score }) => ({ ...doc, score }));
}

/** Convenience for single-shot callers: build the index and query it once. */
export function retrieve(
  query: string,
  chunks: ChunkDoc[],
  k = 5,
): RetrievedChunk[] {
  return retrieveWith(buildIndex(chunks), query, k);
}
