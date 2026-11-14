import { render, screen } from "@testing-library/react-native";
import { DayPlate } from "../../src/screens/food/DayPlates";
import { MacroPlate } from "../../src/screens/food/MacroPlate";
import { PART_SWEEP, PLATE_PARTS, partPath } from "../../src/screens/food/plateRules";
import type { Bar } from "../../src/screens/food/weekRules";

// The plates as drawn (32c-i, round one): what the screen draws, not only the rules it reads.
/** Every drawn shape of a kind ("RNSVGCircle", "RNSVGClipPath"…), with its props, from the screen's tree. */
interface Drawn { type: string; props: Record<string, unknown>; children: Drawn[] }
function drawn(kind: string): Drawn[] {
  const out: Drawn[] = [];
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const node = n as { type: string; props: Record<string, unknown>; children: unknown[] | null };
    const kids = (node.children ?? []).filter((c): c is Drawn => c !== null && typeof c === "object");
    if (node.type === kind) out.push({ type: node.type, props: node.props, children: kids });
    kids.forEach(walk);
  };
  walk(screen.toJSON());
  return out;
}

const goal = { kcal: 2000, proteinG: 120, carbsG: 250, fatG: 70 };
const bar = (over: Partial<Bar>): Bar => ({ day: "2026-11-12", value: 2000, target: 2000, band: "on", today: false, about: false, current: false, ...over });

describe("today's plate", () => {
  it("a part over its target is drawn full, never past its rim", async () => {
    await render(<MacroPlate goal={goal} eaten={{ kcal: 3000, proteinG: 300, carbsG: 125, fatG: 0 }} left={null} />);
    const cuts = drawn("RNSVGClipPath").flatMap((c) => c.children.filter((k) => k.type === "RNSVGPath").map((k) => String(k.props["d"])));
    const [protein, carbs] = PLATE_PARTS;
    expect(cuts).toContain(partPath(112, 112, protein.from, protein.from + PART_SWEEP, 36, 82));
    expect(cuts).toContain(partPath(112, 112, carbs.from, carbs.from + PART_SWEEP, 36, 59));
    expect(screen.getByLabelText("Calories, 3,000 of 2,000 kcal")).toBeTruthy();
  });

  it("numbers not known yet draw no food at all", async () => {
    await render(<MacroPlate goal={goal} eaten={null} left={null} />);
    expect(drawn("RNSVGImage")).toHaveLength(0);
    expect(screen.getByLabelText("Calories, not known of 2,000 kcal")).toBeTruthy();
  });
});

describe("a day's plate", () => {
  const filled = () => drawn("RNSVGCircle").filter((c) => c.props["fillOpacity"] !== undefined);
  const dashed = () => drawn("RNSVGCircle").filter((c) => c.props["strokeDasharray"] !== undefined);

  it("over target is the whole plate in orange", async () => {
    await render(<DayPlate date={12} size={34} bar={bar({ value: 2600, band: "over" })} picked={false} later={false} />);
    expect(filled()).toHaveLength(1);
  });

  it("a day not read is drawn as not known, never as a day with nothing eaten", async () => {
    await render(<DayPlate date={3} size={34} bar={undefined} picked={false} later={false} />);
    expect(dashed()).toHaveLength(1);
    expect(filled()).toHaveLength(0);
  });

  it("a day with meals and no target is the whole plate in the soft colour, not an empty one", async () => {
    await render(<DayPlate date={12} size={34} bar={bar({ target: null, band: null })} picked={false} later={false} />);
    expect(filled()).toHaveLength(1);
    expect(dashed()).toHaveLength(0);
  });

  it("a day with no meals is an empty plate", async () => {
    await render(<DayPlate date={12} size={34} bar={bar({ value: null, band: null })} picked={false} later={false} />);
    expect(filled()).toHaveLength(0);
    expect(dashed()).toHaveLength(0);
  });
});
