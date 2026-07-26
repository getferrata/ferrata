/**
 * Demo seed: a small, self-contained onboarding course for a fictional
 * platform, so the study UI and the test suite have real content to work
 * against without any model call. Run with `pnpm db:seed:demo`. Idempotent.
 */
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "./index";
import type { BloomLevel } from "./schema";

const COURSE_ID = "course_demo_acme";

const para = (s: string) =>
  `${s} The gateway is the single front door of the platform: it terminates ` +
  `TLS for all inbound traffic and routes each request by path prefix to the ` +
  `right internal service. When it is down, everything looks down from the ` +
  `outside, even when the backends are healthy.`;

interface DemoQuestion {
  prompt: string;
  expected: string;
  bloom: BloomLevel;
}
interface DemoModule {
  title: string;
  summary: string;
  minutes: number;
  depth: number;
  body: string;
  questions: DemoQuestion[];
}

const MODULES: DemoModule[] = [
  {
    title: "The edge gateway, the single front door",
    summary: "TLS termination and path routing for the whole platform.",
    minutes: 30,
    depth: 2,
    body: [
      "## The idea, in two lines",
      "",
      "Like a receptionist, the gateway takes every visitor and walks them to",
      "the right office. No visitor reaches an office directly.",
      "",
      "## What's inside",
      "",
      "| Piece | Role |",
      "|---|---|",
      "| gateway | terminates TLS, routes by path |",
      "| api | serves /api/* requests |",
      "| auth | issues short-lived tokens |",
      "",
      "## In the real world",
      "",
      para("Start here."),
      "",
      "## Before this / next to this",
      "",
      "Nothing before it. Reading a 503 sits right next to it.",
    ].join("\n"),
    questions: [
      {
        prompt: "What does the gateway do with inbound TLS?",
        expected: "It terminates TLS at the edge and routes by path prefix.",
        bloom: "remember",
      },
      {
        prompt: "The platform looks completely down from outside. What single component do you check first, and why?",
        expected:
          "The edge gateway: it is the single front door, so if it is down everything looks down even when the backends are healthy.",
        bloom: "understand",
      },
    ],
  },
  {
    title: "Reading a 503",
    summary: "An empty backend pool, not a broken gateway.",
    minutes: 30,
    depth: 3,
    body: [
      "## The idea, in two lines",
      "",
      "A 503 at the edge almost always means the upstream pool is empty. The",
      "gateway is up; it just has no healthy backend to route to.",
      "",
      "## What's inside",
      "",
      "Readiness probes gate which backends join the pool. A deploy whose pods",
      "fail readiness drains the pool toward zero, and the edge answers 503.",
      "",
      "## In the real world",
      "",
      para("The reflex to unlearn is restarting the gateway."),
      "",
      "## Before this / next to this",
      "",
      "Before this: the edge gateway. Next to it: failover.",
    ].join("\n"),
    questions: [
      {
        prompt: "A 503 at the edge: what is the first thing you check?",
        expected: "The backend pool and the service registry, not the gateway.",
        bloom: "understand",
      },
      {
        prompt: "During a 503 storm someone restarts the gateway. What happens?",
        expected:
          "Nothing useful: the gateway was healthy, the pool was empty. Roll the backend back instead.",
        bloom: "apply",
      },
    ],
  },
  {
    title: "Failover",
    summary: "Two gateways, one virtual address, automatic takeover.",
    minutes: 20,
    depth: 2,
    body: [
      "## The idea, in two lines",
      "",
      "Two gateways share one virtual address. If the primary stops answering,",
      "the secondary claims the address in a few seconds, automatically.",
      "",
      "## What's inside",
      "",
      "Heartbeats between the pair decide who holds the address. Moving it by",
      "hand invites a split brain where both answer.",
      "",
      "## In the real world",
      "",
      para("Failover is automatic; keep your hands off the address."),
      "",
      "## Before this / next to this",
      "",
      "Before this: the edge gateway. It pairs with reading a 503.",
    ].join("\n"),
    questions: [
      {
        prompt: "The primary gateway stops answering heartbeats. What do you do?",
        expected:
          "Nothing: the secondary claims the shared address automatically within seconds.",
        bloom: "apply",
      },
    ],
  },
];

function seed(): void {
  db.transaction((tx) => {
    tx.delete(schema.courses).where(eq(schema.courses.id, COURSE_ID)).run();
    tx.insert(schema.courses)
      .values({
        id: COURSE_ID,
        title: "Acme platform onboarding",
        sourcePrompt: "Onboard a new engineer on the Acme platform edge.",
        origin: "local",
        lang: "en",
        objective:
          "Handle the edge on call: know the front door, read a 503 correctly, and trust failover.",
        domain: "platform operations",
        concretenessRule:
          "Every abstract point says where it physically lives and who pays.",
        startLevel: "comfortable with Linux, new to this platform",
        scheduleMd:
          "## Study plan\n\nDay 1: the edge gateway, then reading a 503.\n\nDay 2: failover, then the review session.",
        glossaryMd:
          "**Pool**: the set of healthy backends the gateway can route to.\n\n**Readiness probe**: the check a backend must pass before taking traffic.\n\n**Virtual address**: the shared address the gateway pair answers on.",
        budgetMinutes: 240,
        status: "ready",
        ownerId: null,
        depthPreset: "operational",
      })
      .run();

    const conceptIds: string[] = [];
    MODULES.forEach((m, i) => {
      const conceptId = `concept_demo_${i}`;
      conceptIds.push(conceptId);
      tx.insert(schema.concepts)
        .values({
          id: conceptId,
          courseId: COURSE_ID,
          title: m.title,
          summary: m.summary,
          priority: i < 2 ? "critical" : "high",
          estimatedMinutes: m.minutes,
          depthLevel: m.depth,
          topoOrder: i,
        })
        .run();
      tx.insert(schema.modules)
        .values({
          id: `module_demo_${i}`,
          conceptId,
          kind: "concept",
          bodyMd: m.body,
          status: "ready",
          generatedAt: Date.now(),
        })
        .run();
      m.questions.forEach((q, qi) => {
        tx.insert(schema.questions)
          .values({
            id: `q_demo_${i}_${qi}`,
            conceptId,
            prompt: q.prompt,
            expectedAnswer: q.expected,
            bloomLevel: q.bloom,
            format: "open",
            misconceptionsJson: JSON.stringify([]),
          })
          .run();
      });
    });

    const edges: [number, number][] = [
      [0, 1],
      [0, 2],
    ];
    for (const [from, to] of edges) {
      tx.insert(schema.edges)
        .values({
          id: randomUUID(),
          courseId: COURSE_ID,
          fromConceptId: conceptIds[from]!,
          toConceptId: conceptIds[to]!,
        })
        .run();
    }
  });

  console.log(
    `Seeded demo course ${COURSE_ID}: ${MODULES.length} modules, ` +
      `${MODULES.reduce((s, m) => s + m.questions.length, 0)} questions.`,
  );
}

seed();
