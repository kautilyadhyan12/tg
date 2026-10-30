import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { ZOOM_DOUBLE_TAP, clampScale, clampShift } from "./zoom";

interface ZoomPhotoProps {
  children: ReactNode;
  /** Whether the photo is being zoomed or is zoomed: the pages must not slide meanwhile. */
  onHeld: (held: boolean) => void;
}

/** A photo that zooms under two fingers, moves under one while zoomed, and zooms or goes back on a double tap
 *  (Kd, 2026-10-30). The gesture package settles a pinch against the pages' own sliding, on the phone's side. */
export function ZoomPhoto({ children, onHeld }: ZoomPhotoProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const box = useRef(size);
  box.current = size;
  const told = useRef(onHeld);
  told.current = onHeld;
  const [zoomed, setZoomed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const shiftX = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const now = useRef({ scale: 1, x: 0, y: 0 });
  const start = useRef(now.current);

  const gesture = useMemo(() => {
    const show = (next: { scale: number; x: number; y: number }) => {
      const fitted = {
        scale: next.scale,
        x: clampShift(next.x, box.current.width, next.scale),
        y: clampShift(next.y, box.current.height, next.scale),
      };
      now.current = fitted;
      scale.setValue(fitted.scale);
      shiftX.setValue(fitted.x);
      shiftY.setValue(fitted.y);
    };
    const settled = () => {
      if (now.current.scale <= 1) show({ scale: 1, x: 0, y: 0 });
      const isZoomed = now.current.scale > 1;
      setZoomed(isZoomed);
      told.current(isZoomed);
    };
    const pinch = Gesture.Pinch()
      .withTestId("photo-pinch")
      .onStart(() => {
        start.current = now.current;
        told.current(true);
      })
      .onUpdate((e) => {
        show({ ...start.current, scale: clampScale(start.current.scale * e.scale) });
      })
      .onFinalize(settled);
    // Only while zoomed: otherwise one finger belongs to the pages.
    const move = Gesture.Pan()
      .withTestId("photo-move")
      .enabled(zoomed)
      .maxPointers(1)
      .onStart(() => {
        start.current = now.current;
      })
      .onUpdate((e) => {
        show({ ...now.current, x: start.current.x + e.translationX, y: start.current.y + e.translationY });
      });
    const doubleTap = Gesture.Tap()
      .withTestId("photo-double-tap")
      .numberOfTaps(2)
      .onEnd((_, done) => {
        if (!done) return;
        show(now.current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: ZOOM_DOUBLE_TAP, x: 0, y: 0 });
        settled();
      });
    return Gesture.Simultaneous(pinch, move, doubleTap);
  }, [zoomed, scale, shiftX, shiftY]);

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="zoom-photo"
        collapsable={false}
        style={styles.frame}
        onLayout={(e) => {
          setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
        }}
      >
        <Animated.View style={[styles.fill, { transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }] }]}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // A zoomed photo stays on its own page.
  frame: { width: "100%", height: "100%", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
});
