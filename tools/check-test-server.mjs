// The test server seen from outside (ROADMAP Stage 5 item 21a-i; RUNBOOK/test-server.md). Its worst
// thing would be the database, Redis or a secret open to the internet, so this knocks on every door
// a stranger could and fails unless only SSH, the web and https answer, and the api and the console
// answer only over https with their headers.
//
//   node tools/check-test-server.mjs [address] [api name] [web name]
//
// Exit 0 when every check passes. It sends nothing but connections and GETs.
import net from "node:net";

const [address = "13.237.195.91", apiName = "api.getkwazo.com", webName = "getkwazo.com"] = process.argv.slice(2);

const OPEN = [22, 80, 443];
// Postgres, Redis, the api's and live's own ports, and the usual spares a stray container might take.
const SHUT = [5432, 6379, 3000, 3100, 8080, 8443, 9000, 2375, 2376, 5433, 6380, 27017];

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

const plain = await get(`http://${apiName}/health`, { redirect: "manual" });
check("plain http is sent to https", plain.status >= 300 && plain.status < 400 && (plain.headers.get("location") ?? "").startsWith("https://"), `${plain.status} ${plain.headers.get("location") ?? ""}`);

const page = await get(`https://${webName}/`);
const body = await page.text();
check("the console answers over https", page.status === 200 && body.includes("<div id=\"root\">"), String(page.status));
check("the console may not be framed", (page.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'none'"), page.headers.get("content-security-policy") ?? "none");
check("the console keeps to https", (page.headers.get("strict-transport-security") ?? "").includes("max-age="), page.headers.get("strict-transport-security") ?? "none");
check("the console's policy names this api", body.includes(`https://${apiName}`), "");

const deep = await get(`https://${webName}/console`);
check("an address inside the console opens the page", deep.status === 200, String(deep.status));

const embed = await get(`https://${webName}/gyms/some-gym?embed=1`);
check("a gym's page as its embed may be framed", !(embed.headers.get("content-security-policy") ?? "").includes("frame-ancestors"), embed.headers.get("content-security-policy") ?? "none");

// Files a careless deploy leaves readable.
for (const path of ["/api.env", "/.env", "/db.env", "/../infra/api.env", "/.git/config"]) {
  const res = await get(`https://${webName}${path}`);
  const text = await res.text();
  check(`${path} gives away nothing`, !/(SECRET|PASSWORD|API_KEY|DATABASE_URL|\[core\])/.test(text), String(res.status));
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`${r.pass ? "ok  " : "FAIL"}  ${r.name}${r.seen ? `  (${r.seen})` : ""}`);
}
console.log(failed === 0 ? `\nall ${results.length} checks passed` : `\n${failed} of ${results.length} checks FAILED`);
process.exit(failed === 0 ? 0 : 1);
