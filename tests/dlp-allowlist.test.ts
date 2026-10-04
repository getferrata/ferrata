import { describe, expect, it } from "vitest";
import { scanSensitivity } from "@/lib/sources/dlp";

describe("an address reserved for examples must not let a secret through", () => {
  // The engine applies an allowlist pattern to the text matched by ANY detector.
  // A pattern meant for email addresses therefore also cleared a connection
  // string that happened to end in a reserved domain, and the password reached
  // the model, even in block mode. Found by a review of the change that added it.
  const SECRETS = [
    "postgres://admin:S3cretPass9@db.example.com",
    "mongodb://svc:pw-Zq81xLmP@cluster.test",
    "redis://:Rt55pLw90qs@localhost",
    "smtp://mailer:Xy72kQ19mnb@mail.example.com",
  ];

  for (const secret of SECRETS) {
    it(`still redacts ${secret.split("@")[1]}`, async () => {
      const r = await scanSensitivity(`Connect with ${secret} from the job.`, "ops.md");
      expect(r.text).not.toContain(secret);
      expect(r.text).not.toMatch(/S3cretPass9|pw-Zq81xLmP|Rt55pLw90qs|Xy72kQ19mnb/);
    });
  }

  it("still refuses such a source in block mode", async () => {
    const r = await scanSensitivity(`DB: ${SECRETS[0]}`, "ops.md", "block");
    expect(r.blocked).toBe(true);
  });

  it("still leaves a plain example address alone", async () => {
    const text = "Set user.email to jane@example.com, or admin@example.org, or ops@mail.test.";
    const r = await scanSensitivity(text, "git-howto.md");
    expect(r.text).toBe(text);
  });
});
