import Svg, { Path } from "react-native-svg";
import { colours, type ColourName } from "./colours";

// A saved dish drawn filled to a level, as the browser draws it (apps/web/src/components/nutrition/
// fillBowls.js): the server weighs a dish as its volume times how full it was, so each picture is
// filled to the height that holds that share in its own shape. A cup or a mug has straight sides;
// any other dish, a size typed in ml included, is drawn a bowl. Drawn on a 24-unit square.

const CX = 12;
const RIM_Y = 5;
const BODY_RX = 9;
const BODY_RY = 11;
const CONTENTS_RX = 7;
const CONTENTS_RY = 9;
const MUG_TOP = 6;
const MUG_BOTTOM = 18;
const STRAIGHT_SIDED = new Set(["cup", "mug"]);

/** How far up a round bowl its contents reach, as a share of its depth, when it holds `fill` of what
 *  it holds full: a cap of depth h in a half-ball of radius 1 holds h²(3 − h)/2 of it. */
export function fillDepth(fill: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if ((mid * mid * (3 - mid)) / 2 < fill) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

function bowlContents(fill: number): string {
  const surface = RIM_Y + CONTENTS_RY * (1 - fillDepth(fill));
  const halfWidth = CONTENTS_RX * Math.sqrt(Math.max(0, 1 - ((surface - RIM_Y) / CONTENTS_RY) ** 2));
  return `M${String(round2(CX - halfWidth))} ${String(round2(surface))}A${String(CONTENTS_RX)} ${String(CONTENTS_RY)} 0 0 0 ${String(round2(CX + halfWidth))} ${String(round2(surface))}Z`;
}

function mugContents(fill: number): string {
  const surface = round2(MUG_BOTTOM - (MUG_BOTTOM - MUG_TOP) * fill);
  return `M6 ${String(surface)}V16a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V${String(surface)}Z`;
}

/** The dish's own shape at a fill. */
export function FillDish({ containerClass, fill, size = 36, colour = "textSoft" }: { containerClass: string; fill: number; size?: number; colour?: ColourName }) {
  const ink = colours[colour];
  const mug = STRAIGHT_SIDED.has(containerClass);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {mug ? (
        <>
          <Path d="M4 5v11a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4V5" stroke={ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d="M18 9h1a2.5 2.5 0 0 1 0 5h-1" stroke={ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <Path d={mugContents(fill)} fill={ink} />
        </>
      ) : (
        <>
          <Path d={`M${String(CX - BODY_RX)} ${String(RIM_Y)}a${String(BODY_RX)} ${String(BODY_RY)} 0 0 0 ${String(2 * BODY_RX)} 0`} stroke={ink} strokeWidth={2} strokeLinecap="round" fill="none" />
          <Path d={`M8 ${String(RIM_Y + BODY_RY + 3)}h8`} stroke={ink} strokeWidth={2} strokeLinecap="round" fill="none" />
          <Path d={bowlContents(fill)} fill={ink} />
        </>
      )}
    </Svg>
  );
}
