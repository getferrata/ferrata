// Run as a separate process: keeps writing to the database until told to stop,
// so a backup taken meanwhile has something to be inconsistent about.
import { db, sqlite } from "@/db";
import { llmCalls } from "@/db/schema";
import { newId } from "@/lib/util/id";

// No automatic checkpoint: everything this process writes stays in the
// write-ahead log while it runs, which is where a file-only copy loses it.
sqlite().pragma("wal_autocheckpoint = 0");
let i = 0;
const stop = Date.now() + 8_000;
while (Date.now() < stop) {
  db.insert(llmCalls)
    .values({ id: newId("call"), task: "probe", provider: "test", model: "m", tokensIn: i })
    .run();
  i += 1;
  if (i % 50 === 0) await new Promise((r) => setTimeout(r, 1));
}
console.log(i);
