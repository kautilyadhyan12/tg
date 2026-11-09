// The boxes a run is shown in, after Finish (37a) and on its own page in Your runs (37c-i): its
// numbers, its route on the map with the map full size, its kilometres or miles, how it felt and its
// note. Drawn once here, so a saved run reads as its summary did.
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HEIGHT_MAP_CREDITS, type RunSplit, type Units } from "@app/shared";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { Sheet } from "../../look/Sheet";
import { fonts, Txt } from "../../look/Txt";
import { useSession } from "../../session/SessionProvider";
import { useMapSource } from "./mapSource";
import { climbWords, type ClimbShown } from "./runClimb";
import { PaceChart } from "./PaceChart";
import { PaceWave } from "./RunDrawings";
import { RunMap, useMapScheme } from "./RunMap";
import { EFFORT_ENDS, clock, distance, leftOutLine, pace, paceWord, unitWord } from "./runWords";

/** The big distance, the four tiles, the climb, what was paused and what was left out. */
export function RunFigures({ distanceM, movingS, elapsedS, leftOutM, leftOutS, kcal, climb, units }: {
  distanceM: number;
  movingS: number;
  elapsedS: number;
  leftOutM: number;
  leftOutS: number;
  kcal: number;
  climb: ClimbShown;
  units: Units;
}) {
  const [credits, setCredits] = useState(false);
  const insets = useSafeAreaInsets();
  const pausedS = Math.max(0, elapsedS - movingS - leftOutS);
  return (
    <>
      <Txt style={styles.km} fit numberOfLines={1}>
        {distance(distanceM, units)}
        <Txt style={styles.kmUnit}> {unitWord(units)}</Txt>
      </Txt>
      <View style={styles.three}>
        <Tile value={clock(movingS)} label="Moving time" />
        <Tile value={clock(elapsedS)} label="Total time" />
      </View>
      <View style={styles.three}>
        <Tile value={pace(movingS, distanceM < 50 ? 0 : distanceM, units)} label={`Avg pace ${paceWord(units)}`} />
        <Tile value={String(kcal)} label="Calories" />
      </View>
      <View style={[styles.tile, styles.climbTile]}>
        <Txt style={styles.tileValue} fit numberOfLines={1}>
          {climbWords(climb, units)}
        </Txt>
        <Txt kind="small" colour="textFaint">
          Elevation gain
        </Txt>
        {/* The maps' credits behind a small (i), as the run map's own (Kd, 37b-ii's click-through). */}
        {climb.kind === "done" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Elevation data"
            hitSlop={10}
            onPress={() => {
              setCredits(true);
            }}
            style={styles.creditButton}
          >
            <Icon name="info" size={18} />
          </Pressable>
        ) : null}
      </View>
      {pausedS > 0 ? (
        <Txt kind="small" colour="textFaint">
          {`Paused for ${clock(pausedS)}`}
        </Txt>
      ) : null}
      {leftOutM > 0 ? (
        <View style={styles.leftOut}>
          <Icon name="warn" size={18} colour="gold" />
          <Txt kind="small" colour="text" style={styles.grow}>
            {leftOutLine(leftOutM, units)}
          </Txt>
        </View>
      ) : null}
      <Sheet
        open={credits}
        title="Elevation data"
        onClose={() => {
          setCredits(false);
        }}
      >
        <ScrollView style={styles.shrink} contentContainerStyle={[styles.creditList, { paddingBottom: insets.bottom + 16 }]}>
          {HEIGHT_MAP_CREDITS.map((line) => (
            <Txt key={line} kind="small" colour="textSoft">
              {line}
            </Txt>
          ))}
        </ScrollView>
      </Sheet>
    </>
  );
}

/** The route on the map in a box; pressed, the map full size, its name and numbers over it. Nothing at
 *  all for a run with no route. */
