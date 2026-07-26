import type { MetadataRoute } from "next";

/** Only the public landing (and auth) is crawlable; the app stays out of the index. */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/crea", "/courses", "/examiner", "/import"],
    },
    sitemap: base ? `${base}/sitemap.xml` : undefined,
  };
}
