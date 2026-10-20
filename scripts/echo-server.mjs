#!/usr/bin/env node
/**
 * Deterministic local echo server for the demo/e2e runs — replaces
 * httpbin.org so CI and local verification have no network dependency.
 *
 *   node scripts/echo-server.mjs [port]   # default 18080
 *
 * GET /get        -> 200 JSON echo
 * GET /status/500 -> 500
 */

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 18080);

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname.startsWith("/status/")) {
    const code = Number(url.pathname.split("/")[2]) || 500;
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: code }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ url: url.pathname, method: req.method }));
}).listen(port, "127.0.0.1", () => {
  console.log(`echo server on http://127.0.0.1:${port}`);
});
