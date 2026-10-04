import { describe, it, expect } from "vitest";
import { isPrivateIp, assertPublicUrl, extractReadableText } from "@/lib/sources/url";

describe("isPrivateIp", () => {
  it("flags private / loopback / link-local / reserved", () => {
    for (const ip of [
      "10.0.0.5", "127.0.0.1", "169.254.169.254", "172.16.0.1",
      "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1",
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe("assertPublicUrl (SSRF guard)", () => {
  it("blocks internal addresses and non-http schemes", async () => {
    for (const u of [
      "http://localhost/x", "http://127.0.0.1/", "http://10.0.0.1/",
      "http://169.254.169.254/latest/meta-data/", "http://[::1]/",
      "ftp://example.com/x", "file:///etc/passwd", "not a url",
    ]) {
      await expect(assertPublicUrl(u)).rejects.toThrow();
    }
  });
  it("allows a public IP literal", async () => {
    const checked = await assertPublicUrl("https://1.1.1.1/page");
    expect(checked.url.hostname).toBe("1.1.1.1");
    // Nothing to pin: the URL already names the address, so there is no second
    // lookup for a hostile resolver to answer differently.
    expect(checked.address).toBeNull();
  });

  it("carries out the address it validated, so the fetch can pin to it", async () => {
    // Validating a hostname and then handing the hostname to fetch resolves it
    // twice: a resolver with a zero TTL can answer public first and internal
    // second. The address checked here is the one connected to.
    const checked = await assertPublicUrl("https://example.com/page");
    expect(checked.url.hostname).toBe("example.com");
    expect(checked.address).toMatch(/^[0-9a-f.:]+$/i);
  });
});

describe("extractReadableText", () => {
  it("keeps content, drops markup / script / style / chrome", () => {
    const html = `<html><head><style>.x{color:red}</style><script>bad()</script></head>
      <body><nav>menu here</nav><main><h1>Edge Gateway</h1>
      <p>A 503 means the pool is empty.</p></main><footer>footer junk</footer></body></html>`;
    const t = extractReadableText(html);
    expect(t).toContain("Edge Gateway");
    expect(t).toContain("503 means the pool is empty");
    expect(t).not.toContain("bad()");
    expect(t).not.toContain("color:red");
    expect(t).not.toContain("menu here");
    expect(t).not.toContain("footer junk");
    expect(t).not.toMatch(/<[a-z]/i);
  });
});

describe("classifyHttpStatus", () => {
  it("401 is auth", async () => {
    const { classifyHttpStatus } = await import("@/lib/sources/url");
    expect(classifyHttpStatus(401, "").kind).toBe("auth");
  });
  it("403 with a challenge page is bot protection", async () => {
    const { classifyHttpStatus } = await import("@/lib/sources/url");
    expect(classifyHttpStatus(403, "Just a moment... Cloudflare").kind).toBe("bot");
  });
  it("bare 403 is treated as auth (credentials may fix it)", async () => {
    const { classifyHttpStatus } = await import("@/lib/sources/url");
    expect(classifyHttpStatus(403, "Forbidden").kind).toBe("auth");
  });
  it("other statuses are plain http failures", async () => {
    const { classifyHttpStatus } = await import("@/lib/sources/url");
    expect(classifyHttpStatus(404, "").kind).toBe("http");
    expect(classifyHttpStatus(500, "").kind).toBe("http");
  });
});

describe("shallow crawl helpers", () => {
  it("crawlPrefix is the seed's directory", async () => {
    const { crawlPrefix } = await import("@/lib/sources/url");
    expect(crawlPrefix(new URL("https://w.example/wiki/ops/edge"))).toBe("/wiki/ops/");
    expect(crawlPrefix(new URL("https://w.example/"))).toBe("/");
  });

  it("extractSameSiteLinks scopes to host + prefix and skips assets", async () => {
    const { extractSameSiteLinks } = await import("@/lib/sources/url");
    const base = new URL("https://w.example/wiki/index.html");
    const html = `
      <a href="/wiki/gateway.html">g</a>
      <a href='failover.html'>f</a>
      <a href="/wiki/logo.png">img</a>
      <a href="/other/place.html">out of prefix</a>
      <a href="https://elsewhere.example/wiki/x.html">other host</a>
      <a href="#frag">frag</a>
      <a href="mailto:x@y.z">mail</a>
      <a href="/wiki/gateway.html#section">dupe with hash</a>`;
    const links = extractSameSiteLinks(html, base, "/wiki/");
    expect(links).toContain("https://w.example/wiki/gateway.html");
    expect(links).toContain("https://w.example/wiki/failover.html");
    expect(links).toHaveLength(2);
  });

  it("parseRobots collects Disallow for * and for our bot", async () => {
    const { parseRobots } = await import("@/lib/sources/url");
    const txt = [
      "User-agent: googlebot",
      "Disallow: /only-google/",
      "User-agent: *",
      "Disallow: /wiki/hidden/",
      "Disallow: /tmp/",
      "# comment",
    ].join("\n");
    expect(parseRobots(txt)).toEqual(["/wiki/hidden/", "/tmp/"]);
  });
});

describe("web credentials host matching", () => {
  it("normalizes hosts from urls and bare names", async () => {
    const { normalizeHost } = await import("@/lib/sources/credentials");
    expect(normalizeHost("https://wiki.acme.com/spaces/X")).toBe("wiki.acme.com");
    expect(normalizeHost("Wiki.Acme.com")).toBe("wiki.acme.com");
  });
  it("matches exact host and subdomains only", async () => {
    const { hostMatches } = await import("@/lib/sources/credentials");
    expect(hostMatches("acme.com", "acme.com")).toBe(true);
    expect(hostMatches("acme.com", "wiki.acme.com")).toBe(true);
    expect(hostMatches("acme.com", "notacme.com")).toBe(false);
  });
});

describe("the SSRF guard sees through IPv6 spellings of private IPv4 addresses", () => {
  // Node writes http://[::ffff:127.0.0.1]/ as [::ffff:7f00:1]. The guard used to
  // strip "::ffff:" and test what was left ("7f00:1") as if it were an IPv4
  // address, found nothing wrong with it, and let loopback, the cloud metadata
  // address and the whole private range through. Every case below was ALLOWED.
  const MUST_BLOCK = [
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:192.168.1.1]/",
    "http://[::ffff:172.16.0.1]/",
    "http://[::127.0.0.1]/",
    "http://[::ffff:0:127.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://[2002:7f00:1::]/",
    "http://[2002:a9fe:a9fe::1]/",
    "http://[fec0::1]/",
    "http://[ff02::1]/",
    "http://[::]/",
    "http://[0:0:0:0:0:0:0:1]/",
    "http://[fe80::1%25eth0]/",
    "http://198.18.0.1/",
    "http://192.0.0.1/",
  ];
  for (const u of MUST_BLOCK) {
    it(`blocks ${u}`, async () => {
      await expect(assertPublicUrl(u)).rejects.toThrow();
    });
  }

  it("still allows public addresses written the same ways", async () => {
    for (const u of [
      "http://[::ffff:8.8.8.8]/",
      "http://[64:ff9b::808:808]/",
      "http://[2002:808:808::1]/",
      "http://[2606:4700:4700::1111]/",
      "http://[2001:4860:4860::8888]/",
    ]) {
      await expect(assertPublicUrl(u)).resolves.toBeDefined();
    }
  });
});
