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
  /** A box to type in, as the browser draws it; the `On` pair while it is being typed in. */
  field: "rgba(255,255,255,0.04)",
  fieldLine: "rgba(255,255,255,0.08)",
  fieldOn: "rgba(255,255,255,0.06)",
  fieldOnLine: "rgba(255,138,31,0.4)",
  /** A box of words over a picture. */
  veil: "rgba(10,9,8,0.7)",
  /** Behind a box from the bottom, and that box's handle. */
  scrim: "rgba(0,0,0,0.66)",
  grab: "rgba(255,255,255,0.18)",
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
  /** Google's G on its sign-in button, in Google's own four colours; for nothing else. */
  googleBlue: "#4285F4",
  googleGreen: "#34A853",
  googleYellow: "#FBBC05",
  googleRed: "#EA4335",
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

/** Across a box with a picture on its right: the box's own colour under the words, clear over the picture. */
export const boxShade =
  "linear-gradient(90deg, rgba(18,17,16,1) 0%, rgba(18,17,16,1) 30%, rgba(18,17,16,0.7) 50%, rgba(18,17,16,0.1) 100%)";

/** A page's own picture running into the page under it, a little darker at the top for the phone's clock. */
export const pictureFade =
  "linear-gradient(to top, rgba(10,9,8,1) 0%, rgba(10,9,8,0.8) 24%, rgba(10,9,8,0.16) 60%, rgba(10,9,8,0.3) 100%)";

/** The same under a page's first words: darker at the top, where a greeting or the clock is read. */
export const pictureFadeUnderWords =
  "linear-gradient(to top, rgba(10,9,8,1) 0%, rgba(10,9,8,0.82) 20%, rgba(10,9,8,0.18) 55%, rgba(10,9,8,0.62) 100%)";

/** The glow of what is pressed, the ring round a box being typed in, and the lift of a box from the bottom. */
export const shadows = {
  button: "0 6px 22px rgba(255,138,31,0.38), inset 0 1px 0 rgba(255,255,255,0.22)",
  logo: "0 0 20px rgba(255,138,31,0.35)",
  fieldOn: "0 0 0 3px rgba(255,138,31,0.08)",
  sheet: "0 -12px 48px rgba(0,0,0,0.6)",
} as const;

export const sizes = {
  /** A page's edge, and the gap between its boxes. */
  edge: 16,
  gap: 14,
  boxRadius: 18,
  /** A main button; nothing pressed is under `press`. `round`: a button's ends are full half-circles. */
  button: 48,
  press: 44,
  round: 999,
  tabBar: 68,
} as const;
