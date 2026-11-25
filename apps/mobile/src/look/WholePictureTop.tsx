import type { ReactNode } from "react";
import { Image, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sizes, wholePictureFade } from "./colours";
import { wholePictureHeight } from "./sizing";

/** A page's own picture shown WHOLE (an exercise's, 62a, as drawn): never cut, nothing over the person. Its own colour
 *  round its edge (`ground`, measured from the picture) runs from the top of the phone and to both sides, so it is never
 *  a box; the page's top buttons sit above it and the page's words come under it. `over` is laid on the picture in the
 *  same box (the exercise's clip, 62b); `corner` sits at the band's foot on `cornerSide` (the clip's pause button, kept off
 *  KWAZO's corner). */
export function WholePictureTop({
  uri,
  width,
  height,
  ground,
  above,
  over,
  corner,
  cornerSide = "right",
  testID,
}: {
  uri: string;
  width: number;
  height: number;
  ground: string;
  above?: ReactNode;
  over?: ReactNode;
  corner?: ReactNode;
  cornerSide?: "left" | "right";
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  // The phone's clock, then the row of the close button.
  const top = insets.top + 8 + sizes.press + 8;
  const shown = wholePictureHeight(screen.width, screen.height, { width, height }, top);
  return (
    // The picture's own colour, read from the picture: the one colour a screen takes from data.
    <View style={[styles.band, { backgroundColor: ground, paddingTop: top }]}>
      <View style={{ height: shown }}>
        <Image testID={testID} source={{ uri }} resizeMode="contain" style={styles.picture} accessible={false} />
        {over}
      </View>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fade]} />
      {above === undefined ? null : <View style={[styles.above, { top: insets.top + 8 }]}>{above}</View>}
      {corner === undefined ? null : <View style={[styles.corner, cornerSide === "left" ? styles.cornerLeft : styles.cornerRight]}>{corner}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { paddingBottom: 16 },
  picture: { width: "100%", height: "100%" },
  fade: { experimental_backgroundImage: wholePictureFade },
  // Beside the close button, on the right of the same row.
  above: { position: "absolute", left: sizes.press + 16, right: sizes.edge, minHeight: sizes.press, justifyContent: "center" },
  corner: { position: "absolute", bottom: 22 },
  cornerLeft: { left: sizes.edge },
  cornerRight: { right: sizes.edge },
});
