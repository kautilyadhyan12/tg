import type { PhoneLibraryEntry } from "@app/shared";
import { useContext, useEffect, useState } from "react";
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from "react-native";
import { pictures } from "../../look/pictures";
import { fetchMedia, keptMedia } from "../../library/media";
import { exercisePicture } from "../../library/pictures";
import { useSession } from "../../session/SessionProvider";
import { CopyContext } from "../ThisCopy";

export type OwnPicture = NonNullable<PhoneLibraryEntry["picture"]>;

/** The exercise's own picture on this phone (62a): its address once it has come, null until then. It is asked for once,
 *  kept by its own name, and never again; one that does not come leaves the app's own picture, and is asked for again
 *  the next time a screen shows the exercise. */
export function useOwnPicture(picture: OwnPicture | null): string | null {
  const { session } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const file = picture?.file ?? null;
  const [uri, setUri] = useState<string | null>(() => (file === null ? null : keptMedia(file)));
  useEffect(() => {
    if (file === null) {
      setUri(null);
      return undefined;
    }
    const kept = keptMedia(file);
    setUri(kept);
    if (kept !== null || apiUrl === "") return undefined;
    const live = { now: true };
    fetchMedia(apiUrl, file, session).then(
      (got) => {
        if (live.now) setUri(got);
      },
      () => undefined,
    );
    return () => {
      live.now = false;
    };
  }, [file, apiUrl, session]);
  return uri;
}

/** An exercise's small picture, in a box the caller sizes: its own picture whole on its own colour once it has come,
 *  the app's picture of its kind until then (and for an exercise with none). */
export function ExerciseThumb({ id, kind, picture, fit = "contain", style }: { id: string; kind: string; picture: OwnPicture | null; fit?: "contain" | "cover"; style: StyleProp<ImageStyle> }) {
  const uri = useOwnPicture(picture);
  if (picture !== null && uri !== null) {
    return (
      // The picture's own colour, read from the picture: the one colour a screen takes from data.
      <View style={[style, styles.clip, { backgroundColor: picture.ground }]}>
        <Image testID={`own-picture-${id}`} source={{ uri }} resizeMode="contain" style={styles.fill} accessible={false} />
      </View>
    );
  }
  return <Image testID={`kind-picture-${id}`} source={pictures[exercisePicture(id, kind)]} resizeMode={fit} style={style} accessible={false} />;
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  fill: { width: "100%", height: "100%" },
});
