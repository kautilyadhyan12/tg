import type { ReactNode } from "react";
import { Animated, Image, StyleSheet, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { colours, floatFade, sizes } from "../../look/colours";
import { useLoop } from "../../look/Motion";
import { pictures } from "../../look/pictures";
import { pictureTopHeight } from "../../look/sizing";
import { Txt } from "../../look/Txt";

// The Food tab's own picture (32c-i, Kd's drawing of 2026-11-14): his floating bowl, its ingredients flying
// up out of it, in warm light on the page's black; joyful, never gloomy, as food should be. Edge to edge
// from the top of the phone and into the page under it; the page's first words lie over its foot.

const BOWL = { width: 481, height: 700 };
const TALL = 0.95;

export function FoodTop({ eyebrow, title, foot }: { eyebrow: string; title: string; foot: ReactNode }) {
  const { width, height } = useWindowDimensions();
  const tall = pictureTopHeight(width, height, TALL);
  const bowlHigh = tall * 0.94;
  const bowlWide = (bowlHigh * BOWL.width) / BOWL.height;
  // The bowl bobs slowly, as if it floats; still where the phone asks for no motion.
  const bob = useLoop(2600);
  const lift = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -6] });
  return (
    <View style={{ height: tall }}>
      <View style={[StyleSheet.absoluteFill, styles.clip]}>
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="foodSun" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colours.foodSun} stopOpacity={0.62} />
              <Stop offset="0.55" stopColor={colours.orange} stopOpacity={0.24} />
              <Stop offset="1" stopColor={colours.orange} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="foodLeaf" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colours.foodLeaf} stopOpacity={0.2} />
              <Stop offset="1" stopColor={colours.foodLeaf} stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="foodTomato" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={colours.foodTomato} stopOpacity={0.22} />
              <Stop offset="1" stopColor={colours.foodTomato} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={width * 0.86} cy={tall * 0.22} r={width * 0.7} fill="url(#foodSun)" />
          <Circle cx={width * 0.02} cy={tall * 0.3} r={width * 0.45} fill="url(#foodLeaf)" />
          <Circle cx={width * 0.72} cy={tall * 0.96} r={width * 0.34} fill="url(#foodTomato)" />
        </Svg>
        <Animated.View style={[styles.bowl, { width: bowlWide, height: bowlHigh, top: tall * 0.08, right: -bowlWide * 0.07, transform: [{ translateY: lift }] }]}>
          <Image source={pictures.foodfloat} resizeMode="contain" style={styles.fill} accessible={false} />
        </Animated.View>
      </View>
      <View style={[StyleSheet.absoluteFill, styles.fade]} />
      <View style={styles.words}>
        <Txt kind="eyebrow">{eyebrow}</Txt>
        <Txt kind="h1" style={styles.title}>
          {title}
        </Txt>
        {foot}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  bowl: { position: "absolute" },
  fill: { width: "100%", height: "100%" },
  fade: { experimental_backgroundImage: floatFade },
  words: { position: "absolute", left: sizes.edge, right: sizes.edge, bottom: 10, gap: 8 },
  title: { maxWidth: 220, textShadowColor: colours.wordShadow, textShadowRadius: 14 },
});
