// ROADMAP Stage 5 33b-iii-a — filling the lists and the nightly update, on real Postgres in a schema of
// its own: this file empties and refills its tables, and a machine's loaded list must not notice.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { PackagedFileRefused, updatePackagedFoods, type PackagedSyncDeps } from "../src/modules/nutrition/packagedSync.js";
import { packagedRowsFor } from "../src/modules/nutrition/packagedRepo.js";
import { offRowsOfFile, usdaRowsOfDir } from "../tools/packaged-files.js";
import { fillPackagedList, PackagedListRefused, recordFullLoad } from "../tools/packaged-table.js";

const url = process.env["DATABASE_URL"];
const d = describe.skipIf(url === undefined || url === "");
const FIXTURES = join(import.meta.dirname, "fixtures", "packaged");
const DAILY = readFileSync(join(FIXTURES, "off-daily.jsonl"));
const SCHEMA = `packaged_test_${String(process.pid)}`;
const NEWLINE = String.fromCharCode(10);

/** A valid 13-digit code for the update's own test rows, in this schema alone. */
const codeOf = (n: number): string => {
  const body = `590${String(n).padStart(9, "0")}`;
  let sum = 0;
  for (const [at, digit] of Array.from(body).reverse().entries()) sum += Number(digit) * (at % 2 === 0 ? 3 : 1);
  return `${body}${String((10 - (sum % 10)) % 10)}`;
};
const dailyName = (from: number, to: number): string => `openfoodfacts_products_${String(from)}_${String(to)}.json.gz`;

/** Their server, from a table of paths: what each path answers, and which were asked. */
function fakeFetch(files: Record<string, Buffer | string | number>): { fetch: typeof fetch; asked: string[]; agents: string[] } {
  const asked: string[] = [];
  const agents: string[] = [];
  const fake = ((input: URL | string, init?: RequestInit) => {
    const path = input.toString().split("/").pop() ?? "";
    asked.push(path);
    agents.push(new Headers(init?.headers).get("user-agent") ?? "");
    const answer = files[path];
    if (answer === undefined) return Promise.resolve(new Response("no", { status: 404 }));
    if (typeof answer === "number") return Promise.resolve(new Response("no", { status: answer }));
    return Promise.resolve(new Response(answer));
  }) as typeof fetch;
  return { fetch: fake, asked, agents };
}

