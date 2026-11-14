// Runs the REAL web server settings (`infra/Caddyfile.selfhost`, its web block, unchanged) in the same Caddy image
// the server uses, over a built site, on this laptop, and asks it what every kind of address answers. Made for
// ROADMAP Stage 4 item 12a (the front page at the site's own address, the console everywhere else), and for a
// reviewer to run the same way. Docker Desktop must be running.
//
//   node tools/check-web-locally.mjs <built site folder> [port]
//
// The built site: `VITE_API_URL=https://api.getkwazo.com VITE_AUTH_API_URL= VITE_ML_API_URL= VITE_WS_URL=
// VITE_TRACE_RECORD= corepack pnpm --filter web exec vite build --outDir <folder> --emptyOutDir` (RUNBOOK/test-server.md).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const [site, portArg = "8088"] = process.argv.slice(2);
if (!site || !existsSync(path.join(site, "index.html")) || !existsSync(path.join(site, "home.html"))) {
  console.error("usage: node tools/check-web-locally.mjs <built site folder holding index.html and home.html> [port]");
  process.exit(2);
}
const port = Number(portArg);
const caddyfile = readFileSync(new URL("../infra/Caddyfile.selfhost", import.meta.url), "utf8");
const block = caddyfile.slice(caddyfile.indexOf("{$WEB_DOMAIN} {"));
const composeImage = readFileSync(new URL("../infra/docker-compose.yml", import.meta.url), "utf8").match(/image:\s*(caddy:\S+)/)?.[1] ?? "caddy:2-alpine";
const dir = mkdtempSync(path.join(os.tmpdir(), "kwazo-web-"));
writeFileSync(path.join(dir, "Caddyfile"), block);
const name = `kwazo-web-check-${String(process.pid)}`;
const run = spawnSync("docker", ["run", "--rm", "-d", "--name", name, "-p", `127.0.0.1:${String(port)}:8080`, "-e", "WEB_DOMAIN=:8080",
  "-v", `${path.join(dir, "Caddyfile")}:/etc/caddy/Caddyfile:ro`, "-v", `${path.resolve(site)}:/srv/web:ro`, composeImage], { encoding: "utf8" });
if (run.status !== 0) { console.error(run.stderr); process.exit(1); }

const base = `http://127.0.0.1:${String(port)}`;
const results = [];
const check = (what, pass, seen = "") => results.push({ what, pass, seen });
const get = async (p, init) => {
  for (let i = 0; i < 40; i++) {
    try { return await fetch(base + p, { redirect: "manual", ...init }); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`no answer from ${base}${p}`);
};
const policyIn = (html) => (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "").replaceAll("&#39;", "'");
const CONSOLE = "<div id=\"root\"></div>";

try {
  // The front page: the site's own address alone (a query string does not change the address, and Caddy reads `//` as `/`).
  for (const p of ["/", "/?utm_source=google", "//"]) {
    const r = await get(p); const html = await r.text();
    check(`${p} is the front page`, r.status === 200 && html.includes("<title>KWAZO | Gym Management Software") && !html.includes(CONSOLE), String(r.status));
    check(`${p} runs only its own script`, /(?:^|; )script-src 'self'(?:;|$)/.test(policyIn(html)) && !policyIn(html).includes("unsafe"), policyIn(html));
    check(`${p} may not be framed`, (r.headers.get("content-security-policy") ?? "") === "frame-ancestors 'none'", r.headers.get("content-security-policy") ?? "none");
    check(`${p} keeps to https, sniffs nothing, and is read again on every visit`, (r.headers.get("strict-transport-security") ?? "").includes("max-age=31536000") && r.headers.get("x-content-type-options") === "nosniff" && r.headers.get("cache-control") === "no-cache", `${r.headers.get("strict-transport-security")} ${r.headers.get("x-content-type-options")} ${r.headers.get("cache-control")}`);
  }
  const head = await get("/", { method: "HEAD" });
  check("HEAD / answers", head.status === 200, String(head.status));

  // The console: every other address, sign-in first, with the console's own policy.
  for (const p of ["/login", "/console", "/console/members", "/index.html", "/privacy", "/terms", "/washington-health-data", "/delete-account", "/gyms/some-gym", "/no/such/page", "/home", "/home/"]) {
    const r = await get(p); const html = await r.text();
    check(`${p} is the console`, r.status === 200 && html.includes(CONSOLE) && policyIn(html).includes("https://api.getkwazo.com"), String(r.status));
    check(`${p} may not be framed`, (r.headers.get("content-security-policy") ?? "") === "frame-ancestors 'none'", r.headers.get("content-security-policy") ?? "none");
  }
  const embed = await get("/gyms/some-gym?embed=1");
  check("a gym's page as its embed may be framed (unchanged)", embed.status === 200 && embed.headers.get("content-security-policy") === null, embed.headers.get("content-security-policy") ?? "none");

  // Google's two files, and the share picture.
  const robots = await get("/robots.txt"); const robotsText = await robots.text();
  check("/robots.txt is the file, not a page", robots.status === 200 && (robots.headers.get("content-type") ?? "").startsWith("text/plain") && robotsText.includes("Sitemap: https://getkwazo.com/sitemap.xml"), `${robots.status} ${robots.headers.get("content-type")}`);
  const map = await get("/sitemap.xml");
  check("/sitemap.xml is the file", map.status === 200 && (map.headers.get("content-type") ?? "").includes("xml") && (await map.text()).includes("<loc>https://getkwazo.com/</loc>"), `${map.status} ${map.headers.get("content-type")}`);
  for (const p of ["/og-image.jpg", "/favicon.svg", "/favicon-48.png", "/apple-touch-icon.png"]) {
    const r = await get(p); check(`${p} is served`, r.status === 200 && !(await r.text()).includes(CONSOLE), `${r.status} ${r.headers.get("content-type")}`);
  }

  // The front page's own files: kept for good (their names change with their content), clips streamable.
  const assets = readdirSync(path.join(site, "assets"));
  const css = assets.find((f) => /^home-.*\.css$/.test(f)); const clip = assets.find((f) => /^w1-clip-.*\.mp4$/.test(f));
  const cssAnswer = await get(`/assets/${css}`);
  check("the front page's stylesheet is kept for good", cssAnswer.status === 200 && cssAnswer.headers.get("cache-control") === "public, max-age=31536000, immutable", cssAnswer.headers.get("cache-control") ?? "none");
  const part = await get(`/assets/${clip}`, { headers: { Range: "bytes=0-99" } });
  check("a clip can be read in parts (Safari needs it)", part.status === 206 && (part.headers.get("content-range") ?? "").startsWith("bytes 0-99/") && part.headers.get("content-type") === "video/mp4", `${part.status} ${part.headers.get("content-range")} ${part.headers.get("content-type")}`);
  check("a clip is not compressed again", part.headers.get("content-encoding") === null, part.headers.get("content-encoding") ?? "none");

  // Nothing of the server's own can be read through the new address.
  for (const p of ["/home.html/../Caddyfile", "/%2e%2e/etc/caddy/Caddyfile", "/../etc/passwd"]) {
    const r = await get(p); const text = await r.text();
    check(`${p} reads nothing of the server's`, !text.includes("WEB_DOMAIN") && !text.includes("root:x:"), String(r.status));
  }
} finally {
  spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
}

for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.what}${r.pass ? "" : `  (seen: ${r.seen})`}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${String(results.length - failed)} of ${String(results.length)} passed`);
process.exit(failed === 0 ? 0 : 1);
