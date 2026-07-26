import type { Config } from "tailwindcss";

/**
 * Tailwind is wired entirely to CSS variables declared in globals.css.
 * No color, size, or spacing literal should ever appear in a component:
 * the token is the single source of truth.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    // Restricted palette. Every value is a token. Color carries meaning
    // (learning state) or action, nothing decorative.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      bg: "var(--bg)",
      "bg-subtle": "var(--bg-subtle)",
      surface: "var(--surface)",
      border: "var(--border)",
      text: "var(--text)",
      "text-muted": "var(--text-muted)",
      accent: "var(--accent)",
      "accent-contrast": "var(--accent-contrast)",
      // The three semantic learning states, the only chromatic vocabulary.
      "state-solid": "var(--state-solid)",
      "state-doubt": "var(--state-doubt)",
      "state-untested": "var(--state-untested)",
      danger: "var(--danger)",
    },
    fontFamily: {
      serif: "var(--font-serif)",
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
    },
    fontSize: {
      "step--1": ["var(--step--1)", { lineHeight: "var(--leading-body)" }],
      "step-0": ["var(--step-0)", { lineHeight: "var(--leading-body)" }],
      "step-1": ["var(--step-1)", { lineHeight: "var(--leading-snug)" }],
      "step-2": ["var(--step-2)", { lineHeight: "var(--leading-heading)" }],
      "step-3": ["var(--step-3)", { lineHeight: "var(--leading-heading)" }],
      "step-4": ["var(--step-4)", { lineHeight: "var(--leading-heading)" }],
      "step-5": ["var(--step-5)", { lineHeight: "var(--leading-heading)" }],
    },
    extend: {
      // 8px grid. Tailwind's default 4px scale already lands on 8px multiples;
      // these are named anchors used by layout primitives.
      spacing: {
        measure: "var(--measure)",
      },
      maxWidth: {
        measure: "var(--measure)",
      },
      transitionDuration: {
        DEFAULT: "120ms",
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
      },
    },
  },
  plugins: [],
};

export default config;
