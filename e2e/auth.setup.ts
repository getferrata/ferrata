import { test as setup, expect } from "@playwright/test";
import { EXAMINER, STUDENT } from "./personas";

/**
 * Creates the two personas every journey needs and saves their sessions.
 * Runs before all specs (project dependency).
 *
 * The install is invite only. The first account ever registered becomes the
 * examiner who sets it up; everyone after that needs a link that examiner
 * minted, and the link decides the role.
 */

setup("register examiner", async ({ request }) => {
  const res = await request.post("/api/auth/register", { data: EXAMINER });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { role: string };
  expect(body.role).toBe("examiner");
  await request.storageState({ path: "e2e/.artifacts/examiner.json" });
});

setup("register student", async ({ request }) => {
  // Sign in as the examiner to mint the invite, then spend it as the newcomer.
  const login = await request.post("/api/auth/login", {
    data: { email: EXAMINER.email, password: EXAMINER.password },
  });
  expect(login.ok()).toBe(true);

  const minted = await request.post("/api/invites", {
    data: { role: "student" },
  });
  expect(minted.status()).toBe(201);
  const { token } = (await minted.json()) as { token: string };

  const res = await request.post("/api/auth/register", {
    data: { ...STUDENT, invite: token },
  });
  expect(res.status()).toBe(201);
  const body = (await res.json()) as { role: string };
  expect(body.role).toBe("student");
  await request.storageState({ path: "e2e/.artifacts/student.json" });
});
