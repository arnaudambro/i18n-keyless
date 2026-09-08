// Exports the precompiled bundle (GET /translate/bundle) into src/i18n-keyless/:
// manifest.json plus one <namespace>/<lang>.json per dictionary. Run it before a release
// and commit the result — the build then needs no network and no key.
//
//   VITE_I18N_KEYLESS_API_KEY=... node scripts/export-bundle.mjs      (the real service)
//   node scripts/export-bundle.mjs                                     (the local mock server)
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const apiKey = process.env.VITE_I18N_KEYLESS_API_KEY || "demo";
const apiUrl = process.env.VITE_I18N_KEYLESS_API_KEY ? "https://api.i18n-keyless.com" : "http://localhost:8787";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n-keyless");

const res = await fetch(`${apiUrl}/translate/bundle`, {
  // Any major >= 3 in the Version header asks for the v3 language codes.
  headers: { Authorization: `Bearer ${apiKey}`, Version: "3" },
});
const body = await res.json();
if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);

await rm(out, { recursive: true, force: true });
const manifest = { ...body.data, namespaces: {} };
for (const [namespace, entry] of Object.entries(body.data.namespaces)) {
  manifest.namespaces[namespace] = { lastRefresh: entry.lastRefresh, languages: Object.keys(entry.translations) };
  await mkdir(join(out, namespace), { recursive: true });
  for (const [lang, translations] of Object.entries(entry.translations)) {
    await writeFile(join(out, namespace, `${lang}.json`), JSON.stringify(translations, null, 2) + "\n");
  }
}
await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`exported ${Object.keys(body.data.namespaces).length} namespace(s) to ${out}`);