export function RouteCard({ track, starts, units, name, distanceM, movingS, testID = "summary-map" }: {
  track: readonly (readonly [number, number])[];
  starts: readonly number[];
  units: Units;
  name: string;
  distanceM: number;
  movingS: number;
  testID?: string;
}) {
  const { session } = useSession();
  const source = useMapSource(session);
  const scheme = useMapScheme(track[track.length - 1] ?? null);
  const insets = useSafeAreaInsets();
  const [big, setBig] = useState(false);
  // The map's own word on its streets (null until it says), so the line below is true whichever failed.
  const [drawn, setDrawn] = useState<boolean | null>(null);
  if (track.length < 2) return null;
  return (
    <View style={styles.card}>
      <Txt kind="h3">Route</Txt>
      <View style={styles.mapBox}>
        <RunMap
          track={track}
          starts={starts}
          units={units}
          mode="box"
          scheme={scheme}
          source={source}
          onOpen={() => {
            setBig(true);
          }}
          onDrawn={setDrawn}
          testID={testID}
        />
      </View>
      {drawn === false ? (
        <Txt kind="small" colour="textFaint" style={styles.centredWords}>
          The map can't load right now.
        </Txt>
      ) : null}
      <Modal
        visible={big}
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => {
          setBig(false);
        }}
      >
        <View style={styles.mapPage}>
          <RunMap track={track} starts={starts} units={units} mode="full" scheme={scheme} source={source} over={insets.top + 56} under={insets.bottom} testID="full-map" />
          <View style={[styles.bigTop, { top: insets.top + 10 }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close the map"
              onPress={() => {
                setBig(false);
              }}
              style={styles.close}
            >
              <Icon name="x" size={20} />
            </Pressable>
            <View style={styles.bigTitle}>
              <Txt kind="body" numberOfLines={1} style={styles.bigName}>
                {name}
              </Txt>
              <Txt kind="small" colour="textSoft">
                {`${distance(distanceM, units)} ${unitWord(units)} · ${clock(movingS)}`}
              </Txt>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Each whole kilometre or mile as a wave; a run under two of them has its pace above instead. */
export function SplitsCard({ splits, units }: { splits: readonly RunSplit[]; units: Units }) {
  if (splits.length < 2) return null;
  return (
    <View style={styles.card}>
      <Txt kind="h3">{units === "imperial" ? "Miles" : "Kilometres"}</Txt>
      <PaceWave splits={[...splits]} units={units} />
      <Txt kind="small" colour="textFaint">
        Higher is faster
      </Txt>
    </View>
  );
}

/** The pace chart (37c-iii); nothing for a run too short for one, or saved before it was kept. */
export function PaceCard({ paceLine, hillLine, distanceM, movingS, units }: { paceLine: readonly number[]; hillLine: readonly number[]; distanceM: number; movingS: number; units: Units }) {
  if (paceLine.length < 2) return null;
  return (
    <View style={styles.card} testID="pace-card">
      <View style={styles.paceHead}>
        <Txt kind="h3">Pace</Txt>
        <Txt kind="small" colour="textFaint">
          {units === "imperial" ? "min/mi" : "min/km"}
        </Txt>
      </View>
      <PaceChart paceLine={paceLine} hillLine={hillLine} distanceM={distanceM} movingS={movingS} units={units} />
    </View>
  );
}

/** How the run felt, 1 to 10; pressed again, a number is taken off. */
export function FeelCard({ effort, onPick }: { effort: number | null; onPick: (effort: number | null) => void }) {
  return (
    <View style={styles.card}>
      <Txt kind="h3">How did it feel?</Txt>
      <View style={styles.feel}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <Pressable
            key={String(n)}
            accessibilityRole="button"
            accessibilityLabel={`${String(n)} of 10`}
            accessibilityState={{ selected: effort === n }}
            onPress={() => {
              onPick(effort === n ? null : n);
            }}
            style={[styles.feelDot, effort === n ? styles.feelPicked : null]}
          >
            <Txt kind="small" colour={effort === n ? "onOrange" : "textSoft"} style={styles.feelNumber}>
              {String(n)}
            </Txt>
          </Pressable>
        ))}
      </View>
      <View style={styles.ends}>
        <Txt kind="small" colour="textFaint">
          {EFFORT_ENDS[0]}
        </Txt>
        <Txt kind="small" colour="textFaint">
          {EFFORT_ENDS[1]}
        </Txt>
      </View>
    </View>
  );
}

