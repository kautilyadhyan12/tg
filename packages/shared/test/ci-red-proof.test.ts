// TEMPORARY: proves CI goes red (P0.2 card). Deleted in the next commit.
import { expect, it } from "vitest";

it("deliberately fails to prove CI gates", () => {
  expect(1).toBe(2);
});

