import type { ReactNode } from "react";
import { Image, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pictureFadeUnderWords, sizes } from "./colours";
import { pictures, type PictureName } from "./pictures";
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
}

/** A page's own picture: edge to edge from the top of the phone, running into the page under it.
 *  Never a box of its own. The page's first words lie over it. */
export function PictureTop({ picture, tall, above, eyebrow, title, foot }: PictureTopProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return (
    <View style={{ height: Math.round(width * tall) }}>
      <Image source={pictures[picture]} resizeMode="cover" style={styles.photo} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.fade]} />
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
  // A picture has a size of its own, so it is told the band's; "cover" then cuts it to fit.
  photo: { position: "absolute", width: "100%", height: "100%" },
  fade: { experimental_backgroundImage: pictureFadeUnderWords },
  above: { position: "absolute", left: sizes.edge, right: sizes.edge },
  words: { position: "absolute", left: sizes.edge, right: sizes.edge, bottom: 6, gap: 8 },
});
