// The test server seen from outside, and from inside (ROADMAP Stage 5 item 21a-i; RUNBOOK/test-server.md).
// Its worst thing would be the database, Redis or a secret open to the internet, so this knocks on every
// door a stranger could, and fails unless only SSH, the web and https answer, the api and the console
// answer only over https with their headers, and no secret file is served. AWS's security group stands in
// front of the machine, so a door the machine itself opens by mistake reads shut from outside: the
// inside part signs in over SSH and reads what the machine listens on.
//
//   node tools/check-test-server.mjs [address] [api name] [web name]
//   node tools/check-test-server.mjs --inside      (also signs in with ~/.ssh/kwazo_oracle, read only)
//
// Exit 0 when every check passes. It sends nothing but connections and GETs, and `ss` inside.
import { execFileSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

const args = process.argv.slice(2);
const inside = args.includes("--inside");
const [address = "13.237.195.91", apiName = "api.getkwazo.com", webName = "getkwazo.com"] = args.filter((a) => !a.startsWith("--"));

const OPEN = [22, 80, 443];
// Postgres, Redis, the api's and live's own ports, and the usual spares a stray container might take.
const SHUT = [5432, 6379, 3000, 3100, 8080, 8443, 9000, 2375, 2376, 5433, 6380, 27017];
// What the machine itself may listen on: SSH and Caddy on every address, and anything on its own
// loopback, which nothing outside the machine reaches (Postgres for the tunnel, the name service, Docker's).
const MAY_LISTEN = /^(0\.0\.0\.0|\[::\]|\*):(22|80|443)$|^127\.\d+\.\d+\.\d+(%lo)?:\d+$|^\[::1\]:\d+$/;
// What a secret file of this server holds, by name: api.env, db.env and .env.
const SECRET_WORDS = /SECRET|PASSWORD|API_KEY|DATABASE_URL|REDIS_URL|POSTGRES_|API_DOMAIN|ACME_EMAIL|\[core\]/;

function knock(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: address, port, timeout: 4000 });
    const end = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => end(true));
    socket.once("timeout", () => end(false));
    socket.once("error", () => end(false));
  });
}

/** A request sent exactly as written: `fetch` tidies `/../` away before it leaves. */
function rawGet(host, target) {
  return new Promise((resolve) => {
    let text = "";
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (chunk) => (text += chunk.toString("utf8")));
    socket.on("end", () => resolve(text));
    socket.on("timeout", () => (socket.destroy(), resolve(text)));
    socket.on("error", () => resolve(text));
  });
}

const results = [];
// A refused or silent connection is an answer too: a status of 599.
const get = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }).catch(() => new Response(null, { status: 599 }));
const check = (name, pass, seen) => results.push({ name, pass, seen });

for (const port of OPEN) check(`port ${port} answers`, await knock(port), "");
for (const port of SHUT) {
  const open = await knock(port);
  check(`port ${port} is shut`, !open, open ? "OPEN" : "shut");
}

const health = await get(`https://${apiName}/health`);
check("the api answers over https", health.status === 200, String(health.status));
check("the api keeps to https", (health.headers.get("strict-transport-security") ?? "").includes("max-age="), health.headers.get("strict-transport-security") ?? "none");

const plain = await get(`http://${apiName}/health`, { redirect: "manual" });
check("plain http is sent to https", plain.status >= 300 && plain.status < 400 && (plain.headers.get("location") ?? "").startsWith("https://"), `${plain.status} ${plain.headers.get("location") ?? ""}`);

const page = await get(`https://${webName}/`);
const body = await page.text();
check("the console answers over https", page.status === 200 && body.includes("<div id=\"root\">"), String(page.status));
check("the console may not be framed", (page.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), page.headers.get("content-security-policy") ?? "none");
check("the console keeps to https", (page.headers.get("strict-transport-security") ?? "").includes("max-age="), page.headers.get("strict-transport-security") ?? "none");
check("the console's policy names this api", body.includes(`https://${apiName}`), "");

// A console built with the laptop's apps/web/.env calls the laptop (localhost:8000), and Chrome then asks
// every visitor to let the site "access other apps and services on this device" (21a-ii, seen by Kd).
// `http://localhost` alone is the router's own placeholder for a URL with no origin, never fetched.
const scripts = [...body.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1] ?? "");
const laptopAddresses = [];
for (const src of scripts) {
  const text = await (await get(new URL(src, `https://${webName}/`).href)).text();
  for (const m of text.matchAll(/(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1):\d+[^"'`\s]*/g)) laptopAddresses.push(m[0]);
}
const policyLaptop = body.match(/(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1):\d+/g) ?? [];
check("the console never calls this laptop", scripts.length > 0 && laptopAddresses.length === 0 && policyLaptop.length === 0, [...new Set([...laptopAddresses, ...policyLaptop])].join(" ") || `${scripts.length} scripts read`);

const deep = await get(`https://${webName}/console`);
check("an address inside the console opens the page", deep.status === 200, String(deep.status));

const embed = await get(`https://${webName}/gyms/some-gym?embed=1`);
check("a gym's page as its embed may be framed", embed.status === 200 && !(embed.headers.get("content-security-policy") ?? "").includes("frame-ancestors"), `${embed.status} ${embed.headers.get("content-security-policy") ?? "none"}`);

// Files a careless deploy leaves readable. The console answers every unknown address with its own page,
// so anything else coming back, or a secret's name, is a leak.
const console_ = body;
for (const target of ["/api.env", "/.env", "/db.env", "/infra/api.env", "/.git/config", "/../infra/api.env", "/%2e%2e/infra/api.env", "/..%2finfra/api.env"]) {
  const answer = await rawGet(webName, target);
  const [head = "", ...rest] = answer.split("\r\n\r\n");
  const status = Number(head.split(" ")[1] ?? 0);
  const content = rest.join("\r\n\r\n");
  const leak = SECRET_WORDS.test(content) || (status === 200 && !content.includes("<div id=\"root\">"));
  check(`${target} gives away nothing`, status !== 0 && !leak, status === 200 && content.includes("<div id=\"root\">") && console_.length > 0 ? "200, the console's page" : String(status));
}

if (inside) {
  const key = path.join(os.homedir(), ".ssh", "kwazo_oracle");
  let listening = "";
  try {
    listening = execFileSync("ssh", ["-i", key, "-o", "BatchMode=yes", `ubuntu@${address}`, "sudo ss -ltnH"], { encoding: "utf8", timeout: 30_000 });
  } catch (error) {
    check("the machine can be read over SSH", false, error instanceof Error ? error.message.split("\n")[0] : "failed");
  }
  if (listening !== "") {
    const locals = listening.trim().split("\n").map((line) => line.trim().split(/\s+/)[3] ?? "");
    const stray = locals.filter((local) => !MAY_LISTEN.test(local));
    check("the machine listens only on SSH, the web, https and its own loopback", stray.length === 0, stray.length === 0 ? `${locals.length} listeners` : stray.join(" "));
  }
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`${r.pass ? "ok  " : "FAIL"}  ${r.name}${r.seen ? `  (${r.seen})` : ""}`);
}
console.log(failed === 0 ? `\nall ${results.length} checks passed` : `\n${failed} of ${results.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
