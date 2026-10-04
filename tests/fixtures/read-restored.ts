// Run as a separate process against a restored database file: opens it the way
// the server does and prints what the app itself can read from it.
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { courses, modules, questions, users } from "@/db/schema";
import { getCourseBundle } from "@/lib/course/query";
import { verifyPassword } from "@/lib/auth/password";

const course = db.select().from(courses).limit(1).get();
const bundle = course ? getCourseBundle(course.id) : null;
const user = db.select().from(users).where(eq(users.email, "restored@test.dev")).get();
console.log(
  JSON.stringify({
    courses: db.select({ n: count() }).from(courses).get()!.n,
    modules: db.select({ n: count() }).from(modules).get()!.n,
    questions: db.select({ n: count() }).from(questions).get()!.n,
    bundleModules: bundle?.modules.length ?? -1,
    loginWorks: user ? await verifyPassword("correct horse battery", user.passwordHash) : null,
  }),
);
