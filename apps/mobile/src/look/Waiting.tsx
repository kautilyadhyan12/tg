import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, type DimensionValue } from "react-native";
import { colours } from "./colours";
import { useMotion } from "./Motion";
import { Txt, type TxtKind } from "./Txt";

// What stands where a number or a line is still coming (31h, Kd 2026-11-07): a soft bar, never a
// 0 and never a dash. A 0 there would tell somebody with a 30-day streak they have none. A read that
// failed is not coming: its bar stands still, dimmer, and is read out as "Couldn't load".

/** How tall each kind of words stands, so the bar takes the place the words will take. */
const HEIGHT: Partial<Record<TxtKind, number>> = { hero: 40, h1: 32, h2: 26, h3: 20, big: 26, small: 18, tiny: 16 };

/** A soft bar the size of what is coming, breathing slowly; still where the phone's animations are off,
 *  and still and dim where the read failed. */
export function SoftBar({ kind = "small", width = 56, failed = false }: { kind?: TxtKind; width?: DimensionValue; failed?: boolean }) {
  const on = useMotion() && !failed;
  const glow = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!on) {
      glow.setValue(1);
      return;
    }
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.45, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    breathe.start();
    return () => {
      breathe.stop();
    };
  }, [on, glow]);
  const tall = HEIGHT[kind] ?? 20;
  return (
    <Animated.View
      testID={failed ? "failed-bar" : "soft-bar"}
      accessible
      accessibilityLabel={failed ? "Couldn’t load" : "Loading"}
      style={[styles.bar, failed ? styles.failed : null, { width, height: tall - 6, marginVertical: 3, opacity: glow }]}
    />
  );
}

/** Words, or the soft bar while they are still coming (null), or the still bar where they failed. */
export function Shown({ value, failed = false, kind = "small", width, colour, style, numberOfLines }: { value: string | null; failed?: boolean; kind?: TxtKind; width?: DimensionValue; colour?: Parameters<typeof Txt>[0]["colour"]; style?: Parameters<typeof Txt>[0]["style"]; numberOfLines?: number }) {
  if (value === null) return <SoftBar kind={kind} failed={failed} {...(width === undefined ? {} : { width })} />;
  return (
    <Txt kind={kind} {...(colour === undefined ? {} : { colour })} {...(style === undefined ? {} : { style })} {...(numberOfLines === undefined ? {} : { numberOfLines })}>
      {value}
    </Txt>
  );
}

const styles = StyleSheet.create({
  bar: { borderRadius: 999, backgroundColor: colours.grab },
  failed: { backgroundColor: colours.track },
});
