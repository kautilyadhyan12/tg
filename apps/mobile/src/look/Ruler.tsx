import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FlatList,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { colours, scaleFadeLeft, scaleFadeRight } from "./colours";
import { fonts, Txt } from "./Txt";

// A scale to slide, as a bathroom scale or a tape measure reads: ticks running sideways under a
// fixed orange marker, the number above it changing as the scale moves (Kd, 2026-10-27: "the
// scales should be horizontal ... and should actually look like a scale"). Until the person
// slides it the scale rests, faint, on a row that is only shown, and the number reads "Not set":
// nothing is saved until it is moved (Kd, 2026-09-10). Only the person's own slide picks; the
// scale moving itself to a row (a units switch, an answer arriving) picks nothing. A screen
// reader moves it a row at a time.

const TICK = 12;
const HEIGHT = 58;

export interface RulerProps {
  /** The question, and what a screen reader calls the scale. */
  label: string;
  /** One tick a row: the values the scale offers, in order. */
  rows: readonly number[];
  /** The row under the marker: the answer's, or the resting row while nothing is set. */
  index: number;
  isSet: boolean;
  /** The answer in words for a row: "32 years". */
  shown: (row: number) => string;
  /** What the number reads while nothing is set. */
  empty?: string;
  /** The words under a long tick, or null for a short one. */
  major: (row: number) => string | null;
  /** A tick of middle length. */
  mid?: (row: number) => boolean;
  onPick: (index: number) => void;
  /** Beside the number: a "Not sure", say. */
  aside?: ReactNode;
}

export function Ruler({ label, rows, index, isSet, shown, empty = "Not set", major, mid, onPick, aside }: RulerProps) {
  const list = useRef<FlatList<number>>(null);
  const [width, setWidth] = useState(0);
  // The row under the marker while the person slides, so the number follows the finger.
  const [sliding, setSliding] = useState<number | null>(null);
  // The person's own slide, from its start until it settles. Never set by code.
  const dragging = useRef(false);
  const last = rows.length - 1;
  const clamp = (i: number) => Math.max(0, Math.min(last, i));
  const rowAt = (x: number) => clamp(Math.round(x / TICK));

  // Onto the answer's row whenever it changes from outside, and again once the scale knows its own
  // length: placed before its width is known, a row near the end is cut short and left short.
  const place = () => {
    if (!dragging.current) list.current?.scrollToOffset({ offset: index * TICK, animated: false });
  };
  useEffect(place, [index, rows.length, width]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!dragging.current) return;
    dragging.current = false;
    setSliding(null);
    onPick(rowAt(e.nativeEvent.contentOffset.x));
  };

  const pad = Math.max(0, width / 2 - TICK / 2);
  const showing = sliding ?? index;
  const value = rows[showing];
  const words = (sliding !== null || isSet) && value !== undefined ? shown(value) : empty;

  const renderTick = ({ item }: ListRenderItemInfo<number>) => {
    const words_ = major(item);
    const long = words_ !== null;
    const middle = !long && mid?.(item) === true;
    return (
      <View style={styles.cell}>
        <View style={[styles.tick, long ? styles.long : middle ? styles.middle : styles.short]} />
        {long ? (
          <Txt numberOfLines={1} style={styles.tickWords}>
            {words_}
          </Txt>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.ruler}>
      <View style={styles.head}>
        <Txt style={styles.label}>{label}</Txt>
        <View style={styles.right}>
          {aside}
          <Txt style={[styles.value, sliding !== null || isSet ? styles.valueOn : styles.valueOff]}>{words}</Txt>
        </View>
      </View>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: words }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          onPick(clamp(index + (e.nativeEvent.actionName === "increment" ? 1 : -1)));
        }}
        onLayout={(e: LayoutChangeEvent) => {
          setWidth(e.nativeEvent.layout.width);
        }}
        style={styles.track}
      >
        <FlatList
          ref={list}
          testID={`${label} scale`}
          horizontal
          data={rows}
          keyExtractor={(row) => String(row)}
          renderItem={renderTick}
          getItemLayout={(_, i) => ({ length: TICK, offset: TICK * i, index: i })}
          contentContainerStyle={{ paddingHorizontal: pad }}
          contentOffset={{ x: index * TICK, y: 0 }}
          initialNumToRender={60}
          windowSize={5}
          snapToInterval={TICK}
          decelerationRate="fast"
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={32}
          style={isSet || sliding !== null ? null : styles.resting}
          onScrollBeginDrag={() => {
            dragging.current = true;
          }}
          onScroll={(e) => {
            if (dragging.current) setSliding(rowAt(e.nativeEvent.contentOffset.x));
          }}
          onScrollEndDrag={(e) => {
            if (Math.abs(e.nativeEvent.velocity?.x ?? 0) < 0.05) settle(e);
          }}
          onMomentumScrollEnd={settle}
          onContentSizeChange={place}
        />
        <View pointerEvents="none" style={[styles.fade, styles.fadeLeft]} />
        <View pointerEvents="none" style={[styles.fade, styles.fadeRight]} />
        <View pointerEvents="none" style={[styles.marker, { left: width / 2 - 1.5 }, isSet || sliding !== null ? styles.markerOn : null]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ruler: { gap: 6 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  right: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18, color: colours.textSoft },
  value: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 24 },
  valueOn: { color: colours.orangeLight },
  valueOff: { color: colours.textFaint, fontFamily: fonts.medium, fontSize: 15 },
  track: { height: HEIGHT, overflow: "hidden", backgroundColor: colours.page, borderRadius: 12 },
  resting: { opacity: 0.45 },
  cell: { width: TICK, height: HEIGHT, alignItems: "center", overflow: "visible" },
  tick: { width: 1.5, borderRadius: 1, backgroundColor: colours.textFaint },
  short: { height: 12, opacity: 0.6 },
  middle: { height: 18 },
  long: { height: 26, width: 2, backgroundColor: colours.textSoft },
  tickWords: {
    position: "absolute",
    top: 30,
    width: 48,
    left: (TICK - 48) / 2,
    textAlign: "center",
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 14,
    color: colours.textFaint,
  },
  fade: { position: "absolute", top: 0, bottom: 0, width: 40 },
  fadeLeft: { left: 0, experimental_backgroundImage: scaleFadeLeft },
  fadeRight: { right: 0, experimental_backgroundImage: scaleFadeRight },
  marker: { position: "absolute", top: 0, width: 3, height: 34, borderRadius: 2, backgroundColor: colours.textFaint },
  markerOn: { backgroundColor: colours.orange },
});
