import { SvgXml } from "react-native-svg";
import { colours, type ColourName } from "./colours";
import shapes from "./icons.json";

export type IconName = keyof typeof shapes;

interface IconProps {
  name: IconName;
  size?: number;
  colour?: ColourName;
  /** Filled with its colour, not drawn in lines: the flame on a day somebody came. */
  filled?: boolean;
}

/** A line icon (Lucide's, as drawn in docs/design/phone/shared/icons.json). */
export function Icon({ name, size = 18, colour = "text", filled = false }: IconProps) {
  return (
    <SvgXml
      xml={`<svg viewBox="0 0 24 24" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="${filled ? "1.5" : "2"}" stroke-linecap="round" stroke-linejoin="round">${shapes[name]}</svg>`}
      width={size}
      height={size}
      color={colours[colour]}
    />
  );
}