/** The run's private note. */
export function NoteCard({ note, onChange }: { note: string; onChange: (note: string) => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.between}>
        <Txt kind="h3">Private note</Txt>
        <Txt kind="small" colour="textFaint">
          Only you see it
        </Txt>
      </View>
      <TextInput
        accessibilityLabel="Private note"
        value={note}
        onChangeText={onChange}
        placeholder="Add a note"
        placeholderTextColor={colours.textFaint}
        maxLength={1000}
        multiline
        style={styles.note}
        selectionColor={colours.orange}
      />
    </View>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Txt style={styles.tileValue} fit numberOfLines={1}>
        {value}
      </Txt>
      <Txt kind="small" colour="textFaint" numberOfLines={2}>
        {label}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  shrink: { flexShrink: 1 },
  creditButton: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    borderRadius: sizes.round,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colours.veil,
    borderWidth: 1,
    borderColor: colours.grab,
  },
  // Room on the right for the (i), so a long number never runs under it.
  climbTile: { paddingRight: 56 },
  creditList: { gap: 12 },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  km: { fontFamily: fonts.bold, fontSize: 72, lineHeight: 80, letterSpacing: -3, color: colours.text },
  kmUnit: { fontFamily: fonts.semibold, fontSize: 26, color: colours.textSoft, letterSpacing: 0 },
  three: { flexDirection: "row", gap: 10 },
  tile: { flex: 1, borderRadius: 16, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 12, gap: 2, minHeight: 72 },
  tileValue: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, color: colours.text },
  leftOut: { flexDirection: "row", gap: 10, alignItems: "flex-start", borderRadius: 16, padding: 13, backgroundColor: colours.goldFill, borderWidth: 1, borderColor: colours.goldLine },
  card: { borderRadius: sizes.boxRadius, backgroundColor: colours.box, borderWidth: 1, borderColor: colours.line, padding: 16, gap: 12 },
  paceHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  mapBox: { height: 250, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: colours.line, backgroundColor: colours.tabBar },
  centredWords: { textAlign: "center" },
  mapPage: { flex: 1, backgroundColor: colours.page },
  bigTop: { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  // Over the map: a round of the page's own dark, so the cross reads on a light map too.
  close: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center", borderRadius: sizes.round, backgroundColor: colours.veil, borderWidth: 1, borderColor: colours.lineStrong },
  bigTitle: { flexShrink: 1, borderRadius: 14, backgroundColor: colours.veil, borderWidth: 1, borderColor: colours.lineStrong, paddingHorizontal: 12, paddingVertical: 6 },
  bigName: { fontFamily: fonts.bold },
  feel: { flexDirection: "row", gap: 5 },
  feelDot: { flex: 1, minHeight: sizes.press, borderRadius: sizes.round, alignItems: "center", justifyContent: "center", backgroundColor: colours.fill, borderWidth: 1, borderColor: colours.line },
  feelPicked: { experimental_backgroundImage: orangeGradient, borderColor: "transparent", boxShadow: shadows.chip },
  feelNumber: { fontFamily: fonts.bold },
  ends: { flexDirection: "row", justifyContent: "space-between" },
  note: { minHeight: 74, borderRadius: 14, backgroundColor: colours.field, borderWidth: 1, borderColor: colours.fieldLine, padding: 14, fontFamily: fonts.regular, fontSize: 15, color: colours.text, textAlignVertical: "top" },
});
