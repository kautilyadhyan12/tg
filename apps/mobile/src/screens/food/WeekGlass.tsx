import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop } from "react-native-svg";
import { colours, type ColourName } from "../../look/colours";
import { glassShape } from "./plateRules";

// A day of the Week tab as a glass (32c-i, Kd's pick of 2026-11-14: "the test tube like one better"):
// filled as far as the day's figure went, in the week's colour; over target it foams and drips down
// its side. The same scale as the line across the week: `level` is the bar's height in points.

export const GLASS_WIDTH = 34;
/** Room over the glass for its foam, and beside it for a drip. */
export const GLASS_ROOM = 12;

const LIQUID: Partial<Record<ColourName, readonly [ColourName, ColourName]>> = {
  good: ["good", "goodText"],
  blue: ["blueDeep", "blueLight"],
  orange: ["orangeDeep", "orangeLight"],
  textFaint: ["greyDeep", "greyLight"],
  textSoft: ["greyDeep", "greyLight"],
};

export function WeekGlass({ level, height, colour, over, id }: { level: number | null; height: number; colour: ColourName; over: boolean; id: string }) {
  const shape = glassShape(GLASS_WIDTH, height, GLASS_ROOM, level);
  const [deep, light] = LIQUID[colour] ?? ([colour, colour] as const);
  const grad = `glass${id}`;
  return (
    <Svg width={GLASS_WIDTH + GLASS_ROOM} height={height + GLASS_ROOM} accessible={false}>
      <Defs>
        <LinearGradient id={grad} x1="0" y1="1" x2="0" y2="0">
          <Stop offset="0" stopColor={colours[deep]} />
          <Stop offset="1" stopColor={colours[light]} />
        </LinearGradient>
      </Defs>
      <Path d={shape.glass} fill={colours.glass} />
      {shape.liquid === null ? null : (
        <>
          <Path d={shape.liquid.path} fill={`url(#${grad})`} />
          <Ellipse cx={shape.liquid.middle} cy={shape.liquid.top} rx={shape.liquid.half} ry={2.5} fill={colours[light]} />
          {shape.liquid.bubbles.map((b) => (
            <Circle key={`${String(b.x)}-${String(b.y)}`} cx={b.x} cy={b.y} r={b.r} fill={colours.bubble} />
          ))}
          {over ? (
            <>
              <Ellipse cx={shape.liquid.middle} cy={shape.liquid.top} rx={shape.liquid.half + 2} ry={4} fill={colours[light]} />
              <Circle cx={shape.liquid.middle - 5} cy={shape.liquid.top - 3} r={3.5} fill={colours[light]} />
              <Circle cx={shape.liquid.middle + 4} cy={shape.liquid.top - 5} r={4.5} fill={colours[light]} />
              <Path d={shape.liquid.drip} stroke={colours[light]} strokeWidth={3} strokeLinecap="round" fill="none" />
              <Circle cx={shape.liquid.dripEnd.x} cy={shape.liquid.dripEnd.y} r={2.5} fill={colours[light]} />
            </>
          ) : null}
        </>
      )}
      <Path d={shape.glass} stroke={colours.glassEdge} strokeWidth={1.5} strokeLinejoin="round" fill="none" />
      <Path d={shape.shine} stroke={colours.glassShine} strokeWidth={2} strokeLinecap="round" fill="none" />
    </Svg>
  );
}
