// The phone app's look: the member web's own colours and sizes, dark only
// (spec Part 6 §16.3a; drawn in docs/design/phone/shared/helmet.html).
// A screen names these; it never writes a colour of its own.
export const colours = {
  page: "#0A0908",
  /** A run's route where it is now or ended, and its best kilometre (37a, Kd: white mixed with gold). */
  trail: "#FFFFFF",
  trailGlow: "rgba(255,255,255,0.18)",
  /** The run's numbers while it is paused. */
  textDim: "rgba(255,255,255,0.55)",
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
  /** A ticket's dashed edge (Invite a friend, 20a, as Kd's drawing of 2026-11-06). */
  ticketEdge: "rgba(255,255,255,0.16)",
  text: "rgba(255,255,255,0.95)",
  textSoft: "rgba(255,255,255,0.62)",
  textFaint: "rgba(255,255,255,0.42)",
  onOrange: "#ffffff",
  orange: "#FF8A1F",
  orangeLight: "#FFB347",
  /** The foot of a raised main button (sign-in, 12e). */
  orangeDeep: "#F2710C",
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
  /** The app's name as Kd's posters write it (12e): black on a white pill, its Z orange. */
  brandPill: "#FFFFFF",
  brandInk: "#0A0908",
  /** Continue with Google, as Google's light button: white, a grey edge, near-black words. */
  light: "#FFFFFF",
  lightLow: "#ECEBE9",
  lightLine: "#D9D7D3",
  onLight: "#1F1F1F",
  /** The sign-in box over Kd's bright poster (his pick, "C2"): the poster's orange made rust, so it stands apart,
   *  with a white sticker edge and a thin dark outline like the poster's people; words on it white. */
  signInTop: "#C9500A",
  signInFoot: "#A63E06",
  signInOutline: "rgba(20,12,40,0.9)",
  onSignIn: "rgba(255,255,255,0.85)",
  onSignInFaint: "rgba(255,255,255,0.45)",
  /** Words waiting in a white box, and the black main button on the orange box. */
  lightPlaceholder: "#8A7D70",
  darkButton: "#1A1410",
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
/** A main button drawn raised (sign-in, 12e): light at its top, deeper at its foot. */
export const raisedOrangeGradient = `linear-gradient(to bottom, ${colours.orangeLight} 0%, ${colours.orange} 55%, ${colours.orangeDeep} 100%)`;
/** Google's white button, faintly rounded by its light. */
export const lightGradient = `linear-gradient(to bottom, ${colours.light}, ${colours.lightLow})`;
/** The sign-in box, rust from its top to its foot (12e). */
export const signInGradient = `linear-gradient(to bottom, ${colours.signInTop}, ${colours.signInFoot})`;
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
/** A raised box with no picture of its own: dark at its words, turning the neutral silver-grey of the
 *  Weekly Challenges picture toward its right, so it stands off the page (Kd, 2026-11-08: Recommended
 *  For You and Recent Activity). */
export const raisedShade = "linear-gradient(90deg, rgba(26,25,25,1) 0%, rgba(33,32,32,1) 45%, rgba(43,42,42,1) 100%)";

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

/** Under the Running page's START, over the page's foot: the page fading out as it scrolls under it. */
export const dockShade = "linear-gradient(to bottom, rgba(10,9,8,0) 0%, rgba(10,9,8,0.9) 30%, rgba(10,9,8,1) 100%)";

/** The same, kept off the picture's lower part, where its own light is the point (the Dashboard's fire). */
export const pictureFadeLight =
  "linear-gradient(to top, rgba(10,9,8,1) 0%, rgba(10,9,8,0.45) 7%, rgba(10,9,8,0) 13%, rgba(10,9,8,0) 72%, rgba(10,9,8,0.55) 100%)";

/** The glow of what is pressed, the ring round a box being typed in, and the lift of a box from the bottom. */
export const shadows = {
  button: "0 6px 22px rgba(255,138,31,0.38), inset 0 1px 0 rgba(255,255,255,0.22)",
  /** The raised main button (sign-in, 12e): its glow, a warm rim, the light along its top and a shade at its foot. */
  buttonRaised: "0 10px 28px rgba(255,138,31,0.45), 0 0 0 1px rgba(255,190,120,0.35), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -2px 0 rgba(150,60,0,0.25)",
  /** Google's white button and the app's name lifted off the picture. */
  lightButton: "0 6px 18px rgba(0,0,0,0.35)",
  /** The sign-in box over the picture: its thin dark outline round the white edge, and its lift. */
  signInBox: `0 0 0 2px ${colours.signInOutline}, 0 14px 40px rgba(0,0,0,0.35)`,
  /** The black main button lifted off the orange box. */
  darkButton: "0 8px 20px rgba(0,0,0,0.35)",
  logo: "0 0 20px rgba(255,138,31,0.35)",
  fieldOn: "0 0 0 3px rgba(255,138,31,0.08)",
  chip: "0 4px 14px rgba(255,138,31,0.3)",
  /** A chart's best bar, and a lit day's dot (Progress, 35c-i). */
  barGlow: "0 0 0 6px rgba(255,138,31,0.16), 0 8px 22px rgba(255,138,31,0.35)",
  dotGlow: "0 0 8px rgba(255,138,31,0.75)",
  /** A day run on Your runs' calendar (37c-i): the footprint lit from under. */
  dayGlow: "0 0 16px 4px rgba(255,138,31,0.55)",
  sheet: "0 -12px 48px rgba(0,0,0,0.6)",
  /** A run's round Start, Pause and Resume (37a): a halo, then the glow under it. */
  roundButton: "0 0 0 10px rgba(255,138,31,0.12), 0 0 0 22px rgba(255,138,31,0.05), 0 10px 38px rgba(255,138,31,0.55)",
} as const;

/** Progress's redrawn boxes (35c-i, Kd's drawing of 2026-11-04, "excellent job"): the records over
 *  the push-up drawing on dark glass, each sign in a chalk-white ring like the drawing's joint marks;
 *  the boxes from the bottom under their tab's drawing; the picked tile glowing as the tabs do. */
export const chalk = {
  ring: "rgba(255,253,248,0.85)",
  ringInside: "rgba(10,9,8,0.72)",
  glass: "rgba(16,15,13,0.62)",
  glassLine: "rgba(255,255,255,0.12)",
  bestLine: "rgba(255,138,31,0.45)",
} as const;
export const chalkShadows = {
  ring: "0 0 0 4px rgba(255,138,31,0.10), 0 0 16px rgba(255,138,31,0.35)",
  best: "0 0 24px rgba(255,138,31,0.18)",
  picked: "0 8px 26px rgba(255,138,31,0.5)",
  trained: "0 0 16px rgba(255,138,31,0.18)",
} as const;
/** Over the records' drawing on the right: the box's colour on its left, as the Trends boxes, a
 *  little clearer on the right; and darker at its foot, under the numbers. */
export const recordsArtShade =
  "linear-gradient(90deg, rgba(18,17,16,0.98) 0%, rgba(18,17,16,0.85) 30%, rgba(18,17,16,0.4) 65%, rgba(18,17,16,0.12) 100%)";
export const recordsFootShade = "linear-gradient(to bottom, rgba(18,17,16,0) 40%, rgba(18,17,16,0.45) 100%)";
/** The best record's glass: warm on its left. */
export const bestRecordGradient = "linear-gradient(100deg, rgba(64,36,12,0.78), rgba(16,15,13,0.62))";
/** A box from the bottom's drawing, fading into the box under its title. */
export const sheetBandShade =
  "linear-gradient(to top, rgba(18,17,16,1) 0%, rgba(18,17,16,0.6) 40%, rgba(18,17,16,0.1) 80%, rgba(18,17,16,0.35) 100%)";

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

/** Achievements (35c-iii, Kd's drawing of 2026-11-05): the medals' metals for the leaderboard's top three and its
 *  lanes, the laurel's gold and empty leaves, the dark shelf the medals stand on, and a stone for every other place. */
export const medal = {
  gold: "#F2C14E",
  goldLight: "#FFF3C4",
  goldDeep: "#A8741A",
  silver: "#DFE4EA",
  silverLight: "#FFFFFF",
  silverDeep: "#7D858E",
  bronze: "#D98E55",
  bronzeLight: "#FFE2C6",
  bronzeDeep: "#7A4321",
  bronzeFill: "rgba(205,127,50,0.16)",
  silverFill: "rgba(192,192,192,0.14)",
  /** Initials on a metal disc. */
  onMetal: "#2A1A08",
  leafEmpty: "rgba(255,255,255,0.04)",
  leafLine: "rgba(255,255,255,0.28)",
  leafLitLine: "rgba(255,230,160,0.9)",
  leafVein: "rgba(120,70,10,0.7)",
  leafVeinEmpty: "rgba(255,255,255,0.15)",
  stem: "rgba(255,255,255,0.22)",
  stone: "#2C2621",
  stoneText: "rgba(255,235,210,0.8)",
  laneTrack: "rgba(255,255,255,0.07)",
  laneLine: "rgba(255,220,170,0.06)",
  laneOther: "rgba(255,220,170,0.75)",
  heading: "rgba(255,190,120,0.9)",
  wreathInside: "#120D08",
  wreathRing: "rgba(242,193,78,0.5)",
  leafEdge: "rgba(90,50,5,0.5)",
  levelWord: "#E8C98A",
  keyEmpty: "rgba(255,255,255,0.14)",
} as const;
export const medalShades = {
  shelf: "linear-gradient(to bottom, #3a3129 0%, #1a1511 70%, #0e0b09 100%)",
  heading: "linear-gradient(90deg, rgba(255,190,120,0.35), rgba(255,190,120,0))",
  gold: "linear-gradient(135deg, #FFF3C4 0%, #F2C14E 55%, #A8741A 100%)",
  silver: "linear-gradient(135deg, #FFFFFF 0%, #D5DBE1 55%, #7D858E 100%)",
  bronze: "linear-gradient(135deg, #FFE2C6 0%, #D48A52 55%, #7A4321 100%)",
  stone: "linear-gradient(135deg, #3a332c 0%, #1d1915 100%)",
  mine: "linear-gradient(90deg, rgba(255,138,31,0.18), rgba(255,138,31,0.04))",
  /** Over a painting on the right of a box: the box's colour under the words on its left. */
  paint: "linear-gradient(90deg, rgba(14,12,10,0.92) 0%, rgba(14,12,10,0.6) 48%, rgba(14,12,10,0.05) 100%)",
  shelfShadow: "0 10px 18px rgba(0,0,0,0.7)",
  mineEdge: "inset 3px 0 0 #FF8A1F",
} as const;

/** The map under a run (37b-i, Kd's drawings of 2026-11-06): a light full map from sunrise to sunset
 *  (drawing C, as OpenStreetMap's own daytime maps colour land, parks, water and streets), a mid grey
 *  after it (drawing B). Each names the map's own parts; the run's trail has its own colours below. */
export const mapColours = {
  light: {
    land: "#F8F4F0",
    residential: "rgba(234,222,208,0.45)",
    park: "#D8E8C8",
    wood: "#BEDDA6",
    sand: "#F7EFC3",
    water: "#9EBDFF",
    waterLine: "#A0C8F0",
    building: "#DFDAD4",
    minor: "#FFFFFF",
    minorEdge: "#CFCDCA",
    major: "#FFEEAA",
    majorEdge: "#E9AC77",
    motorway: "#FFCC88",
    path: "#FFFFFF",
    pathEdge: "#D6D0C8",
    rail: "#BBBBBB",
    name: "#5F5F5F",
    place: "#333333",
    waterName: "#495E91",
    landmark: "#5F5F5F",
    transit: "#2E5A80",
    halo: "#FFFFFF",
  },
  dark: {
    land: "#4B4742",
    residential: "rgba(0,0,0,0)",
    park: "#3B4C37",
    wood: "#384935",
    sand: "#5A5240",
    water: "#294856",
    waterLine: "#3A6072",
    building: "#57524C",
    minor: "#6F685E",
    minorEdge: "#5A544D",
    major: "#918574",
    majorEdge: "#6F6658",
    motorway: "#A69680",
    path: "#746C61",
    pathEdge: "#5A544D",
    rail: "#6A645C",
    name: "rgba(255,255,255,0.86)",
    place: "rgba(255,255,255,0.9)",
    waterName: "#A9C3CF",
    landmark: "rgba(255,255,255,0.82)",
    transit: "#A9C3CF",
    halo: "#4B4742",
  },
} as const;

/** A run's trail over the map: by day gold with a dark edge (a white line is lost on a light map), at
 *  night the white-gold glowing trail of 37a. `from`, `mid` and `to` colour it from start to front. */
export const trailColours = {
  light: {
    glow: "#FFB020",
    edge: "#2B1D0E",
    from: "#D98E04",
    mid: "#F5B321",
    to: "#FFD66B",
    shine: "#FFF6D6",
    stone: "#1A130B",
    stoneRing: "#FFD66B",
    stoneWord: "#FFD66B",
    start: "#22c55e",
    finish: "#1A130B",
    endRing: "#FFFFFF",
    beam: "#FF9F1A",
    front: "#FFF6D6",
    credit: "rgba(255,255,255,0.8)",
    creditWord: "#333333",
  },
  dark: {
    glow: "#FFD66B",
    edge: "rgba(10,9,8,0.55)",
    from: "rgba(255,214,107,0.7)",
    mid: "#FFF6D6",
    to: "#FFFFFF",
    shine: "rgba(255,255,255,0)",
    stone: "#0A0908",
    stoneRing: "#FFF6D6",
    stoneWord: "#FFF6D6",
    start: "#FFD66B",
    finish: "#FFFFFF",
    endRing: "#0A0908",
    beam: "#FFFFFF",
    front: "#FFFFFF",
    credit: "rgba(10,9,8,0.6)",
    creditWord: "rgba(255,255,255,0.75)",
  },
} as const;

/** A running record (37c-ii, Kd's "yes" to the drawing): the gold New record box on a run's summary,
 *  glowing from its medal; the gold "Your record" tag. */
export const recordLook = {
  box: "#14110C",
  line: "rgba(255,214,107,0.35)",
  shade: "linear-gradient(90deg, rgba(255,214,107,0.22) 0%, rgba(255,138,31,0.06) 55%, rgba(20,17,12,0) 100%)",
  glow: "0 0 28px rgba(255,180,60,0.16)",
  word: "#FFD66B",
  tag: "#FFD66B",
  onTag: "#1A1206",
} as const;
