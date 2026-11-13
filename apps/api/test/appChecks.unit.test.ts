// Overview's App payments to review (ROADMAP 18k-vi): which rows are sent, and in what order (round one, L2, L3 and its first
// test gap). The newest first by the moment each page ended, whatever its kind; the newest people kept; never more rows
// than the reply holds; and `more` whenever anything was left out.
import { describe, expect, it } from "vitest";
import { keepNewest } from "../src/modules/orgs/memberships/appChecks.js";

const row = (id: string, entryId: string, finishedAt: string) => ({ id, entryId, finishedAt });

describe("keepNewest", () => {
  it("orders by when each ended, not by kind or day: a purchase at 18:00 above a bill at 09:00 that day", () => {
    const rows = [row("bill:a", "p1", "2026-11-13T09:00:00.000Z"), row("fee:b", "p2", "2026-11-12T23:00:00.000Z"), row("purchase:c", "p3", "2026-11-13T18:00:00.000Z")];
    expect(keepNewest(rows, 100, 2000)).toEqual({ rows: [rows[2], rows[0], rows[1]], more: false });
  });

  it("keeps the newest people, with all their rows, and says more", () => {
    const rows = [row("bill:a", "old", "2026-11-01T00:00:00.000Z"), row("bill:b", "new", "2026-11-03T00:00:00.000Z"), row("fee:c", "old", "2026-11-04T00:00:00.000Z"), row("bill:d", "mid", "2026-11-02T00:00:00.000Z")];
    const kept = keepNewest(rows, 2, 2000);
    expect(kept.rows.map((r) => r.id)).toEqual(["fee:c", "bill:b", "bill:a"]);
    expect(kept.more).toBe(true);
    expect(keepNewest(rows, 3, 2000).more).toBe(false);
  });

  it("never more rows than the reply holds, the newest first, and says more", () => {
    const rows = Array.from({ length: 5 }, (_, i) => row(`purchase:${String(i)}`, "one", `2026-11-0${String(i + 1)}T00:00:00.000Z`));
    const kept = keepNewest(rows, 100, 3);
    expect(kept.rows.map((r) => r.id)).toEqual(["purchase:4", "purchase:3", "purchase:2"]);
    expect(kept.more).toBe(true);
    expect(keepNewest(rows, 100, 5).more).toBe(false);
  });

  it("nothing in, nothing out", () => {
    expect(keepNewest([], 100, 2000)).toEqual({ rows: [], more: false });
  });
});
