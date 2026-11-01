// The member web's own pictures, made small (spec Part 6 §16.3a): 900 pixels on the
// long side, WebP. Made by docs/design/phone/compact.py; never the web's full-size files.
// `cave` is Kd's "prehistoric-cave-brightened" (2026-10-28), its fire made to glow, for the Dashboard's top.
// `motivation` is Kd's "Glowing spear ring and lone warrior" (2026-10-28), darkened for the clock.
// `goals` and `goalsbox` are Kd's own drawing (2026-10-27), made dark by reviews/pics31b.py.
// `getstarted` is the browser's sign-in picture, cut by the same tool to sit at the top of a phone.
// `setup` is the browser's setup picture (its Vitruvian figure), its lines drawn light and glowing for the dark page.
import benchpress from "../../assets/pictures/benchpress.webp";
import bicepcurls from "../../assets/pictures/bicepcurls.webp";
import caloriesburned from "../../assets/pictures/caloriesburned.webp";
import cave from "../../assets/pictures/cave.webp";
import chairsquat from "../../assets/pictures/chairsquat.webp";
import currentlevel from "../../assets/pictures/currentlevel.webp";
import cyclingcrunch from "../../assets/pictures/cyclingcrunch.webp";
import dailymotivation from "../../assets/pictures/dailymotivation.webp";
import exhero from "../../assets/pictures/exhero.webp";
import experiencepoints from "../../assets/pictures/experiencepoints.webp";
import food from "../../assets/pictures/food.webp";
import foodbg from "../../assets/pictures/foodbg.webp";
import foodbowl from "../../assets/pictures/foodbowl.webp";
import getstarted from "../../assets/pictures/getstarted.webp";
import goals from "../../assets/pictures/goals.webp";
import goalsbox from "../../assets/pictures/goalsbox.webp";
import hero from "../../assets/pictures/hero.webp";
import hourstrained from "../../assets/pictures/hourstrained.webp";
import jumpsquat from "../../assets/pictures/jumpsquat.webp";
import latestbadges from "../../assets/pictures/latestbadges.webp";
import monalisa from "../../assets/pictures/monalisa.webp";
import motivation from "../../assets/pictures/motivation.webp";
import progress from "../../assets/pictures/progress.webp";
import rank from "../../assets/pictures/rank.webp";
import ready from "../../assets/pictures/ready.webp";
import recentworkout from "../../assets/pictures/recentworkout.webp";
import recommended from "../../assets/pictures/recommended.webp";
import ropping from "../../assets/pictures/ropping.webp";
import running from "../../assets/pictures/running.webp";
import setting from "../../assets/pictures/setting.webp";
import setup from "../../assets/pictures/setup.webp";
import squat from "../../assets/pictures/squat.webp";
import thisweek from "../../assets/pictures/thisweek.webp";
import totalworkout from "../../assets/pictures/totalworkout.webp";
import weeklychallenges from "../../assets/pictures/weeklychallenges.webp";
import weight from "../../assets/pictures/weight.webp";
import yoga from "../../assets/pictures/yoga.webp";
import yoga1 from "../../assets/pictures/yoga1.webp";

export const pictures = {
  benchpress,
  bicepcurls,
  caloriesburned,
  cave,
  chairsquat,
  currentlevel,
  cyclingcrunch,
  dailymotivation,
  exhero,
  experiencepoints,
  food,
  foodbg,
  foodbowl,
  getstarted,
  goals,
  goalsbox,
  hero,
  hourstrained,
  jumpsquat,
  latestbadges,
  monalisa,
  motivation,
  progress,
  rank,
  ready,
  recentworkout,
  recommended,
  ropping,
  running,
  setting,
  setup,
  squat,
  thisweek,
  totalworkout,
  weeklychallenges,
  weight,
  yoga,
  yoga1,
} as const;

export type PictureName = keyof typeof pictures;
