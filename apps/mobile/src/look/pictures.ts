// The member web's own pictures, made small (spec Part 6 §16.3a): 900 pixels on the
// long side, WebP. Made by docs/design/phone/compact.py; never the web's full-size files.
// `getstarted` is the browser's sign-in picture, cut by the same tool to sit at the top of a phone.
import benchpress from "../../assets/pictures/benchpress.webp";
import bicepcurls from "../../assets/pictures/bicepcurls.webp";
import caloriesburned from "../../assets/pictures/caloriesburned.webp";
import chairsquat from "../../assets/pictures/chairsquat.webp";
import currentlevel from "../../assets/pictures/currentlevel.webp";
import cyclingcrunch from "../../assets/pictures/cyclingcrunch.webp";
import dailymotivation from "../../assets/pictures/dailymotivation.webp";
import exhero from "../../assets/pictures/exhero.webp";
import experiencepoints from "../../assets/pictures/experiencepoints.webp";
import food from "../../assets/pictures/food.webp";
import foodbg from "../../assets/pictures/foodbg.webp";
import getstarted from "../../assets/pictures/getstarted.webp";
import hero from "../../assets/pictures/hero.webp";
import hourstrained from "../../assets/pictures/hourstrained.webp";
import jumpsquat from "../../assets/pictures/jumpsquat.webp";
import latestbadges from "../../assets/pictures/latestbadges.webp";
import monalisa from "../../assets/pictures/monalisa.webp";
import progress from "../../assets/pictures/progress.webp";
import rank from "../../assets/pictures/rank.webp";
import ready from "../../assets/pictures/ready.webp";
import recentworkout from "../../assets/pictures/recentworkout.webp";
import recommended from "../../assets/pictures/recommended.webp";
import ropping from "../../assets/pictures/ropping.webp";
import running from "../../assets/pictures/running.webp";
import setting from "../../assets/pictures/setting.webp";
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
  chairsquat,
  currentlevel,
  cyclingcrunch,
  dailymotivation,
  exhero,
  experiencepoints,
  food,
  foodbg,
  getstarted,
  hero,
  hourstrained,
  jumpsquat,
  latestbadges,
  monalisa,
  progress,
  rank,
  ready,
  recentworkout,
  recommended,
  ropping,
  running,
  setting,
  squat,
  thisweek,
  totalworkout,
  weeklychallenges,
  weight,
  yoga,
  yoga1,
} as const;

export type PictureName = keyof typeof pictures;
