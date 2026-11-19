import type { PhoneLibraryEntry } from "@app/shared";
import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../look/Button";
import { Segments } from "../../look/Choice";
import { colours, sizes, stageGlow } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Modal } from "../../look/Modal";
import { Txt } from "../../look/Txt";
import { figureName, muscleAt, type Sex, type Side } from "../../library/figure";
import { pickedShapes, NO_FILTERS, roleOf, valuesOf } from "../../library/filters";
import { DOUBLE_TAP_ZOOM, fitFigure, settle, toDrawing, WHOLE, zoomAbout, type View as Zoom } from "../../library/stage";
import { levelWord, muscleFamily, muscleTitle, targetLine } from "../../library/words";
import { MuscleFigure } from "./MuscleFigure";

/** How far a finger may move, in points, and still be a tap. */
const TAP_STILL = 10;

const SIDES = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
] as const;

/** Find by muscle (63b, Kd's go on the second drawing of 2026-11-19): the person's own body filling the screen, zoomed
 *  by two fingers or a double tap and moved by one; one tap picks the exact muscle under it and the same tap lets it
 *  go; its exercises show at once underneath, each opening its page. `list`: the exercises to look among (the
 *  Library's search and other filters kept). `act`: what the panel's button does with the muscle — show it on the
 *  Library, or take it back to Filters. */
