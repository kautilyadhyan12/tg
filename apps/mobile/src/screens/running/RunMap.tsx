// A run on the map (ROADMAP Stage 5 37b-i, Kd's drawings of 2026-11-06): the streets where the person
// ran, in the app's own colours, light by day and dark at night, with the run's trail, a stone at each
// exact kilometre or mile, and while the run goes on a light at its front beaming the way they head.
// The map asks the map's own address for squares of map and letters and nothing else: the trail is
// drawn here, on the phone, from the run it holds.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Camera, GeoJSONSource, Layer, Map as MapView, Marker, type CameraStop, type LngLat } from "@maplibre/maplibre-react-native";
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg";
import type { MapSource, Units } from "@app/shared";
import { colours, sizes, trailColours } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { useLoop, useMotion } from "../../look/Motion";
import { Txt } from "../../look/Txt";
import { mapScheme } from "./daylight";
import { baseMapStyle, mapFonts, type MapScheme } from "./mapStyle";
import { mapColoursChoice, subscribeRun } from "./recorder";
import { endShapes, frontBearing, runBounds, stoneShapes, trailShapes } from "./runMapShapes";

/** "live": the run going on, following its front. "box": the summary's map, still, opened by a tap.
 *  "full": the summary's map on the whole screen, to pinch and move. */
export type RunMapMode = "live" | "box" | "full";

/** The closest the map comes: a walk round a room is a few metres in the middle, never a blur. */
const NEAREST_ZOOM = 17.5;
/** How close the map follows a run going on. */
const FOLLOW_ZOOM = 16.2;

/** Light or dark, by the person's choice and the sun where the run is; looked at again each minute. */
export function useMapScheme(where: readonly [number, number] | null): MapScheme {
  const choice = useSyncExternalStore(subscribeRun, mapColoursChoice);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return mapScheme(choice, where, now, new Date(now).getHours());
}

interface RunMapProps {
  track: readonly (readonly [number, number])[];
  starts: readonly number[];
  units: Units;
  mode: RunMapMode;
  scheme: MapScheme;
  source: MapSource;
  /** Room kept free at the foot of the map (the run's numbers over it), so the front stays in sight. */
  under?: number;
  /** Room kept free at the top (the phone's clock and the page's buttons over it). */
  over?: number;
  /** The box's tap: opens the map full size. */
  onOpen?: () => void;
  testID?: string;
}

export function RunMap({ track, starts, units, mode, scheme, source, under = 0, over = 0, onOpen, testID }: RunMapProps) {
  const style = useMemo(() => baseMapStyle(source, scheme), [source, scheme]);
  const trail = useMemo(() => trailShapes(track, starts), [track, starts]);
  const stones = useMemo(() => (mode === "live" ? null : stoneShapes(track, starts, units)), [mode, track, starts, units]);
  const ends = useMemo(() => endShapes(track, mode !== "live"), [track, mode]);
  const bounds = useMemo(() => runBounds(track), [track]);
  const front = track[track.length - 1];
  const bearing = mode === "live" ? frontBearing(track, starts) : null;
  const [following, setFollowing] = useState(true);
  const t = trailColours[scheme];
  const bold = mapFonts(source.maker).bold;
  const still = mode === "box";

  const frontLat = front?.[0];
  const frontLng = front?.[1];
  const centre = useMemo((): LngLat | null => (frontLat === undefined || frontLng === undefined ? null : [frontLng, frontLat]), [frontLat, frontLng]);
  // Worked out again only when the front moves or the map is resized: the page draws every second.
  const camera = useMemo((): CameraStop | null => {
    if (mode === "live") {
      // Following the front until the person moves the map themselves; Follow me brings it back.
      return following && centre !== null ? { center: centre, zoom: FOLLOW_ZOOM, padding: { top: over, bottom: under }, duration: 700, easing: "ease" } : null;
    }
    if (bounds === null) return null;
    return { bounds, padding: mode === "box" ? { top: 28, bottom: 28, left: 28, right: 28 } : { top: over + 40, bottom: under + 48, left: 36, right: 36 }, duration: 0 };
  }, [mode, following, centre, bounds, over, under]);

  return (
    <View style={styles.fill} testID={testID}>
      <MapView
        testID={`${testID ?? "run-map"}-view`}
        style={styles.fill}
        mapStyle={style}
        attribution={false}
        logo={false}
        compass={false}
        scaleBar={false}
        dragPan={!still}
        touchZoom={!still}
        doubleTapZoom={!still}
        doubleTapHoldZoom={!still}
        touchRotate={false}
        touchPitch={false}
        onRegionWillChange={(event) => {
          if (mode === "live" && event.nativeEvent.userInteraction) setFollowing(false);
        }}
      >
        <Camera maxZoom={NEAREST_ZOOM} {...(camera ?? {})} />
        <GeoJSONSource id="run-trail" data={trail}>
          <Layer id="trail-glow" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": t.glow, "line-opacity": scheme === "light" ? 0.35 : 0.2, "line-width": 18, "line-blur": 7 }} />
          <Layer id="trail-edge" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": t.edge, "line-width": scheme === "light" ? 8.5 : 7, "line-blur": scheme === "light" ? 0 : 2 }} />
          <Layer
            id="trail-core"
            type="line"
            layout={{ "line-cap": "round", "line-join": "round" }}
            paint={{ "line-color": ["interpolate", ["linear"], ["get", "p"], 0, t.from, 0.6, t.mid, 1, t.to], "line-width": scheme === "light" ? 5 : 3.5 }}
          />
          {scheme === "light" ? <Layer id="trail-shine" type="line" layout={{ "line-cap": "round", "line-join": "round" }} paint={{ "line-color": t.shine, "line-width": 1.6, "line-opacity": 0.95 }} /> : null}
        </GeoJSONSource>
        {stones === null ? null : (
          <GeoJSONSource id="run-stones" data={stones}>
            <Layer id="stone" type="circle" paint={{ "circle-radius": 10.5, "circle-color": t.stone, "circle-stroke-color": t.stoneRing, "circle-stroke-width": 1.8 }} />
            <Layer
              id="stone-number"
              type="symbol"
              layout={{ "text-field": ["get", "n"], "text-font": [bold], "text-size": 10.5, "text-allow-overlap": true, "text-ignore-placement": true }}
              paint={{ "text-color": t.stoneWord }}
            />
          </GeoJSONSource>
        )}
        <GeoJSONSource id="run-ends" data={ends}>
          <Layer
            id="end"
            type="circle"
            paint={{ "circle-radius": 7, "circle-color": ["match", ["get", "n"], "start", t.start, t.finish], "circle-stroke-color": t.endRing, "circle-stroke-width": 2.5 }}
          />
        </GeoJSONSource>
        {mode === "live" && centre !== null ? (
          <Marker lngLat={centre} anchor="center">
            <FrontLight bearing={bearing} scheme={scheme} />
          </Marker>
        ) : null}
      </MapView>
      {mode === "box" ? (
        // The whole box is the button, over the map, so only a press begun on it opens it: the map's
        // own tap took the Finish press under it for one (found on Kd's phone, 2026-11-06).
        <Pressable accessibilityRole="button" accessibilityLabel="Open the map full size" onPress={onOpen} style={StyleSheet.absoluteFill}>
          <View style={styles.open}>
            <Icon name="expand" size={17} />
          </View>
        </Pressable>
      ) : null}
      {mode === "live" && !following ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Follow me"
          onPress={() => {
            setFollowing(true);
          }}
          style={[styles.follow, { bottom: under + 44 }]}
        >
          <Icon name="locate" size={22} />
        </Pressable>
      ) : null}
      <View pointerEvents="none" style={[styles.credit, { bottom: under + 6 }]}>
        <View style={[styles.creditBack, { backgroundColor: t.credit }]}>
          <Txt kind="small" style={[styles.creditWords, { color: t.creditWord }]}>
            {source.credit}
          </Txt>
        </View>
      </View>
    </View>
  );
}

