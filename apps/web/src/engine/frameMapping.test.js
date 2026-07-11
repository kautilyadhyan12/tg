import { describe, it, expect } from "vitest";
import { frameToDisplay, phaseToState } from "./frameMapping.js";

describe("phaseToState", () => {
  it("maps working-half phases to 'down', returning phases to 'up'", () => {
    expect(phaseToState("descent")).toBe("down");
    expect(phaseToState("bottom")).toBe("down");
    expect(phaseToState("ascent")).toBe("up");
    expect(phaseToState("top")).toBe("up");
  });
});

describe("frameToDisplay", () => {
  const base = {
    phase: "bottom",
    repCount: 3,
    isActive: true,
    view: "side",
    visibilityOk: true,
    liveCue: null,
    signals: {},
    calibrationState: "ready",
  };

  it("passes through count/view/active and marks form correct when no cue", () => {
    const d = frameToDisplay(base);
    expect(d.rep_count).toBe(3);
    expect(d.view).toBe("side");
    expect(d.is_active).toBe(true);
    expect(d.person_detected).toBe(true);
    expect(d.form_correct).toBe(true);
    expect(d.corrections).toEqual([]);
  });

  it("translates a live cue key to EN and flags form incorrect", () => {
    const d = frameToDisplay({ ...base, liveCue: "fault.squat.depth" });
    expect(d.form_correct).toBe(false);
    expect(d.corrections).toEqual([
      "Squat lower — aim to get your hips level with your knees",
    ]);
  });

  it("surfaces the visibility cue string", () => {
    const d = frameToDisplay({ ...base, visibilityOk: false, liveCue: "cue.visibility.step_back" });
    expect(d.person_detected).toBe(false);
    expect(d.corrections[0]).toMatch(/step back/i);
  });
});