export function FindByMuscle({
  open,
  sex,
  list,
  first,
  act,
  onAct,
  onOpen,
  onClose,
}: {
  open: boolean;
  sex: Sex;
  list: readonly PhoneLibraryEntry[];
  first: string | null;
  act: "Show in Library" | "Use this muscle";
  onAct: (muscle: string) => void;
  /** Opens an exercise's page; without it the rows are lines, not buttons (choosing a muscle for Filters). */
  onOpen?: (id: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: screen } = useWindowDimensions();
  const [side, setSide] = useState<Side>("front");
  const [picked, setPicked] = useState<string | null>(first);
  const [seen, setSeen] = useState(first !== null);
  const [shown, setShown] = useState(open);
  // Each opening starts from what the opener holds, at the body's own size.
  if (open !== shown) {
    setShown(open);
    if (open) {
      setPicked(first);
      setSeen(first !== null);
    }
  }
  const found = picked === null ? [] : list.filter((e) => valuesOf(e, "muscle").includes(picked));
  const family = picked === null ? null : muscleFamily(picked);

  return (
    <Modal visible={open} animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {/* A window of its own on Android: its gestures need their own root there. */}
      <GestureHandlerRootView testID="muscle-gesture-root" style={[styles.page, { paddingTop: insets.top + 8 }]} accessibilityViewIsModal>
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
            <Icon name="x" size={20} />
          </Pressable>
          <Txt kind="h3" numberOfLines={1} style={styles.title}>
            Find by muscle
          </Txt>
          <View style={styles.sides}>
            <Segments options={SIDES} selected={side} onPick={setSide} />
          </View>
        </View>
        <Body
          key={side}
          sex={sex}
          side={side}
          picked={picked}
          hint={!seen}
          onTap={(m) => {
            setSeen(true);
            setPicked((now) => (now === m ? null : m));
          }}
          onZoom={() => {
            setSeen(true);
          }}
        />
        {/* Tall enough for a muscle, its count and a row from the start, so the body keeps its size when one is picked. */}
        <View style={[styles.panel, { paddingBottom: insets.bottom + 16, minHeight: Math.round(screen * 0.3), maxHeight: Math.round(screen * 0.42) }]}>
          <View style={styles.grab} />
          {picked === null ? (
            <>
              <Txt kind="h2">Tap a muscle</Txt>
              <Txt>Its exercises show here.</Txt>
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.found} showsVerticalScrollIndicator={false}>
              {family === null ? null : <Txt kind="eyebrow">{family}</Txt>}
              <Txt kind="h2">{muscleTitle(picked)}</Txt>
              <Txt>{found.length === 0 ? "No exercises for this muscle yet." : `${String(found.length)} ${found.length === 1 ? "exercise" : "exercises"}`}</Txt>
              {found.map((e) => {
                const meta = [roleOf(e, picked), levelWord(e.level), targetLine(e)].filter((x) => x !== null).join(" · ");
                if (onOpen === undefined) {
                  return (
                    <View key={e.id} style={styles.row} accessible accessibilityLabel={`${e.text.en.name}, ${meta}`}>
                      <View style={styles.grow}>
                        <Txt kind="strong">{e.text.en.name}</Txt>
                        <Txt>{meta}</Txt>
                      </View>
                    </View>
                  );
                }
                return (
                  <Pressable
                    key={e.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${e.text.en.name}, ${meta}`}
                    onPress={() => {
                      onOpen(e.id);
                    }}
                    style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
                  >
                    <View style={styles.grow}>
                      <Txt kind="strong">{e.text.en.name}</Txt>
                      <Txt>{meta}</Txt>
                    </View>
                    <Icon name="go" size={18} colour="textFaint" />
                  </Pressable>
                );
              })}
              {found.length === 0 ? null : (
                <Button
                  label={act}
                  kind="link"
                  style={styles.act}
                  onPress={() => {
                    onAct(picked);
                  }}
                />
              )}
            </ScrollView>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** The body: the person's own figure, the picked muscle lit, zoomed and moved by the fingers. A tap is read here,
 *  against each shape's outline, so a double tap zooms without picking anything. */
function Body({
  sex,
  side,
  picked,
  hint,
  onTap,
  onZoom,
}: {
  sex: Sex;
  side: Side;
  picked: string | null;
  hint: boolean;
  onTap: (muscle: string) => void;
  onZoom: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const box = useRef(size);
  box.current = size;
  const told = useRef({ onTap, onZoom });
  told.current = { onTap, onZoom };
  const [zoomed, setZoomed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const shiftX = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const now = useRef<Zoom>(WHOLE);
  const start = useRef<Zoom>(WHOLE);
  const lit = useMemo(() => pickedShapes({ ...NO_FILTERS, muscle: picked === null ? [] : [picked] }), [picked]);

  const whole = () => {
    now.current = WHOLE;
    scale.setValue(1);
    shiftX.setValue(0);
    shiftY.setValue(0);
    setZoomed(false);
  };

  const gesture = useMemo(() => {
    const show = (next: Zoom) => {
      now.current = next;
      scale.setValue(next.scale);
      shiftX.setValue(next.x);
      shiftY.setValue(next.y);
    };
    const settled = () => {
      if (now.current.scale <= 1.01) show(WHOLE);
      setZoomed(now.current.scale > 1);
    };
    const pinch = Gesture.Pinch()
      .withTestId("muscle-pinch")
      .onStart(() => {
        start.current = now.current;
        told.current.onZoom();
      })
      .onUpdate((e) => {
        show(zoomAbout(start.current, start.current.scale * e.scale, e.focalX, e.focalY, box.current.width, box.current.height));
      })
      .onFinalize(settled);
    // Only while zoomed: at its own size there is nowhere to move it.
    const move = Gesture.Pan()
      .withTestId("muscle-move")
      .enabled(zoomed)
      .maxPointers(1)
      .onStart(() => {
        start.current = now.current;
      })
      .onUpdate((e) => {
        show(settle({ ...now.current, x: start.current.x + e.translationX, y: start.current.y + e.translationY }, box.current.width, box.current.height));
      });
    const doubleTap = Gesture.Tap()
      .withTestId("muscle-double-tap")
      .numberOfTaps(2)
      .maxDistance(TAP_STILL)
      .onEnd((e, done) => {
        if (!done) return;
        told.current.onZoom();
        show(now.current.scale > 1 ? WHOLE : zoomAbout(WHOLE, DOUBLE_TAP_ZOOM, e.x, e.y, box.current.width, box.current.height));
        settled();
      });
    const tap = Gesture.Tap()
      .withTestId("muscle-tap")
      // A finger that moves is moving the body, never picking a muscle.
      .maxDistance(TAP_STILL)
      .onEnd((e, done) => {
        if (!done) return;
        const at = toDrawing(now.current, e.x, e.y, box.current.width, box.current.height);
        const muscle = muscleAt(figureName(sex, side), at.x, at.y);
        if (muscle !== null) told.current.onTap(muscle);
      });
    return Gesture.Simultaneous(pinch, move, Gesture.Exclusive(doubleTap, tap));
  }, [zoomed, sex, side, scale, shiftX, shiftY]);

  const fig = fitFigure(size.width, size.height);
  return (
    <View style={styles.stage}>
      <GestureDetector gesture={gesture}>
        <View
          testID="muscle-stage"
          collapsable={false}
          style={styles.fill}
          onLayout={(e) => {
            setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
          }}
        >
          <Animated.View style={[styles.fill, { transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }] }]}>
            {fig.width === 0 ? null : (
              <View style={{ position: "absolute", left: fig.left, top: fig.top }}>
                <MuscleFigure sex={sex} side={side} lit={lit} width={fig.width} />
              </View>
            )}
          </Animated.View>
        </View>
      </GestureDetector>
      {zoomed ? (
        <Button
          label="Fit body"
          kind="plain"
          small
          compact
          style={styles.fit}
          onPress={whole}
        />
      ) : null}
      {hint ? (
        <View style={styles.hint} pointerEvents="none">
          <Txt kind="small" colour="textSoft">
            Pinch to zoom · tap a muscle
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingBottom: 8 },
  close: { width: sizes.press, height: sizes.press, alignItems: "center", justifyContent: "center", borderRadius: sizes.round },
  title: { flex: 1 },
  sides: { width: 168 },
  stage: { flex: 1, overflow: "hidden", experimental_backgroundImage: stageGlow },
  fill: { width: "100%", height: "100%" },
  fit: { position: "absolute", top: 10, right: 12 },
  hint: { position: "absolute", bottom: 12, alignSelf: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.overPicture },
  panel: { gap: 8, paddingTop: 12, paddingHorizontal: sizes.edge + 2, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: colours.line, backgroundColor: colours.box },
  grab: { width: 40, height: 4, borderRadius: 4, alignSelf: "center", backgroundColor: colours.lineStrong, marginBottom: 4 },
  found: { gap: 8, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: sizes.press + 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.raised },
  grow: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
  act: { alignSelf: "flex-start" },
});
