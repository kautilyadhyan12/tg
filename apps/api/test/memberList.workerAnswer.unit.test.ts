// The worker's answer and the request thread's reading of it (spec Part 3 §9.4,
// §9.9): a crash reaches the logs as an error's class name and nothing else — a
// message can quote a cell, and a cell never reaches a log or Sentry.
import { describe, expect, it } from "vitest";
import { readWorkerReply } from "../src/modules/orgs/memberList/parseMemberFile.js";
import { workerAnswer } from "../src/modules/orgs/memberList/workerAnswer.js";

/** What a cell could hold, in an error's message: it must never come back out. */
const CELL = "jose.alvarez@example.com +44 7911 123456";

class LeakyNamedError extends Error {
  constructor() {
    super(CELL);
    this.name = `Bad ${CELL}`;
  }
}

describe("the worker's answer", () => {
  it("answers the file's result", async () => {
    const answer = await workerAnswer({ kind: "text", bytes: new Uint8Array(Buffer.from("Email\nann@example.com\n")) });
    expect(answer).toEqual({
      done: {
        ok: true,
        kind: "csv",
        sheets: [{ name: null, rows: [["Email"], ["ann@example.com"]], truncated: { rows: false, columns: false } }],
        facts: { encoding: "utf-8", delimiter: "," },
        warnings: [],
      },
    });
  });

  it.each([
    ["an Error quoting a cell", (): unknown => new Error(CELL), "Error"],
    ["a TypeError quoting a cell", (): unknown => new TypeError(CELL), "TypeError"],
    ["an error whose name holds a cell", (): unknown => new LeakyNamedError(), "unknown"],
    ["something thrown that is not an Error", (): unknown => CELL, "unknown"],
  ])("crashes on %s with its class name only", async (_label, thrown, name) => {
    const answer = await workerAnswer({ kind: "text", bytes: new Uint8Array(1) }, () => {
      throw thrown();
    });
    expect(answer).toEqual({ crashed: name });
    expect(JSON.stringify(answer)).not.toContain("example.com");
  });

  it("crashes on a job that is not one, naming the schema's error only", async () => {
    expect(await workerAnswer({ kind: "pdf", bytes: CELL })).toEqual({ crashed: "ZodError" });
  });
});

describe("the request thread's reading of the answer", () => {
  it("returns the file's result", () => {
    expect(readWorkerReply({ done: { ok: false, refusal: { code: "too_complex" } } })).toEqual({ ok: false, refusal: { code: "too_complex" } });
  });

  it("throws a crash with the class name only", () => {
    expect(() => readWorkerReply({ crashed: "TypeError" })).toThrow(/^member file worker failed inside: TypeError$/);
  });

  it.each([
    ["a crash whose name carries a cell", { crashed: CELL }],
    ["a result that breaks the contract, quoting a cell", { done: { ok: true, kind: "csv", sheets: CELL } }],
    ["nothing the worker sends", CELL],
  ])("throws on %s without a word of it", (_label, message) => {
    let thrown: unknown;
    try {
      readWorkerReply(message);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain("example.com");
    expect(String(thrown)).toBe("Error: member file worker answered in a shape it never sends");
  });
});
