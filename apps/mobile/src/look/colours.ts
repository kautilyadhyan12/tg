// The phone app's look: the member web's own colours and sizes, dark only
// (spec Part 6 §16.3a; drawn in docs/design/phone/shared/helmet.html).
// A screen names these; it never writes a colour of its own.
export const colours = {
  page: "#0A0908",
  /** The pass's code: black on white whatever the look, as a scanner reads it. */
  passLight: "#FFFFFF",
  passDark: "#000000",
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
  /** A picked box of long words: orangeFill over `overWords`. */
  boxPicked: "rgba(42,29,18,0.84)",
  /** A box of long words over a page's own picture: darker than `overPicture`, so the words read
   *  easily, and still clear enough to see the picture through (Kd, 2026-10-28). */
  overWords: "rgba(16,15,13,0.8)",
  /** A choice over a page's own picture: dark enough to read, clear enough to see the picture through. */
  overPicture: "rgba(16,15,13,0.62)",
  /** Behind a box from the bottom, and that box's handle. */
  scrim: "rgba(0,0,0,0.66)",
  /** Behind words that lie on a bright picture. */
  wordShadow: "rgba(0,0,0,0.8)",
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
  pink: "#f472b6",
  pinkFill: "rgba(244,114,182,0.16)",
  blueFill: "rgba(96,165,250,0.16)",
  /** A flame's foot and its heart (Progress's calendar, 35c-i). */
  flameDeep: "#E0400A",
  flamePale: "#FFF6D6",
  /** A number written on an orange bar. */
  onBar: "#3a1f05",
} as const;

export type ColourName = keyof typeof colours;

/** What is pressed: orange running to light orange. */
export const orangeGradient = `linear-gradient(135deg, ${colours.orange}, ${colours.orangeLight})`;
/** The picked row of a box from the bottom: orange fading to the right (Progress's period, 35c-i). */
export const pickedRowGradient = "linear-gradient(100deg, rgba(255,138,31,0.24), rgba(255,138,31,0.06))";
/** A chart's bar: light orange at its top running to orange at its foot (Progress, 35c-i). */
export const barGradient = `linear-gradient(to bottom, ${colours.orangeLight}, ${colours.orange})`;
/** Across a box with a chalk drawing on its right: the box's own colour under the words, the drawing
 *  showing through on the right (Progress, 35c-i). */
export const artShade =
  "linear-gradient(90deg, rgba(18,17,16,0.98) 0%, rgba(18,17,16,0.9) 34%, rgba(18,17,16,0.55) 70%, rgba(18,17,16,0.35) 100%)";
/** Over a drawing across a box's top: clear at the top, the box's own colour at its foot. */
export const bandShade =
  "linear-gradient(to top, rgba(18,17,16,1) 0%, rgba(18,17,16,0.55) 45%, rgba(18,17,16,0.05) 100%)";
/** Over a box's top drawing that fades into the rest of the box (Progress's calendar). */
export const topShade =
  "linear-gradient(to bottom, rgba(18,17,16,0.5) 0%, rgba(18,17,16,0.45) 45%, rgba(18,17,16,1) 100%)";
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

/** The same, kept off the picture's lower part, where its own light is the point (the Dashboard's fire). */
export const pictureFadeLight =
  "linear-gradient(to top, rgba(10,9,8,1) 0%, rgba(10,9,8,0.45) 7%, rgba(10,9,8,0) 13%, rgba(10,9,8,0) 72%, rgba(10,9,8,0.55) 100%)";

/** The glow of what is pressed, the ring round a box being typed in, and the lift of a box from the bottom. */
export const shadows = {
  button: "0 6px 22px rgba(255,138,31,0.38), inset 0 1px 0 rgba(255,255,255,0.22)",
  logo: "0 0 20px rgba(255,138,31,0.35)",
  fieldOn: "0 0 0 3px rgba(255,138,31,0.08)",
  chip: "0 4px 14px rgba(255,138,31,0.3)",
  /** A chart's best bar, and a lit day's dot (Progress, 35c-i). */
  barGlow: "0 0 0 6px rgba(255,138,31,0.16), 0 8px 22px rgba(255,138,31,0.35)",
  dotGlow: "0 0 8px rgba(255,138,31,0.75)",
  sheet: "0 -12px 48px rgba(0,0,0,0.6)",
} as const;

/** Personal Records' badges (35c-i, Kd's pick A of three drawings): a disc lit from its top left,
 *  light to deep, glowing in its own colour; grey for a record not yet set. */
export const badges = {
  clock: { light: "#FFD08A", deep: "#F06A0A", glow: "0 6px 18px rgba(255,120,20,0.45)" },
  flame: { light: "#FFB070", deep: "#C2260C", glow: "0 6px 18px rgba(230,70,20,0.42)" },
  star: { light: "#FBB6D8", deep: "#BE185D", glow: "0 6px 18px rgba(219,39,119,0.4)" },
  dumbbell: { light: "#FDE68A", deep: "#B7791F", glow: "0 6px 18px rgba(202,138,4,0.4)" },
  zap: { light: "#A5C8FF", deep: "#1D4ED8", glow: "0 6px 18px rgba(37,99,235,0.42)" },
  none: { light: "#6B655D", deep: "#2B2824", glow: "0 0 0 rgba(0,0,0,0)" },
} as const;
/** A badge's shine: white at its top, its foot a little darker. */
export const badgeShine = { top: colours.passLight, foot: colours.passDark } as const;

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
