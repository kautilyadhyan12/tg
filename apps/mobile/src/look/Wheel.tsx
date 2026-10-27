import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { colours, sizes } from "./colours";
import { Icon, type IconName } from "./Icon";
import { fonts, Txt } from "./Txt";

// A wheel of numbers to flick, with − and + beside it: the browser's setup wheel (Kd,
// 2026-09-10: nothing typed and nothing pre-filled). Until the person picks, it rests dimmed on
// a row that is only shown, and its question reads "Not set". A tap on a number picks it, − and
// + step it, and a flick picks the row it settles on.
//
// A column turns under a finger only once the person has tapped it, and moving the page lets it
// go: setup's pages are taller than a phone, and a column that took every drag over it would set
// an answer while the person was only scrolling down the page. Only the person's own drag picks:
// the wheel moving itself to a row (a units switch, an answer arriving) picks nothing.

const ROW = 40;
const ROWS_SHOWN = 5;
const PAD = ((ROWS_SHOWN - 1) / 2) * ROW;
/** A drag let go slower than this has no flick after it, so it picks where it stopped. */
const STILL = 0.05;

interface Turning {
  /** The column that turns under a finger now, or null. */
  engaged: string | null;
  engage: (id: string) => void;
  release: () => void;
}

const TurningContext = createContext<Turning | null>(null);

/** Holds which column turns under a finger. A page round wheels calls `release` when it moves. */
export function WheelGroup({ children }: { children: (release: () => void) => ReactNode }) {
  const [engaged, setEngaged] = useState<string | null>(null);
  const release = () => {
    setEngaged(null);
  };
  return (
    <TurningContext.Provider value={{ engaged, engage: setEngaged, release }}>{children(release)}</TurningContext.Provider>
  );
}

export interface WheelColumn {
  /** What a screen reader calls the column. */
  label: string;
  values: readonly number[];
  /** The row on show: the answer's, or the resting row while nothing is set. */
  index: number;
  format: (value: number) => string;
  onPick: (index: number) => void;
}

function Column({ label, values, index, format, onPick, active }: WheelColumn & { active: boolean }) {
  const id = useId();
  const group = useContext(TurningContext);
  const [ownEngaged, setOwnEngaged] = useState(false);
  const engaged = group === null ? ownEngaged : group.engaged === id;
  const engage = () => {
    if (group === null) setOwnEngaged(true);
    else group.engage(id);
  };
  const scroller = useRef<ScrollView>(null);
  // The person's own drag, from its start until it settles. Never set by code.
  const dragging = useRef(false);
  const last = values.length - 1;
  const pickAt = (i: number) => {
    onPick(Math.max(0, Math.min(last, i)));
  };

  useEffect(() => {
    scroller.current?.scrollTo({ y: index * ROW, animated: false });
  }, [index, values.length]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!dragging.current) return;
    dragging.current = false;
    pickAt(Math.round(e.nativeEvent.contentOffset.y / ROW));
  };

  return (
    <View style={styles.column}>
      <View pointerEvents="none" style={[styles.band, active ? styles.bandOn : null]} />
      <ScrollView
        ref={scroller}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: active ? format(values[index] ?? 0) : "Not set" }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          pickAt(index + (e.nativeEvent.actionName === "increment" ? 1 : -1));
        }}
        style={[styles.scroller, active ? null : styles.resting]}
        contentContainerStyle={styles.rows}
        contentOffset={{ x: 0, y: index * ROW }}
        scrollEnabled={engaged}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        onScrollBeginDrag={() => {
          // A column nobody tapped never turns; its drag is the page's.
          dragging.current = engaged;
        }}
        onScrollEndDrag={(e) => {
          if (Math.abs(e.nativeEvent.velocity?.y ?? 0) < STILL) settle(e);
        }}
        onMomentumScrollEnd={settle}
      >
        {values.map((value, i) => (
          <Pressable
            key={`${label}-${String(value)}`}
            accessible={false}
            onPress={() => {
              dragging.current = false;
              engage();
              pickAt(i);
            }}
            style={styles.row}
          >
            <Txt style={i === index ? styles.here : styles.away}>{format(value)}</Txt>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

interface WheelProps {
  question: string;
  /** The answer in words, or "Not set". */
  shown: string;
  isSet: boolean;
  unit?: string;
  /** Names the − and + buttons: "Age: one less". */
  stepLabel: string;
  /** −1 or +1: what one step is (a year, a kilo, an inch) is the screen's. */
  onStep: (by: number) => void;
  columns: readonly WheelColumn[];
}

/** A question answered on a wheel of one or more columns: the answer beside the question, − and + either side. */
export function Wheel({ question, shown, isSet, unit, stepLabel, onStep, columns }: WheelProps) {
  const step = (by: number, icon: IconName, words: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${stepLabel}: ${words}`}
      onPress={() => {
        onStep(by);
      }}
      style={({ pressed }) => [styles.step, pressed ? styles.pressed : null]}
    >
      <Icon name={icon} size={20} />
    </Pressable>
  );
  return (
    <View style={styles.wheel}>
      <View style={styles.head}>
        <Txt kind="h3" style={styles.question}>
          {question}
        </Txt>
        <Txt colour={isSet ? "orangeLight" : "textFaint"} style={styles.shown}>
          {shown}
        </Txt>
      </View>
      <View style={styles.body}>
        {step(-1, "minus", "one less")}
        <View style={styles.columns}>
          {columns.map((c) => (
            <Column key={c.label} {...c} active={isSet} />
          ))}
          {unit === undefined ? null : (
            <Txt kind="small" style={styles.unit}>
              {unit}
            </Txt>
          )}
        </View>
        {step(1, "plus", "one more")}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wheel: { gap: 8 },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  question: { flex: 1 },
  shown: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  body: { flexDirection: "row", alignItems: "center", gap: 8 },
  columns: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  column: { flex: 1, height: ROW * ROWS_SHOWN },
  band: {
    position: "absolute",
    left: 0,
    right: 0,
    top: PAD,
    height: ROW,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
  },
  bandOn: { borderColor: colours.orangeLine, backgroundColor: colours.orangeFill },
  scroller: { height: ROW * ROWS_SHOWN },
  resting: { opacity: 0.45 },
  rows: { paddingVertical: PAD },
  row: { height: ROW, alignItems: "center", justifyContent: "center" },
  here: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 22, color: colours.text },
  away: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 20, color: colours.textFaint },
  unit: { paddingHorizontal: 2 },
  step: {
    width: sizes.button,
    height: sizes.button,
    borderRadius: sizes.round,
    borderWidth: 1,
    borderColor: colours.lineStrong,
    backgroundColor: colours.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.85 },
});
