import { describe, it, expect } from "vitest";
import { translate } from "./messages.en.js";

describe("translate (Appendix A EN catalog)", () => {
  it("returns the EN string for known fault/visibility keys", () => {
    expect(translate("fault.squat.valgus")).toMatch(/knees out/i);
    expect(translate("cue.visibility.step_back")).toMatch(/step back/i);
  });

  it("has a sentence for the person check, and it names no cause", () => {
    // The check knows only that its own reading says "not a body". It cannot
    // tell a chair from a bad angle from a user half out of shot, so a cue that
    // explained WHY would be naming a cause the app cannot know (:6150 C/H-2).
    // A missing key would render as the key itself — visible, never a crash —
    // so this pins that the sentence exists at all.
    const cue = translate("cue.scene.no_person");
    expect(cue).toMatch(/not counting/i);
    expect(cue).not.toBe("cue.scene.no_person");
    expect(cue).not.toMatch(/chair|furniture|object|sofa/i);
  });

  it("returns null for a null key (no live cue this frame)", () => {
    expect(translate(null)).toBeNull();
  });

  it("returns the key itself for an unknown key (visible, never a crash)", () => {
    expect(translate("fault.unknown.thing")).toBe("fault.unknown.thing");
  });
});
