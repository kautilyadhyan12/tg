import type { PhoneLibraryEntry } from "@app/shared";
import { useContext, useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, View, type ImageStyle, type StyleProp } from "react-native";
import { pictures } from "../../look/pictures";
import { fetchMedia, keptMedia } from "../../library/media";
import { exercisePicture } from "../../library/pictures";
import { useSession } from "../../session/SessionProvider";
import { CopyContext } from "../ThisCopy";

export type OwnPicture = NonNullable<PhoneLibraryEntry["picture"]>;
export type OwnClip = NonNullable<PhoneLibraryEntry["clip"]>;

/** A picture's or clip's address on this phone (62a, 62b): its address once it has come, null until then. It is asked for
 *  once, kept by its own name, and never again; one that does not come is asked for again the next time a screen wants
 *  it. The address given is always THIS file's: when the file asked for changes (the workout moves to its next exercise),
 *  the last file's address is never given for the new one, not even for the one drawing before the new one is looked up. */
function useKeptFile(file: string | null): string | null {
  const { session } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const [got, setGot] = useState<{ file: string; uri: string } | null>(null);
  // Looked up once for each file, not at every drawing of a screen that draws four times a second.
  const kept = useMemo(() => (file === null ? null : keptMedia(file)), [file]);
  useEffect(() => {
    if (file === null || apiUrl === "" || kept !== null) return undefined;
    const live = { now: true };
    fetchMedia(apiUrl, file, session).then(
      (uri) => {
        if (live.now) setGot({ file, uri });
      },
      () => undefined,
    );
    return () => {
      live.now = false;
    };
  }, [file, kept, apiUrl, session]);
  if (file === null) return null;
  return got !== null && got.file === file ? got.uri : kept;
}

/** The exercise's own picture on this phone (62a); null until it has come, and for an exercise with none. */
export function useOwnPicture(picture: OwnPicture | null): string | null {
  return useKeptFile(picture?.file ?? null);
}

/** The exercise's own clip on this phone (62b); null until it has come, and for an exercise with none. It is played from
 *  the file kept on the phone, so it plays with no internet once it has come. */
export function useOwnClip(clip: OwnClip | null): string | null {
  return useKeptFile(clip?.file ?? null);
}

/** Asks for every one of these files that the phone does not keep yet, once (a workout's pictures and clips, when it
 *  opens, so none is missing mid-workout with no internet). One that does not come is asked for again when shown. */
export function useKeepMedia(files: readonly string[]): void {
  const { session } = useSession();
  const apiUrl = useContext(CopyContext).extra?.apiUrl ?? "";
  const key = files.join(" ");
  useEffect(() => {
    if (apiUrl === "" || key === "") return;
    for (const file of key.split(" ")) {
      if (keptMedia(file) === null) fetchMedia(apiUrl, file, session).catch(() => undefined);
    }
  }, [key, apiUrl, session]);
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
