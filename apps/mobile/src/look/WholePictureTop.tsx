import type { ReactNode } from "react";
import { Image, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sizes, wholePictureFade } from "./colours";
import { wholePictureHeight } from "./sizing";

/** A page's own picture shown WHOLE (an exercise's, 62a, as drawn): never cut, nothing over the person. Its own colour
 *  round its edge (`ground`, measured from the picture) runs from the top of the phone and to both sides, so it is never
 *  a box; the page's top buttons sit above it and the page's words come under it. */
export function WholePictureTop({ uri, width, height, ground, above, testID }: { uri: string; width: number; height: number; ground: string; above?: ReactNode; testID?: string }) {
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  // The phone's clock, then the row of the close button.
  const over = insets.top + 8 + sizes.press + 8;
  const shown = wholePictureHeight(screen.width, screen.height, { width, height }, over);
  return (
    // The picture's own colour, read from the picture: the one colour a screen takes from data.
    <View style={[styles.band, { backgroundColor: ground, paddingTop: over }]}>
      <Image testID={testID} source={{ uri }} resizeMode="contain" style={[styles.picture, { height: shown }]} accessible={false} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.fade]} />
      {above === undefined ? null : <View style={[styles.above, { top: insets.top + 8 }]}>{above}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { paddingBottom: 16 },
  picture: { width: "100%" },
  fade: { experimental_backgroundImage: wholePictureFade },
  // Beside the close button, on the right of the same row.
  above: { position: "absolute", left: sizes.press + 16, right: sizes.edge, minHeight: sizes.press, justifyContent: "center" },
});
