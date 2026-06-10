// Mock i18n-keyless backend for the example apps.
//
// Implements the subset of the i18n-keyless HTTP protocol the SDKs use, serving the
// canned translations in fixtures.json so every example runs offline — no API key, no
// network. In a real app you point `API_URL` at https://api.i18n-keyless.com (with your
// API_KEY) instead, and the service produces translations with AI.
//
// Run:  node server.mjs            (defaults to http://localhost:8787)
//       PORT=9000 node server.mjs
//
// Zero dependencies (node:http) — nothing to install.

import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, "fixtures.json"), "utf8"));
const PRIMARY = "fr";
const PORT = Number(process.env.PORT) || 8787;

const json = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    // CORS so browser SPAs (Vite/RN web) can call this from another origin.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "*",
  });
  res.end(JSON.stringify(body));
};

const langMap = (lang) => (lang === PRIMARY ? {} : fixtures[lang] ?? {});
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method ?? "GET";

  if (method === "OPTIONS") return json(res, 204, {});

  // POST /translate/last-used-translations — usage analytics sink (no-op).
  if (method === "POST" && pathname === "/translate/last-used-translations") {
    return json(res, 200, { ok: true, message: "" });
  }

  // POST /translate — "translate this key". The mock just returns the canned value per
  // language for the (already-known) key, mirroring the real service's response shape.
  if (method === "POST" && pathname === "/translate") {
    const body = await readBody(req);
    const storageKey = body.context ? `${body.key}__${body.context}` : body.key;
    const translation = {};
    for (const lang of Object.keys(fixtures).filter((l) => l !== "_comment")) {
      translation[lang] = lang === PRIMARY ? body.key : fixtures[lang]?.[storageKey] ?? body.key;
    }
    return json(res, 200, { ok: true, data: { translation }, error: "", message: "" });
  }

  // GET /translate/ — ALL languages at once (used by i18n-keyless-node).
  if (method === "GET" && (pathname === "/translate" || pathname === "/translate/")) {
    const translations = {};
    for (const lang of Object.keys(fixtures).filter((l) => l !== "_comment")) {
      translations[lang] = langMap(lang);
    }
    return json(res, 200, {
      ok: true,
      data: { translations, uniqueId: "demo-user", lastRefresh: new Date().toISOString() },
      error: "",
      message: "",
    });
  }

  // GET /translate/:lang — one language (used by i18n-keyless-react).
  const single = pathname.match(/^\/translate\/([a-z]{2,3})$/);
  if (method === "GET" && single) {
    const lang = single[1];
    return json(res, 200, {
      ok: true,
      data: { translations: langMap(lang), uniqueId: "demo-user", lastRefresh: new Date().toISOString() },
      error: "",
      message: "",
    });
  }

  json(res, 404, { ok: false, error: "not found", message: "" });
});

server.listen(PORT, () => {
  console.log(`i18n-keyless mock backend on http://localhost:${PORT}`);
  console.log(`primary=${PRIMARY}  languages=${Object.keys(fixtures).filter((l) => l !== "_comment").join(", ")}`);
});