const BEAM = 66;

/** The light at the front: a ring that swells and fades, and a fan of light the way the person heads
 *  (Kd, 37a: "like a beam that moves like in Strava and Google Maps"). */
function FrontLight({ bearing, scheme }: { bearing: number | null; scheme: MapScheme }) {
  const t = trailColours[scheme];
  const motion = useMotion();
  const loop = useLoop(1800);
  const swell = useRef(loop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.6] })).current;
  const fade = useRef(loop.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] })).current;
  return (
    <View style={styles.front} accessible accessibilityLabel="You are here">
      {motion ? <Animated.View style={[styles.pulse, { backgroundColor: t.beam, opacity: fade, transform: [{ scale: swell }] }]} /> : null}
      <Svg width={BEAM * 2} height={BEAM * 2} viewBox={`${String(-BEAM)} ${String(-BEAM)} ${String(BEAM * 2)} ${String(BEAM * 2)}`} style={styles.beam}>
        <Defs>
          <RadialGradient id="beam" cx={0} cy={0} r={BEAM} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={t.beam} stopOpacity={0.6} />
            <Stop offset="1" stopColor={t.beam} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {bearing === null ? null : <Path d={`M0 0 L-28 -${String(BEAM - 6)} A${String(BEAM)} ${String(BEAM)} 0 0 1 28 -${String(BEAM - 6)} Z`} fill="url(#beam)" transform={`rotate(${bearing.toFixed(1)})`} />}
        <Circle r={16} fill={t.beam} fillOpacity={0.22} />
        <Circle r={9} fill={t.front} stroke={t.edge} strokeWidth={3} />
        <Circle r={4.5} fill={t.mid} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  open: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 36,
    height: 36,
    borderRadius: sizes.round,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.veil,
    borderWidth: 1,
    borderColor: colours.grab,
  },
  follow: {
    position: "absolute",
    right: 16,
    width: 48,
    height: 48,
    borderRadius: sizes.round,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.veil,
    borderWidth: 1,
    borderColor: colours.grab,
  },
  // Kept inside the map, wrapping to a second line on a narrow phone rather than running off its edge.
  credit: { position: "absolute", right: 8, left: 8, alignItems: "flex-end" },
  creditBack: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  creditWords: { fontSize: 11, lineHeight: 14 },
  front: { width: BEAM * 2, height: BEAM * 2, alignItems: "center", justifyContent: "center" },
  beam: { position: "absolute" },
  pulse: { position: "absolute", width: 36, height: 36, borderRadius: sizes.round },
});
