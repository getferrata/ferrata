import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * A narrow lint, on purpose.
 *
 * This repo already has gates that catch most of what a default preset catches,
 * and catch it harder: TypeScript runs strict with no `any`, there are unit
 * tests, an end-to-end journey, a dependency audit and a set of database
 * invariants. Turning everything on here would mostly produce opinions about
 * style, and a check whose output is mostly noise is one people learn to run
 * with their eyes closed.
 *
 * So what is kept is what finds defects the compiler cannot see: a hook whose
 * dependency list lies, a promise nobody waited for, a value stringified into
 * "[object Object]", an invisible character somebody pasted.
 *
 * The history: `pnpm lint` ran `next lint` for months against a repo with no
 * ESLint config and no ESLint dependency, then Next deprecated the command and
 * it started opening an interactive menu instead of failing. It had never
 * checked anything, while its name in package.json said the code was linted.
 */
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "drizzle/**",
      "coverage/**",
      "e2e/.artifacts/**",
      "benchmarks/.artifacts/**",
      "site/**",
      "next-env.d.ts",
    ],
  },

  js.configs.recommended,

  {
    // Plain scripts are not in the TypeScript project, so the type-aware rules
    // have nothing to work from and would only report that they cannot see
    // them. They get the syntax pass, which is what there is to check.
    //
    // The globals are declared rather than pulled from a package: this is the
    // whole list these scripts use, and naming it is shorter than the
    // dependency. The browser half belongs to the audit scripts, which run
    // inside a page through Playwright.
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        fetch: "readonly",
        window: "readonly",
        document: "readonly",
        getComputedStyle: "readonly",
        CSS: "readonly",
      },
    },
  },

  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ["**/*.ts", "**/*.tsx"],
  })),

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // What the compiler cannot see.
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
      "@typescript-eslint/no-floating-promises": "error",
      // Not on JSX attributes. `onClick={async () => …}` is how React is
      // written, the promise is handled by React, and thirty-eight of those
      // would bury the handful of places where a promise really is dropped.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/await-thenable": "error",

      // Off, and this one is a judgement rather than noise-cutting. It reports
      // a guard TypeScript believes cannot fire, and most of those here are on
      // values that crossed a runtime boundary: JSON parsed out of a model's
      // answer, a column read back from SQLite, an environment variable. The
      // type says non-null because somebody wrote it that way, not because the
      // runtime agrees. Following the rule would mean deleting the checks that
      // make a lying type harmless.
      "@typescript-eslint/no-unnecessary-condition": "off",

      // Style, and the compiler's own job. Off: they would bury the rest.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": "off",
      "no-control-regex": "off",
    },
  },

  {
    // Playwright takes its fixtures by destructuring, and a test that wants
    // none of them still has to leave the pattern there to reach the second
    // argument. The rule is right about ordinary code and wrong about this.
    files: ["e2e/**"],
    rules: { "no-empty-pattern": "off" },
  },

  {
    // This suite reloads modules on purpose, to prove a fresh process reads
    // back the same database. That is what require() is for here.
    files: ["tests/durability.test.ts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
