import { useId } from "react";
import Svg, { Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import { colours } from "./colours";

// A fork and a knife beside a plate (the Food tab, 32c-i, Kd's drawing of 2026-11-14), in steel: dark at
// their edges, bright down the middle. Drawn on a 22 by 150 grid and sized by their height.

function Steel({ id }: { id: string }) {
  return (
    <Defs>
      <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
        <Stop offset="0" stopColor={colours.steelEdge} />
        <Stop offset="0.45" stopColor={colours.steelShine} />
        <Stop offset="1" stopColor={colours.steelEdge} />
      </LinearGradient>
    </Defs>
  );
}

const widthFor = (height: number) => Math.max(4, Math.round((height * 22) / 150));

export function Fork({ height }: { height: number }) {
  const id = `fork${useId().replace(/:/g, "")}`;
  return (
    <Svg width={widthFor(height)} height={height} viewBox="0 0 22 150" accessible={false}>
      <Steel id={id} />
      <G fill={`url(#${id})`}>
        <Path d="M2,3.5 A1.5,1.5 0 0 1 5,3.5 L5,40.5 A1.5,1.5 0 0 1 2,40.5 Z" />
        <Path d="M7,3.5 A1.5,1.5 0 0 1 10,3.5 L10,40.5 A1.5,1.5 0 0 1 7,40.5 Z" />
        <Path d="M12,3.5 A1.5,1.5 0 0 1 15,3.5 L15,40.5 A1.5,1.5 0 0 1 12,40.5 Z" />
        <Path d="M17,3.5 A1.5,1.5 0 0 1 20,3.5 L20,40.5 A1.5,1.5 0 0 1 17,40.5 Z" />
        <Path d="M2,38 L20,38 C20,48 15,52 13.5,56 L8.5,56 C7,52 2,48 2,38 Z" />
        <Path d="M8.6,55 L13.4,55 L15,138 A4,4 0 0 1 7,138 Z" />
      </G>
    </Svg>
  );
}

export function Knife({ height }: { height: number }) {
  const id = `knife${useId().replace(/:/g, "")}`;
  return (
    <Svg width={widthFor(height)} height={height} viewBox="0 0 22 150" accessible={false}>
      <Steel id={id} />
      <G fill={`url(#${id})`}>
        <Path d="M7,2 C17,10 18,44 16,72 L7,72 Z" />
        <Path d="M6.5,78.5 A4.5,4.5 0 0 1 15.5,78.5 L15.5,141.5 A4.5,4.5 0 0 1 6.5,141.5 Z" />
      </G>
    </Svg>
  );
}
