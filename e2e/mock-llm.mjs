/**
 * Deterministic mock LLM for e2e runs: a real HTTP server speaking the
 * OpenAI-compatible chat API, so the app and its job worker exercise the whole
 * real pipeline (statuses, parsing, retries, UI) with instant, schema-valid
 * responses. Each Ferrata task prompt opens with a distinctive "You are the
 * <stage> of Ferrata" line, which is all the routing needed.
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_LLM_PORT ?? 4545);

const FILLER =
  "The gateway terminates TLS at the edge and routes each request by path " +
  "prefix to the right internal service. If it is down, everything looks down " +
  "from the outside even when the backends are healthy. A 503 at the edge " +
  "almost always means the upstream pool is empty, not that the gateway is " +
  "broken, so check the service registry before touching the gateway itself. ";

const MODULE_BODY = [
  "## The idea, in two lines",
  "",
  "The edge gateway is the single front door: like a receptionist, it takes",
  "every visitor and walks them to the right office.",
  "",
  "## What's inside",
  "",
  "| Piece | Role |",
  "|---|---|",
  "| gateway | terminates TLS, routes by path |",
  "| api | serves /api/* requests |",
  "",
  "## In the real world",
  "",
  FILLER,
  FILLER,
  "",
  "## Before this / next to this",
  "",
  "Nothing before it; failover sits next to it.",
].join("\n");

function respond(system) {
  if (system.includes("authoring-interview stage")) {
    return {
      questions: [
        { key: "audience", question: "Who is this course for, by name?", why: "Grounds the tone and depth." },
        { key: "deadline", question: "When must they be ready?", why: "Sets the time budget." },
      ],
    };
  }
  if (system.includes("intake stage")) {
    return {
      title: "Acme edge onboarding",
      lang: "en",
      objective: "Run the edge gateway on call without waking anyone up.",
      domain: "platform operations",
      startLevel: "comfortable with Linux, new to this platform",
      deadline: null,
      budgetMinutes: 240,
      concretenessRule: "Every abstract point says where it physically lives and who pays.",
      candidateConcepts: [
        { title: "The edge gateway", summary: "The single front door: TLS and routing.", priority: "critical", estimatedMinutes: 30, depthLevel: 2 },
        { title: "Reading a 503", summary: "Empty pool, not broken gateway.", priority: "critical", estimatedMinutes: 30, depthLevel: 3 },
        { title: "Failover", summary: "VRRP moves the VIP in seconds.", priority: "high", estimatedMinutes: 20, depthLevel: 2 },
      ],
    };
  }
  if (system.includes("prerequisite-graph stage")) {
    return {
      edges: [
        { fromIndex: 0, toIndex: 1, reason: "You read a 503 at the gateway you already understand." },
        { fromIndex: 0, toIndex: 2, reason: "Failover moves the gateway's own address." },
      ],
    };
  }
  if (system.includes("module-writing stage")) {
    return { title: "Module", bodyMd: MODULE_BODY };
  }
  if (system.includes("concreteness pass")) {
    return { bodyMd: MODULE_BODY, notes: [] };
  }
  if (system.includes("quality judge")) {
    return { pass: true, score: 0.92, issues: [], specificityViolations: [] };
  }
  if (system.includes("question-writing stage")) {
    return {
      questions: [
        {
          prompt: "A 503 at the edge: what is the first thing you check?",
          expectedAnswer: "The backend pool and service registry, not the gateway.",
          bloomLevel: "understand",
          format: "open",
          options: null,
          misconceptions: ["Restarting the gateway fixes a 503."],
        },
        {
          prompt: "What does the gateway do with inbound TLS?",
          expectedAnswer: "It terminates TLS at the edge and routes by path prefix.",
          bloomLevel: "remember",
          format: "open",
          options: null,
          misconceptions: [],
        },
      ],
    };
  }
  if (system.includes("scheduler of Ferrata")) {
    return {
      scheduleMd:
        "## Study plan\n\n" +
        "Day 1: the edge gateway, then reading a 503.\n\n" +
        "Day 2: failover, then the review session to anchor what slipped.",
    };
  }
  if (system.includes("glossary stage")) {
    return {
      glossaryMd:
        "**VIP**: the shared virtual address the gateways answer on.\n\n" +
        "**Readiness probe**: the check a backend must pass before taking traffic.\n\n" +
        "**Pool**: the set of healthy backends the gateway can route to.",
    };
  }
  if (system.includes("Feynman coach")) {
    return { strengths: "Clear on routing.", gap: "What empties the pool.", complete: false };
  }
  return { error: "unrecognized task" };
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "mock-strong" }, { id: "mock-fast" }] }));
    return;
  }
  if (req.method !== "POST" || !req.url?.includes("/chat/completions")) {
    res.writeHead(404);
    res.end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let system = "";
    try {
      const parsed = JSON.parse(body);
      const sys = (parsed.messages ?? []).find((m) => m.role === "system");
      system = sys?.content ?? "";
    } catch {
      // fall through with empty system
    }
    const payload = respond(system);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      }),
    );
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-llm] listening on 127.0.0.1:${PORT}`);
});
