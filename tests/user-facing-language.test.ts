import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePackage } from "@/lib/package/import";
import { extractText } from "@/lib/sources/extract";

describe("messages a person reads are in the interface's language", () => {
  it("a file that is not a Ferrata package says so in plain English", () => {
    let message = "";
    try {
      parsePackage({ hello: "not a package" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^This is not a valid Ferrata package/);
    expect(message).toMatch(/manifest is missing/);
    expect(message).not.toMatch(/Pacchetto|\(Required\)/);
  });

  it("a binary file is refused with a sentence, not a fragment in another language", async () => {
    const bytes = Buffer.alloc(400);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 7 === 0 ? 0 : 200 + (i % 50);
    const r = await extractText("tool.bin", "application/octet-stream", bytes);
    expect(r.ok).toBe(false);
    expect(r.error).toBe("This file type is not supported, or the file is binary.");
  });

  it("no sentence in the code a user can see is in Italian", () => {
    // The two files that produce these strings, read as text. A new one would
    // arrive the same way the three found by using the product did.
    for (const file of ["src/lib/package/import.ts", "src/lib/sources/extract.ts"]) {
      const text = readFileSync(join(__dirname, "..", file), "utf8");
      expect(text, file).not.toMatch(/Pacchetto non valido|non supportato|estrazione fallita/);
    }
  });
});
