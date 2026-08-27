// Static server for the browser example, zero dependencies (node:http).
//
// A module script cannot load from file://, and the page needs two folders of this repo:
// examples/browser (the page) and packages/browser/dist (the built SDK). So the server
// serves the repo root and opens on /examples/browser/.
//
// Run:  node serve.mjs            (defaults to http://localhost:5173/examples/browser/)
//       PORT=3000 node serve.mjs

import http from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize, extname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const PORT = Number(process.env.PORT) || 5173;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", `http://${req.headers.host}`);
  let path = normalize(join(root, decodeURIComponent(pathname)));
  if (!path.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(path) && statSync(path).isDirectory()) {
    path = join(path, "index.html");
  }
  if (!existsSync(path)) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end(`not found: ${pathname}`);
    return;
  }
  res.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream" });
  createReadStream(path).pipe(res);
});

server.listen(PORT, () => {
  if (!existsSync(join(root, "packages/browser/dist/auto.js"))) {
    console.warn("packages/browser/dist/auto.js is missing: build it first (see README.md)");
  }
  console.log(`browser example on http://localhost:${PORT}/examples/browser/`);
});
