import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, type StyleProp, type ViewStyle } from "react-native";

// The look's motion (35c-i): boxes rise in, numbers count up, bars grow. React Native's own
// Animated, so no package is added. Off where the phone's "Remove animations" is on, and in the
// screen tests, which read the finished screen.

let allowed = true;
/** The screen tests turn motion off once (test/screens/setup.js), so a number is never read mid-count. */
export function setMotionAllowed(on: boolean) {
  allowed = on;
}

/** Whether the screen may move: the phone's Reduce motion setting is read and followed while it changes. */
export function useMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduced(on);
    });
    const heard = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      alive = false;
      heard.remove();
    };
  }, []);
  return allowed && !reduced;
}

const EASE = Easing.out(Easing.cubic);

/** A box that fades in and rises 18 points, `delay` ms after it is drawn. */
export function Rise({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const on = useMotion();
  const shown = useRef(new Animated.Value(on ? 0 : 1)).current;
  useEffect(() => {
    if (!on) {
      shown.setValue(1);
      return;
    }
    const run = Animated.timing(shown, { toValue: 1, duration: 480, delay, easing: EASE, useNativeDriver: true });
    run.start();
    return () => {
      run.stop();
    };
  }, [on, delay, shown]);
  const rise = shown.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  return <Animated.View style={[style, { opacity: shown, transform: [{ translateY: rise }] }]}>{children}</Animated.View>;
}

/** A number counted up from 0 to `to` over `duration` ms; with no motion, `to` at once. */
export function useCountUp(to: number, delay = 0, duration = 900): number {
  const on = useMotion();
  const [now, setNow] = useState(on ? 0 : to);
  useEffect(() => {
    if (!on || to === 0) {
      setNow(to);
      return;
    }
    const value = new Animated.Value(0);
    const heard = value.addListener(({ value: v }) => {
      setNow(v);
    });
    const run = Animated.timing(value, { toValue: to, duration, delay, easing: EASE, useNativeDriver: false });
    run.start(() => {
      setNow(to);
    });
    return () => {
      run.stop();
      value.removeListener(heard);
    };
  }, [on, to, delay, duration]);
  return now;
}

/** A share from 0 to 1 that grows to `to`: for a bar, a line or a ring drawn as it fills. */
export function useGrow(to: number, delay = 0, duration = 700): Animated.Value {
  const on = useMotion();
  const value = useRef(new Animated.Value(on ? 0 : to)).current;
  useEffect(() => {
    if (!on) {
      value.setValue(to);
      return;
    }
    value.setValue(0);
    const run = Animated.timing(value, { toValue: to, duration, delay, easing: EASE, useNativeDriver: false });
    run.start();
    return () => {
      run.stop();
    };
  }, [on, to, delay, duration, value]);
  return value;
}

/** A bar that grows up from its foot, `delay` ms after it is drawn. */
export function GrowUp({ delay = 0, style, children }: { delay?: number; style?: StyleProp<ViewStyle>; children?: ReactNode }) {
  const on = useMotion();
  const grown = useRef(new Animated.Value(on ? 0 : 1)).current;
  useEffect(() => {
    if (!on) {
      grown.setValue(1);
      return;
    }
    const run = Animated.timing(grown, { toValue: 1, duration: 620, delay, easing: EASE, useNativeDriver: true });
    run.start();
    return () => {
      run.stop();
    };
  }, [on, delay, grown]);
  return <Animated.View style={[style, { transformOrigin: "bottom", transform: [{ scaleY: grown }] }]}>{children}</Animated.View>;
}

/** A value that runs from 0 to 1 and back, over and over, `duration` ms each way: a picture's slow
 *  zoom, a glow that breathes. Still at 0 where there is no motion. */
export function useLoop(duration: number): Animated.Value {
  const on = useMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) {
      value.setValue(0);
      return;
    }
    const run = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    run.start();
    return () => {
      run.stop();
    };
  }, [on, duration, value]);
  return value;
}
