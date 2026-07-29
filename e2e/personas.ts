/** Shared test personas; registered once in auth.setup.ts. */

export const EXAMINER = {
  email: "examiner@e2e.test",
  name: "E2e Examiner",
  password: "examiner-pass-1",
};

export const STUDENT = {
  email: "student@e2e.test",
  name: "E2e Student",
  password: "student-pass-1",
};

/** A second student, for the multi-student isolation checks. */
export const STUDENT2 = {
  email: "student2@e2e.test",
  name: "E2e Student Two",
  password: "student2-pass-1",
};
