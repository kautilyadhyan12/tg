import { useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, StyleSheet, View, type GestureResponderEvent } from "react-native";
import { DOUBLE_TAP_MS, TAP_MOVES_LESS_THAN, ZOOM_DOUBLE_TAP, clampScale, clampShift, fingersApart } from "./zoom";

interface ZoomPhotoProps {
  children: ReactNode;
  /** One finger on a photo at its own size moves the pages, this far so far. */
  onSlide: (dx: number) => void;
  /** And let go, at this speed. */
  onSlideEnd: (dx: number, vx: number) => void;
}

/** A photo that zooms under two fingers, moves under one while zoomed, and zooms or goes back on a double tap
 *  (Kd, 2026-10-30). Every touch is this one's from the start: a native list that slides would take a pinch's
 *  first finger before the second lands, so the pages' sliding is said from here too. React Native's own zoom is
 *  the iPhone's alone, and no package is needed for this. */
export function ZoomPhoto({ children, onSlide, onSlideEnd }: ZoomPhotoProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const box = useRef(size);
  box.current = size;
  const told = useRef({ onSlide, onSlideEnd });
  told.current = { onSlide, onSlideEnd };
  const scale = useRef(new Animated.Value(1)).current;
  const shiftX = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const now = useRef({ scale: 1, x: 0, y: 0 });
  const start = useRef({ scale: 1, x: 0, y: 0, apart: 0, dx: 0, dy: 0 });
  // This touch has been two fingers or a zoomed photo's: it slides nothing, even once it is one finger at its own size.
  const zooming = useRef(false);
  const sliding = useRef(false);
  // The touch being watched for a double tap; null once it is not a tap.
  const tap = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);

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
  const begin = (apart: number, dx: number, dy: number) => {
    start.current = { ...now.current, apart, dx, dy };
  };
  const fingers = (e: GestureResponderEvent) => e.nativeEvent.touches;
  const endSlide = (dx: number, vx: number) => {
    if (!sliding.current) return;
    sliding.current = false;
    told.current.onSlideEnd(dx, vx);
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const [a, b] = fingers(e);
        zooming.current = now.current.scale > 1 || b !== undefined;
        sliding.current = false;
        begin(a !== undefined && b !== undefined ? fingersApart(a, b) : 0, 0, 0);
      },
      onPanResponderMove: (e, gesture) => {
        const [a, b] = fingers(e);
        if (a !== undefined && b !== undefined) {
          // A second finger takes back any slide begun.
          endSlide(0, 0);
          zooming.current = true;
          const apart = fingersApart(a, b);
          // The second finger has just come down: from here.
          if (start.current.apart === 0) begin(apart, gesture.dx, gesture.dy);
          show({ ...start.current, scale: clampScale((start.current.scale * apart) / Math.max(1, start.current.apart)) });
          return;
        }
        // One finger left after two: it goes on from where it is.
        if (start.current.apart !== 0) begin(0, gesture.dx, gesture.dy);
        if (now.current.scale > 1) {
          show({ scale: now.current.scale, x: start.current.x + gesture.dx - start.current.dx, y: start.current.y + gesture.dy - start.current.dy });
        } else if (!zooming.current) {
          sliding.current = true;
          told.current.onSlide(gesture.dx);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        endSlide(gesture.dx, gesture.vx);
        if (now.current.scale <= 1) show({ scale: 1, x: 0, y: 0 });
      },
      onPanResponderTerminate: () => {
        endSlide(0, 0);
      },
    }),
  ).current;

  return (
    <View
      testID="zoom-photo"
      style={styles.frame}
      onLayout={(e) => {
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
      }}
      onTouchStart={(e) => {
        const { touches, pageX, pageY } = e.nativeEvent;
        tap.current = touches.length >= 2 ? null : { x: pageX, y: pageY };
      }}
      onTouchEnd={(e) => {
        const { touches, pageX, pageY } = e.nativeEvent;
        if (touches.length > 0) return;
        const from = tap.current;
        tap.current = null;
        if (from === null || Math.abs(pageX - from.x) >= TAP_MOVES_LESS_THAN || Math.abs(pageY - from.y) >= TAP_MOVES_LESS_THAN) return;
        const at = Date.now();
        if (at - lastTap.current < DOUBLE_TAP_MS) {
          lastTap.current = 0;
          show(now.current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: ZOOM_DOUBLE_TAP, x: 0, y: 0 });
        } else {
          lastTap.current = at;
        }
      }}
      {...responder.panHandlers}
    >
      <Animated.View style={[styles.fill, { transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }] }]}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A zoomed photo stays on its own page.
  frame: { width: "100%", height: "100%", overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
});
