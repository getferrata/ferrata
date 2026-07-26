import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it out of the server bundle so the
  // .node binary is required at runtime instead of being traced/bundled.
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "mammoth"],
  // The in-process job worker is booted from src/instrumentation.ts.
};

export default nextConfig;
