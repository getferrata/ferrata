import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module; keep it out of the server bundle so the
  // .node binary is required at runtime instead of being traced/bundled.
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "mammoth"],
  // The in-process job worker is booted from src/instrumentation.ts.
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
};

export default nextConfig;
