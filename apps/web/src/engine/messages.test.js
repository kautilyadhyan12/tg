import { describe, it, expect } from "vitest";
import { translate } from "./messages.en.js";

describe("translate (Appendix A EN catalog)", () => {
  it("returns the EN string for known fault/visibility keys", () => {
    expect(translate("fault.squat.valgus")).toMatch(/knees out/i);
    expect(translate("cue.visibility.step_back")).toMatch(/step back/i);
  });

  it("returns null for a null key (no live cue this frame)", () => {
    expect(translate(null)).toBeNull();
  });

  it("returns the key itself for an unknown key (visible, never a crash)", () => {
    expect(translate("fault.unknown.thing")).toBe("fault.unknown.thing");
  });
});
