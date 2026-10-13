// The phone app's look: the member web's own colours and sizes, dark only
// (spec Part 6 §16.3a; drawn in docs/design/phone/shared/helmet.html).
// A screen names these; it never writes a colour of its own.
export const colours = {
  page: "#0A0908",
  box: "#121110",
  raised: "#1A1815",
  tabBar: "#0D0C0B",
  glass: "rgba(255,255,255,0.035)",
  fill: "rgba(255,255,255,0.05)",
  field: "rgba(10,9,8,0.7)",
  track: "rgba(255,255,255,0.08)",
  line: "rgba(255,255,255,0.06)",
  lineStrong: "rgba(255,255,255,0.10)",
  text: "rgba(255,255,255,0.95)",
  textSoft: "rgba(255,255,255,0.62)",
  textFaint: "rgba(255,255,255,0.42)",
  onOrange: "#ffffff",
  orange: "#FF8A1F",
  orangeLight: "#FFB347",
  orangeFill: "rgba(255,138,31,0.10)",
  orangeLine: "rgba(255,138,31,0.28)",
  good: "#22c55e",
  goodText: "#4ade80",
  goodFill: "rgba(34,197,94,0.12)",
  goodLine: "rgba(34,197,94,0.25)",
  bad: "#ef4444",
  badText: "#f87171",
  badFill: "rgba(239,68,68,0.12)",
  badLine: "rgba(239,68,68,0.30)",
  gold: "#FFD66B",
  goldFill: "rgba(255,214,107,0.12)",
  goldLine: "rgba(255,214,107,0.25)",
  blue: "#60a5fa",
  purple: "#a78bfa",
} as const;

export type ColourName = keyof typeof colours;

/** What is pressed: orange running to light orange. */
export const orangeGradient = `linear-gradient(135deg, ${colours.orange}, ${colours.orangeLight})`;
/** Over a picture, so the words on it can be read. */
export const pictureShade =
  "linear-gradient(to top, rgba(10,9,8,0.94) 0%, rgba(10,9,8,0.45) 50%, rgba(10,9,8,0.05) 100%)";

export const sizes = {
  /** A page's edge, and the gap between its boxes. */
  edge: 16,
  gap: 14,
  boxRadius: 18,
  /** A main button; nothing pressed is under `press`. */
  button: 48,
  press: 44,
  tabBar: 68,
} as const;
