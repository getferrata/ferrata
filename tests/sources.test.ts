import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/sources/chunk";
import { retrieve, type ChunkDoc } from "@/lib/sources/retrieve";

describe("chunkText", () => {
  it("returns [] for empty input", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("keeps small text as one chunk", () => {
    const cs = chunkText("Una frase corta.\n\nUn'altra.");
    expect(cs).toHaveLength(1);
    expect(cs[0]!.ord).toBe(0);
  });

  it("splits long text into multiple ordered chunks", () => {
    const para = "Frase di riempimento. ".repeat(120); // ~2600 chars
    const cs = chunkText(`${para}\n\n${para}`, 1000);
    expect(cs.length).toBeGreaterThan(2);
    expect(cs.map((c) => c.ord)).toEqual(cs.map((_, i) => i));
    for (const c of cs) expect(c.text.length).toBeLessThanOrEqual(1000 + 200);
  });
});

describe("retrieve (BM25)", () => {
  const docs: ChunkDoc[] = [
    { sourceId: "s1", sourceName: "net.md", ord: 0, text: "BGP è un protocollo di routing tra sistemi autonomi. eBGP e iBGP." },
    { sourceId: "s1", sourceName: "net.md", ord: 1, text: "OSPF è un IGP link-state dentro un'unica amministrazione." },
    { sourceId: "s2", sourceName: "storage.md", ord: 0, text: "Ceph replica i dati su più nodi e si autoripara." },
  ];

  it("ranks the most relevant chunk first", () => {
    const r = retrieve("come funziona eBGP tra sistemi autonomi", docs, 2);
    expect(r[0]!.text).toContain("BGP");
    expect(r[0]!.score).toBeGreaterThan(0);
  });

  it("returns nothing for an unrelated query", () => {
    expect(retrieve("ricetta della carbonara", docs)).toHaveLength(0);
  });

  it("handles an empty corpus", () => {
    expect(retrieve("qualsiasi", [])).toEqual([]);
  });
});
