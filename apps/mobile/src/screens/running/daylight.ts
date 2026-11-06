// Light or dark map (ROADMAP Stage 5 37b-i, Kd: "light in morning … dark at night"): light while the
// sun is up where the person is, as Google Maps and Waze switch, worked out on the phone with no
// internet. Pure: the place and the moment are given, so the tests hold it to published times.
import type { MapColours } from "@app/shared";

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** The sun's height above the horizon in degrees, at a place and a moment: NOAA's solar position
 *  (the sums of its Solar Calculator, after Meeus), good to about a minute of the sun's rising. */
export function sunHeight(lat: number, lng: number, atMs: number): number {
  const julianDay = atMs / 86_400_000 + 2_440_587.5;
  const t = (julianDay - 2_451_545) / 36_525;
  const meanLong = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(rad(meanAnomaly)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(rad(2 * meanAnomaly)) * (0.019993 - 0.000101 * t) +
    Math.sin(rad(3 * meanAnomaly)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = meanLong + centre - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(rad(omega));
  const declination = deg(Math.asin(Math.sin(rad(obliquity)) * Math.sin(rad(apparentLong))));
  const y = Math.tan(rad(obliquity / 2)) ** 2;
  const equationOfTime =
    4 *
    deg(
      y * Math.sin(2 * rad(meanLong)) -
        2 * eccentricity * Math.sin(rad(meanAnomaly)) +
        4 * eccentricity * y * Math.sin(rad(meanAnomaly)) * Math.cos(2 * rad(meanLong)) -
        0.5 * y * y * Math.sin(4 * rad(meanLong)) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * rad(meanAnomaly)),
    );
  const minutesUtc = (((atMs % 86_400_000) + 86_400_000) % 86_400_000) / 60_000;
  const solarMinutes = (((minutesUtc + equationOfTime + 4 * lng) % 1440) + 1440) % 1440;
  const hourAngle = solarMinutes / 4 < 0 ? solarMinutes / 4 + 180 : solarMinutes / 4 - 180;
  const cosZenith = Math.sin(rad(lat)) * Math.sin(rad(declination)) + Math.cos(rad(lat)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle));
  return 90 - deg(Math.acos(Math.min(1, Math.max(-1, cosZenith))));
}

/** The sun counts as risen when its top edge clears the horizon: its centre 0.833° below it, the
 *  sun's half-width and the air's bending, as almanacs give sunrise and sunset. */
export const RISEN_DEG = -0.833;

/** Which map to draw: the person's own choice, or by the sun where they are. With no place known yet,
 *  6 am to 6 pm on the phone's own clock. */
export function mapScheme(choice: MapColours, where: readonly [number, number] | null, atMs: number, localHour: number): "light" | "dark" {
  if (choice !== "auto") return choice;
  if (where === null) return localHour >= 6 && localHour < 18 ? "light" : "dark";
  return sunHeight(where[0], where[1], atMs) > RISEN_DEG ? "light" : "dark";
}