d("filling the lists and the nightly update (real Postgres)", () => {
  const owner = postgres(url ?? "", { prepare: false, max: 1 });
  const sql = postgres(url ?? "", { prepare: false, max: 3, connection: { search_path: SCHEMA } });
  const warned: object[] = [];
  const deps = (over: Partial<PackagedSyncDeps>): PackagedSyncDeps => ({
    sql,
    fetch: fakeFetch({}).fetch,
    userAgent: "AIHomeGym/1.0 (test)",
    now: () => new Date(1793500000 * 1000),
    log: { info: () => undefined, warn: (data) => { warned.push(data); } },
    ...over,
  });
  const count = async (table: "off_products" | "usda_branded_products"): Promise<number> => {
    const rows = await sql<{ n: string }[]>`SELECT count(*) AS n FROM ${sql(table)}`;
    return Number(rows[0]?.n ?? 0);
  };
  const load = async () => await fillPackagedList(sql, "off_products", offRowsOfFile(join(FIXTURES, "off-products.tsv")));

  beforeAll(async () => {
    await owner.unsafe(`CREATE SCHEMA "${SCHEMA}"`);
    for (const table of ["off_products", "usda_branded_products", "off_daily_files"]) {
      await owner.unsafe(`CREATE TABLE "${SCHEMA}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    }
  }, 60_000);
  beforeEach(async () => {
    warned.length = 0;
    await sql`TRUNCATE off_products, usda_branded_products, off_daily_files`;
  }, 60_000);
  afterAll(async () => {
    await sql.end({ timeout: 5 });
    await owner.unsafe(`DROP SCHEMA "${SCHEMA}" CASCADE`);
    await owner.end({ timeout: 5 });
  }, 60_000);

  describe("the full import", () => {
    it("loads the real file, a NUL byte and all, and the row reads back whole", async () => {
      const report = await load();
      expect(report.read).toBe(27);
      expect(report.kept).toBe(await count("off_products"));
      expect(report.refused.store_only).toBe(5);
      expect(report.refused.bad_code).toBe(1);
      const { off } = await packagedRowsFor(sql, "7622210449283");
      expect(off).toMatchObject({ kcal: 467, servingSize: "20g", allergens: ["eggs", "gluten", "milk", "soybeans"], traces: ["eggs"], numbersFit: true });
      expect(off?.name.startsWith("Prince")).toBe(true);
      expect((await packagedRowsFor(sql, "8412600017975")).off).toMatchObject({ kcal: 524, allergens: [] });
    });

    it("a second run writes nothing: a real server's history stays small", async () => {
      await load();
      const again = await load();
      expect(again.written).toBe(0);
      expect(again.removed).toBe(0);
    });

    it("a product the file no longer holds is removed, a changed one is written", async () => {
      await load();
      await sql`UPDATE off_products SET kcal = 1 WHERE code = '3017620422003'`;
      await sql`INSERT INTO off_products SELECT * FROM jsonb_populate_recordset(NULL::off_products, ${JSON.stringify([{ code: "5901234123457", name: "Gone", kcal: 1, numbers_fit: true, allergens: [], traces: [], listed_as_typed: [] }])}::text::jsonb)`;
      const report = await load();
      expect(report.written).toBe(1);
      expect(report.removed).toBe(1);
      expect((await packagedRowsFor(sql, "3017620422003")).off?.kcal).toBe(539);
    });

    it("a file far smaller than the list is a bad file: nothing changes", async () => {
      await load();
      const before = await count("off_products");
      async function* few() {
        yield* (async function* () {
          for await (const row of offRowsOfFile(join(FIXTURES, "off-products.tsv"))) {
            if ("row" in row && row.row.code === "3017620422003") yield row;
          }
        })();
      }
      await expect(fillPackagedList(sql, "off_products", few())).rejects.toBeInstanceOf(PackagedListRefused);
      expect(await count("off_products")).toBe(before);
    });

    it("a file whose columns have changed is refused before a row is written", async () => {
      const report = fillPackagedList(sql, "off_products", offRowsOfFile(join(FIXTURES, "usda-food.csv")));
      await expect(report).rejects.toThrow(/has changed/);
      expect(await count("off_products")).toBe(0);
    });

    it("loads the JSONL export through the daily file's own reader, its estimates never read as a label", async () => {
      await fillPackagedList(sql, "off_products", offRowsOfFile(join(FIXTURES, "off-daily.jsonl")));
      expect((await packagedRowsFor(sql, "8718452980437")).off).toMatchObject({ kcal: 113 });
      expect((await packagedRowsFor(sql, "0194346516261")).off).toBeNull();
    });

    it("fills USDA's list from its three real files", async () => {
      const report = await fillPackagedList(sql, "usda_branded_products", usdaRowsOfDir(FIXTURES));
      expect(report.kept).toBeGreaterThanOrEqual(5);
      expect((await packagedRowsFor(sql, "0051000198808")).usda).toMatchObject({ servingSize: "1 CUP (240 mL)", numbersFit: true });
    });
  });

  describe("the nightly update", () => {
    const A = dailyName(1793000000, 1793086400);
    const B = dailyName(1793086400, 1793172800);
    const index = `${B}${NEWLINE}${A}${NEWLINE}`;

    it("does nothing and asks nobody while the list has never been loaded", async () => {
      const server = fakeFetch({ "index.txt": index });
      expect(await updatePackagedFoods(deps({ fetch: server.fetch }))).toMatchObject({ outcome: "not_loaded", files: 0 });
      expect(server.asked).toEqual([]);
    });

    it("applies the real file, oldest first, says who it is, and takes off what lost its numbers", async () => {
      await load();
      await sql`INSERT INTO off_products SELECT * FROM jsonb_populate_recordset(NULL::off_products, ${JSON.stringify([{ code: "0194346516261", name: "Had numbers", kcal: 76, numbers_fit: true, allergens: [], traces: [], listed_as_typed: [] }])}::text::jsonb)`;
      const server = fakeFetch({ "index.txt": index, [A]: gzipSync(DAILY), [B]: gzipSync(Buffer.alloc(0)) });
      const report = await updatePackagedFoods(deps({ fetch: server.fetch }));
      expect(report).toMatchObject({ outcome: "updated", files: 2 });
      expect(server.asked).toEqual(["index.txt", A, B]);
      expect(server.agents[0]).toBe("AIHomeGym/1.0 (test)");
      expect((await packagedRowsFor(sql, "8718452980437")).off).toMatchObject({ kcal: 113 });
      expect((await packagedRowsFor(sql, "0194346516261")).off).toBeNull();
    });

    it("run twice, or by two at once, a file is applied once", async () => {
      await load();
      const server = fakeFetch({ "index.txt": index, [A]: gzipSync(DAILY), [B]: gzipSync(DAILY) });
      const both = await Promise.all([updatePackagedFoods(deps({ fetch: server.fetch })), updatePackagedFoods(deps({ fetch: server.fetch }))]);
      const applied = both.reduce((sum, r) => sum + r.files, 0);
      expect(applied).toBe(2);
      const rows = await sql<{ name: string }[]>`SELECT name FROM off_daily_files WHERE name LIKE 'openfoodfacts%'`;
      expect(rows).toHaveLength(2);
      const third = fakeFetch({ "index.txt": index });
      expect(await updatePackagedFoods(deps({ fetch: third.fetch }))).toMatchObject({ outcome: "up_to_date", files: 0 });
      expect(third.asked).toEqual(["index.txt"]);
    });

    it("a file of nothing usable changes nothing: yesterday's rows stay", async () => {
      await load();
      const before = await count("off_products");
      const junk = Array.from({ length: 300 }, (_, at) => JSON.stringify({ code: `59012341234${String(at % 10)}7`, product_name: "No numbers" })).join(NEWLINE);
      const server = fakeFetch({ "index.txt": A, [A]: gzipSync(Buffer.from(junk)) });
      await expect(updatePackagedFoods(deps({ fetch: server.fetch }))).rejects.toBeInstanceOf(PackagedFileRefused);
      expect(await count("off_products")).toBe(before);
      expect(await sql`SELECT 1 FROM off_daily_files WHERE name = ${A}`).toHaveLength(0);
    });

    it("a file that is not their shape, or broken packing, changes nothing", async () => {
      await load();
      const before = await count("off_products");
      const notJson = Array.from({ length: 300 }, () => "<html>maintenance</html>").join(NEWLINE);
      await expect(updatePackagedFoods(deps({ fetch: fakeFetch({ "index.txt": A, [A]: gzipSync(Buffer.from(notJson)) }).fetch }))).rejects.toBeInstanceOf(PackagedFileRefused);
      await expect(updatePackagedFoods(deps({ fetch: fakeFetch({ "index.txt": A, [A]: Buffer.from("not gzip") }).fetch }))).rejects.toThrow();
      await expect(updatePackagedFoods(deps({ fetch: fakeFetch({ "index.txt": A, [A]: 503 }).fetch }))).rejects.toBeInstanceOf(PackagedFileRefused);
      await expect(updatePackagedFoods(deps({ fetch: fakeFetch({ "index.txt": 503 }).fetch }))).rejects.toBeInstanceOf(PackagedFileRefused);
      await expect(updatePackagedFoods(deps({ fetch: fakeFetch({ "index.txt": "<html>nothing here</html>" }).fetch }))).rejects.toBeInstanceOf(PackagedFileRefused);
      expect(await count("off_products")).toBe(before);
    });

    it("a list of 100,000 is never emptied by one file: the file is refused and nothing changes", async () => {
      await load();
      await sql`INSERT INTO off_products (code, name, kcal, numbers_fit, allergens, traces, listed_as_typed)
        SELECT '7' || lpad(n::text, 12, '0'), 'Held', 100, true, '{}', '{}', '{}' FROM generate_series(1, 25000) n`;
      const before = await count("off_products");
      const wipe = Array.from({ length: 25_000 }, (_, at) => JSON.stringify({ code: codeOf(at), product_name: "No numbers" }));
      const keep = Array.from({ length: 10_000 }, (_, at) => JSON.stringify({ code: codeOf(50_000 + at), product_name: "Kept", nutrition: { aggregated_set: { per: "100g", nutrients: { "energy-kcal": { value: 100, unit: "kcal", source: "packaging" } } } } }));
      const server = fakeFetch({ "index.txt": A, [A]: gzipSync(Buffer.from([...wipe, ...keep].join(NEWLINE))) });
      await expect(updatePackagedFoods(deps({ fetch: server.fetch }))).rejects.toBeInstanceOf(PackagedFileRefused);
      expect(await count("off_products")).toBe(before);
    }, 60_000);

    it("a wrong name in their list cannot stop the update for good: it is passed over and said", async () => {
      await load();
      const future = dailyName(1793086400, 2147483647);
      const tooBig = dailyName(1793086400, 99999999999);
      const backwards = dailyName(1793172800, 1793086400);
      const server = fakeFetch({ "index.txt": [future, tooBig, backwards, A].join(NEWLINE), [A]: gzipSync(DAILY) });
      expect(await updatePackagedFoods(deps({ fetch: server.fetch }))).toMatchObject({ outcome: "updated", files: 1 });
      expect(server.asked).toEqual(["index.txt", A]);
      expect(warned.length).toBeGreaterThan(0);
      const next = fakeFetch({ "index.txt": B, [B]: gzipSync(DAILY) });
      expect(await updatePackagedFoods(deps({ fetch: next.fetch }))).toMatchObject({ outcome: "updated", files: 1 });
    });

    it("an emoji across a limit, or half of one, does not block the file or the ones after it", async () => {
      await load();
      const half = String.fromCharCode(0x5c) + "ud83d";
      const line = (code: string, name: string) => `{"code":"${code}","product_name":"${name}","nutrition":{"aggregated_set":{"per":"100g","nutrients":{"energy-kcal":{"value":100,"unit":"kcal","source":"packaging"}}}}}`;
      const body = [line(codeOf(1), `${"a".repeat(79)}😀`), line(codeOf(2), `Biscuits ${half}`)].join(NEWLINE);
      const server = fakeFetch({ "index.txt": A, [A]: gzipSync(Buffer.from(body)) });
      expect(await updatePackagedFoods(deps({ fetch: server.fetch }))).toMatchObject({ outcome: "updated", files: 1, written: 2 });
      expect((await packagedRowsFor(sql, codeOf(2))).off?.name).toBe("Biscuits");
    });

    it("a repeat full import does not undo a night: the days after it are applied again", async () => {
      await load();
      const code = "8718452980437";
      const night1 = fakeFetch({ "index.txt": A, [A]: gzipSync(DAILY) });
      await updatePackagedFoods(deps({ fetch: night1.fetch }));
      expect((await packagedRowsFor(sql, code)).off?.kcal).toBe(113);
      // An older download, then the import: the row goes back, and the import's mark is before that night.
      await sql`UPDATE off_products SET kcal = 1 WHERE code = ${code}`;
      await recordFullLoad(sql, new Date((1793086400 + 3600) * 1000));
      const night2 = fakeFetch({ "index.txt": A, [A]: gzipSync(DAILY) });
      expect(await updatePackagedFoods(deps({ fetch: night2.fetch }))).toMatchObject({ outcome: "updated", files: 1 });
      expect((await packagedRowsFor(sql, code)).off?.kcal).toBe(113);
    });

    describe("a real download over a real connection", () => {
      const started: Server[] = [];
      const serve = async (answer: (path: string, res: import("node:http").ServerResponse) => void): Promise<typeof fetch> => {
        const server = createServer((req, res) => { answer(req.url ?? "", res); });
        await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
        started.push(server);
        const { port } = server.address() as AddressInfo;
        return ((input: URL | string, init?: RequestInit) => fetch(input.toString().replace(/^https:[/][/][^/]+/, `http://127.0.0.1:${String(port)}`), init)) as typeof fetch;
      };
      afterAll(() => { for (const server of started) server.closeAllConnections(); });
      const gzipped = gzipSync(DAILY);
      const quick = { fetchMs: 300 };
      const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

      it("a connection cut midway fails the night and leaves the worker running", async () => {
        await load();
        const f = await serve((path, res) => {
          if (path.endsWith("index.txt")) { res.end(A); return; }
          res.writeHead(200, { "content-length": String(gzipped.length) });
          res.write(gzipped.subarray(0, 1000));
          setTimeout(() => { res.destroy(); }, 20);
        });
        await expect(updatePackagedFoods(deps({ fetch: f, limits: quick }))).rejects.toThrow();
        await settle();
        expect(await sql`SELECT 1 FROM off_daily_files WHERE name = ${A}`).toHaveLength(0);
      });

      it("a server that stalls fails the night at its time limit and leaves the worker running", async () => {
        await load();
        const f = await serve((path, res) => {
          if (path.endsWith("index.txt")) { res.end(A); return; }
          res.writeHead(200);
          res.write(gzipped.subarray(0, 1000));
        });
        await expect(updatePackagedFoods(deps({ fetch: f, limits: quick }))).rejects.toThrow();
        await settle();
      });

      it("an endless line is refused, and the download it left is closed", async () => {
        await load();
        const f = await serve((path, res) => {
          if (path.endsWith("index.txt")) { res.end(A); return; }
          res.writeHead(200);
          res.end(gzipSync(Buffer.alloc(2_000_000, 97)));
        });
        await expect(updatePackagedFoods(deps({ fetch: f, limits: { ...quick, lineBytes: 1000 } }))).rejects.toBeInstanceOf(PackagedFileRefused);
        await settle();
      });

      it.each<[string, Record<string, number>]>([
        ["more packed bytes than any day, whatever its header says", { packedBytes: 100 }],
        ["more unpacked bytes than any day", { unpackedBytes: 1000 }],
        ["more lines than any day", { lines: 2 }],
      ])("%s is refused", async (_name, limits) => {
        await load();
        const f = await serve((path, res) => {
          if (path.endsWith("index.txt")) { res.end(A); return; }
          res.writeHead(200);
          res.end(gzipped);
        });
        await expect(updatePackagedFoods(deps({ fetch: f, limits }))).rejects.toBeInstanceOf(PackagedFileRefused);
      });

      it("a list of files past any real size is refused", async () => {
        await load();
        const f = await serve((_path, res) => { res.writeHead(200); res.end(Buffer.alloc(100_000, 97)); });
        await expect(updatePackagedFoods(deps({ fetch: f, limits: { indexBytes: 1000 } }))).rejects.toBeInstanceOf(PackagedFileRefused);
      });

      it("a real day through a real connection is applied", async () => {
        await load();
        const f = await serve((path, res) => {
          if (path.endsWith("index.txt")) { res.end(A); return; }
          res.writeHead(200);
          res.end(gzipped);
        });
        expect(await updatePackagedFoods(deps({ fetch: f }))).toMatchObject({ outcome: "updated", files: 1 });
      });
    });

    it("skips days the full import already holds", async () => {
      await load();
      await recordFullLoad(sql, new Date((1793172800 + 3 * 24 * 3600) * 1000));
      const server = fakeFetch({ "index.txt": index });
      expect(await updatePackagedFoods(deps({ fetch: server.fetch }))).toMatchObject({ outcome: "up_to_date", gap: false });
      expect(server.asked).toEqual(["index.txt"]);
    });

    it("says when days were missed, and still applies what there is", async () => {
      await load();
      await recordFullLoad(sql, new Date((1793000000 - 5 * 24 * 3600) * 1000));
      const server = fakeFetch({ "index.txt": index, [A]: gzipSync(DAILY), [B]: gzipSync(Buffer.alloc(0)) });
      expect(await updatePackagedFoods(deps({ fetch: server.fetch }))).toMatchObject({ outcome: "updated", files: 2, gap: true });
      expect(warned).toHaveLength(1);
    });
  });
});
