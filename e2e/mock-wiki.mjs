/**
 * A small but real wiki for e2e: multiple linked pages, a robots.txt with a
 * disallowed section, and a token-protected area that answers 401 without
 * credentials, like a company wiki behind sign-in.
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_WIKI_PORT ?? 4646);
const TOKEN = "wiki-secret-token";

const para = (s) => `<p>${s} ${"This paragraph carries enough real operational text to pass the readable-content threshold of the importer. ".repeat(3)}</p>`;

const PAGES = {
  "/wiki/index.html": `<html><head><title>Acme Wiki</title></head><body>
    <h1>Acme platform wiki</h1>
    ${para("Start here: the edge gateway is the single front door of the platform.")}
    <ul>
      <li><a href="/wiki/gateway.html">Edge gateway</a></li>
      <li><a href="failover.html">Failover</a></li>
      <li><a href="/wiki/hidden/internal.html">Internal drafts</a></li>
      <li><a href="/wiki/logo.png">Logo</a></li>
      <li><a href="https://elsewhere.example/off-site.html">Partner docs</a></li>
    </ul></body></html>`,
  "/wiki/gateway.html": `<html><head><title>Edge gateway</title></head><body>
    <h1>Edge gateway</h1>
    ${para("The gateway terminates TLS and routes by path prefix to api, auth and objproxy.")}
    ${para("A 503 at the edge means the upstream pool is empty, not that the gateway broke.")}
    </body></html>`,
  "/wiki/failover.html": `<html><head><title>Failover</title></head><body>
    <h1>Failover</h1>
    ${para("Two gateways share a virtual address; VRRP moves it in about three seconds.")}
    </body></html>`,
  "/wiki/hidden/internal.html": `<html><body><h1>Drafts</h1>${para("Robots-disallowed drafts that a polite crawler must never ingest.")}</body></html>`,
  "/private/handbook.html": `<html><head><title>Handbook</title></head><body>
    <h1>On-call handbook</h1>
    ${para("The protected handbook: escalation ladder, paging policy, and the deploy freeze calendar.")}
    </body></html>`,
};

const server = http.createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];

  if (path === "/robots.txt") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("User-agent: *\nDisallow: /wiki/hidden/\n");
    return;
  }
  if (path.startsWith("/private/")) {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) {
      res.writeHead(401, { "content-type": "text/html" });
      res.end("<html><body>Sign in required.</body></html>");
      return;
    }
  }
  const page = PAGES[path];
  if (!page) {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<html><body>Not found.</body></html>");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-wiki] listening on 127.0.0.1:${PORT}`);
});
