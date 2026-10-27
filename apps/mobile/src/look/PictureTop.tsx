import type { ReactNode } from "react";
import { Image, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pictureFadeLight, pictureFadeUnderWords, sizes } from "./colours";
import { pictures, type PictureName } from "./pictures";
import { pictureTopHeight } from "./sizing";
import { Txt } from "./Txt";

interface PictureTopProps {
  picture: PictureName;
  /** Its height for the phone's width: 0.6 is a band, 0.9 nearly a square. */
  tall: number;
  /** Over its top, under the phone's clock: who the page greets. */
  above?: ReactNode;
  eyebrow?: string;
  title?: string;
  /** At its foot, under the title's place: the page's one thing to do. */
  foot?: ReactNode;
  /** "light": darkened only at its very foot and top, for a picture whose own light is the point. */
  fade?: "words" | "light";
}

/** A page's own picture: edge to edge from the top of the phone, running into the page under it.
 *  Never a box of its own. The page's first words lie over it. On a wide screen it takes part of the
 *  screen's height and keeps its foot, where its figures and words are. */
export function PictureTop({ picture, tall, above, eyebrow, title, foot, fade = "words" }: PictureTopProps) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const full = Math.round(width * tall);
  return (
    <View style={[styles.band, { height: pictureTopHeight(width, height, tall) }]}>
      <Image source={pictures[picture]} resizeMode="cover" style={[styles.photo, { height: full }]} accessible={false} />
      <View style={[StyleSheet.absoluteFill, fade === "light" ? styles.fadeLight : styles.fade]} />
      {above === undefined ? null : <View style={[styles.above, { top: insets.top + 12 }]}>{above}</View>}
      {eyebrow === undefined && title === undefined && foot === undefined ? null : (
        <View style={styles.words}>
          {eyebrow === undefined ? null : <Txt kind="eyebrow">{eyebrow}</Txt>}
          {title === undefined ? null : <Txt kind="h2">{title}</Txt>}
          {foot}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  band: { overflow: "hidden" },
  // A picture has a size of its own, so it is told its shape for the width; "cover" then cuts it to
  // fit, and a band shorter than it shows its foot.
  photo: { position: "absolute", left: 0, right: 0, bottom: 0, width: "100%" },
  fade: { experimental_backgroundImage: pictureFadeUnderWords },
  fadeLight: { experimental_backgroundImage: pictureFadeLight },
  above: { position: "absolute", left: sizes.edge, right: sizes.edge },
  words: { position: "absolute", left: sizes.edge, right: sizes.edge, bottom: 6, gap: 8 },
});
