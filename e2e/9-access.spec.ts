import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

/**
 * Black box access probe.
 *
 * The inventory test in tests/entrypoints.test.ts asks whether a guard is
 * present. This one asks whether it works, which is a different question: a
 * guard can exist and still check the wrong thing. Every URL below is tried by
 * somebody who should not get it, and anything that answers 200 is a finding.
 *
 * It is written as a sweep rather than a list of cases on purpose. A new URL is
 * one line here, and forgetting to add it is the only way to be unprotected,
 * which is what the inventory test covers from the other side.
 */

const DEMO = "course_demo_acme";

/** Read-only URLs that expose course content. */
const COURSE_GETS = (id: string) => [
  `/courses/${id}`,
  `/courses/${id}/dashboard`,
  `/courses/${id}/glossary`,
  `/courses/${id}/review`,
  `/api/courses/${id}`,
  `/api/courses/${id}/package`,
];

/** Endpoints that change something or spend money. */
const PRIVILEGED_POSTS = (id: string) => [
  { url: "/api/courses", body: {} },
  { url: "/api/import", body: {} },
  { url: "/api/import/preview", body: {} },
  { url: "/api/invites", body: { role: "examiner" } },
  { url: `/api/courses/${id}/export`, body: {} },
  { url: `/api/courses/${id}/invite`, body: {} },
  { url: `/api/courses/${id}/enroll`, body: { email: "x@y.z" } },
  { url: `/api/courses/${id}/interview`, body: { answers: {} } },
  { url: `/api/courses/${id}/concepts`, body: { dropIds: [] } },
  { url: "/api/settings/llm", body: { values: {} } },
  { url: "/api/settings/credits", body: { limit: "1" } },
  { url: "/api/settings/llm/test", body: {} },
  { url: "/api/feynman", body: { conceptId: "concept_x", explanation: "a".repeat(40) } },
];

async function ctxFor(state: string | undefined, testInfo: { project: { use: { baseURL?: unknown } } }) {
  return pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    ...(state ? { storageState: state } : {}),
    // Follow nothing: a redirect to /login is a refusal, and following it would
    // turn that refusal into a 200 and hide the finding.
    maxRedirects: 0,
  });
}

/** A refusal is anything that is not a success. 3xx to /login counts. */
function refused(status: number): boolean {
  return status !== 200 && status !== 201;
}

test.describe("access control, probed rather than assumed", () => {
  test("an anonymous caller gets nothing", async ({}, testInfo) => {
    const anon = await ctxFor(undefined, testInfo);
    const leaks: string[] = [];

    for (const url of COURSE_GETS(DEMO)) {
      const res = await anon.get(url);
      if (!refused(res.status())) leaks.push(`GET ${url} -> ${res.status()}`);
    }
    for (const { url, body } of PRIVILEGED_POSTS(DEMO)) {
      const res = await anon.post(url, { data: body });
      if (!refused(res.status())) leaks.push(`POST ${url} -> ${res.status()}`);
    }
    await anon.dispose();
    expect(leaks, `reachable without an account:\n${leaks.join("\n")}`).toEqual([]);
  });

  test("a student cannot use the examiner's endpoints", async ({}, testInfo) => {
    const student = await ctxFor("e2e/.artifacts/student.json", testInfo);
    const leaks: string[] = [];

    for (const { url, body } of PRIVILEGED_POSTS(DEMO)) {
      // Enrolment in the demo course is legitimate for this account, so a
      // 4xx for the right reason is what we want everywhere here.
      const res = await student.post(url, { data: body });
      if (!refused(res.status())) leaks.push(`POST ${url} -> ${res.status()}`);
    }
    await student.dispose();
    expect(leaks, `a student account reached:\n${leaks.join("\n")}`).toEqual([]);
  });

  test("a student cannot read a course they were not given", async ({}, testInfo) => {
    // Build a course owned by the examiner that the student is never enrolled
    // in, then try to read it from the student's session.
    const examiner = await ctxFor("e2e/.artifacts/examiner.json", testInfo);
    const created = await examiner.post("/api/courses", {
      multipart: { prompt: "a private route about the failover runbook" },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await examiner.dispose();

    const student = await ctxFor("e2e/.artifacts/student.json", testInfo);
    const leaks: string[] = [];
    for (const url of COURSE_GETS(id)) {
      const res = await student.get(url);
      if (!refused(res.status())) leaks.push(`GET ${url} -> ${res.status()}`);
    }
    await student.dispose();
    expect(
      leaks,
      `a student read a course they were never assigned:\n${leaks.join("\n")}`,
    ).toEqual([]);
  });

  test("the probe would notice a hole", async ({}, testInfo) => {
    // A sweep that always passes is worth nothing, so confirm the same request
    // does succeed for someone who is entitled to it. If this ever fails, the
    // three tests above are green because everything is broken, not because
    // everything is safe.
    const examiner: APIRequestContext = await ctxFor(
      "e2e/.artifacts/examiner.json",
      testInfo,
    );
    const res = await examiner.get(`/courses/${DEMO}`);
    expect(res.status()).toBe(200);
    await examiner.dispose();
  });
});
