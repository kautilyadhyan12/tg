import { useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, StyleSheet, View, type GestureResponderEvent } from "react-native";
import { DOUBLE_TAP_MS, TAP_MOVES_LESS_THAN, ZOOM_DOUBLE_TAP, clampScale, clampShift, fingersApart } from "./zoom";

interface ZoomPhotoProps {
  children: ReactNode;
  /** Whether the photo is zoomed or two fingers are on it: the pages must not slide meanwhile. */
  onHeld: (held: boolean) => void;
}

/** A photo that zooms under two fingers, moves under one while zoomed, and zooms or goes back on a double tap
 *  (Kd, 2026-10-30). React Native's own zoom is the iPhone's alone, and no package is needed for this. */
export function ZoomPhoto({ children, onHeld }: ZoomPhotoProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const box = useRef(size);
  box.current = size;
  const scale = useRef(new Animated.Value(1)).current;
  const shiftX = useRef(new Animated.Value(0)).current;
  const shiftY = useRef(new Animated.Value(0)).current;
  const now = useRef({ scale: 1, x: 0, y: 0 });
  const start = useRef({ scale: 1, x: 0, y: 0, apart: 0, dx: 0, dy: 0 });
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
  const held = (fingers: number) => {
    onHeld(fingers >= 2 || now.current.scale > 1);
  };

  const fingers = (e: GestureResponderEvent) => e.nativeEvent.touches;
  // Only two fingers, or a zoomed photo: one finger on a photo at its own size belongs to the pages, which slide under it.
  const mine = (e: GestureResponderEvent) => fingers(e).length >= 2 || now.current.scale > 1;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: mine,
      onMoveShouldSetPanResponder: mine,
      onMoveShouldSetPanResponderCapture: mine,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const [a, b] = fingers(e);
        begin(a !== undefined && b !== undefined ? fingersApart(a, b) : 0, 0, 0);
        held(fingers(e).length);
      },
      onPanResponderMove: (e, gesture) => {
        const [a, b] = fingers(e);
        if (a !== undefined && b !== undefined) {
          const apart = fingersApart(a, b);
          // The second finger has just come down: from here.
          if (start.current.apart === 0) begin(apart, gesture.dx, gesture.dy);
          held(2);
          show({ ...start.current, scale: clampScale((start.current.scale * apart) / Math.max(1, start.current.apart)) });
          return;
        }
        // One finger left after two: it goes on from where it is.
        if (start.current.apart !== 0) begin(0, gesture.dx, gesture.dy);
        if (now.current.scale > 1) {
          show({ scale: now.current.scale, x: start.current.x + gesture.dx - start.current.dx, y: start.current.y + gesture.dy - start.current.dy });
        }
      },
      onPanResponderRelease: () => {
        if (now.current.scale <= 1) show({ scale: 1, x: 0, y: 0 });
        held(0);
      },
      onPanResponderTerminate: () => {
        held(0);
      },
    }),
  ).current;

  return (
    <View
      testID="zoom-photo"
      style={styles.fill}
      onLayout={(e) => {
        setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
      }}
      onTouchStart={(e) => {
        const { touches, pageX, pageY } = e.nativeEvent;
        tap.current = touches.length >= 2 ? null : { x: pageX, y: pageY };
        if (touches.length >= 2) onHeld(true);
      }}
      onTouchEnd={(e) => {
        const { touches, pageX, pageY } = e.nativeEvent;
        if (touches.length > 0) return;
        const from = tap.current;
        tap.current = null;
        if (from !== null && Math.abs(pageX - from.x) < TAP_MOVES_LESS_THAN && Math.abs(pageY - from.y) < TAP_MOVES_LESS_THAN) {
          const at = Date.now();
          if (at - lastTap.current < DOUBLE_TAP_MS) {
            lastTap.current = 0;
            show(now.current.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: ZOOM_DOUBLE_TAP, x: 0, y: 0 });
          } else {
            lastTap.current = at;
          }
        }
        if (now.current.scale <= 1) show({ scale: 1, x: 0, y: 0 });
        held(0);
      }}
      {...responder.panHandlers}
    >
      <Animated.View style={[styles.fill, { transform: [{ translateX: shiftX }, { translateY: shiftY }, { scale }] }]}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { width: "100%", height: "100%" },
});
