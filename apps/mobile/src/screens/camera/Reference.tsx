import type { ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import type { CameraExercise } from "../../camera/cameraExercises";
import { pictures } from "../../look/pictures";
import { ClipOver } from "../library/ExerciseClip";
import { useKeepMedia, useOwnPicture } from "../library/ExerciseImage";
import { useNamed } from "../library/useLibrary";

/** The exercise's own picture, its clip playing over it, from the Library kept on the phone, once it has come; until the
 *  Library has a picture of its own, the app's own picture of it; null for an exercise with neither (no tile is drawn), or
 *  none at all. In the camera's corner tile the picture fills the tile; filling the phone for Follow along (53b-ii) it is
 *  shown whole, as its clip is, so that the two lie on each other. Try the camera's (53a) and the workout's (64b-ii). */
export function useReference(exercise: CameraExercise | null): (where: "tile" | "follow", playing: boolean) => ReactNode {
  const named = useNamed();
  const libraryId = exercise?.libraryId ?? null;
  const own = libraryId === null ? null : named(libraryId);
  useKeepMedia([own?.picture?.file, own?.clip?.file].filter((f): f is string => f !== undefined));
  const uri = useOwnPicture(own?.picture ?? null);
  return (where, playing) => {
    if (exercise === null) return null;
    const fit = where === "tile" ? "cover" : "contain";
    const prefix = where === "tile" ? "camera" : "follow";
    if (own?.picture !== null && own?.picture !== undefined && uri !== null) {
      const ground = own.picture.ground;
      return (
        <View style={[styles.fill, { backgroundColor: ground }]}>
          <Image source={{ uri }} resizeMode={fit} style={styles.whole} accessible={false} />
          <ClipOver id={`${prefix}-${exercise.key}`} clip={own.clip} playing={playing} ground={ground} />
        </View>
      );
    }
    if (exercise.picture === null) return null;
    return (
      <View style={styles.fill}>
        <Image testID={`${prefix}-picture-${exercise.key}`} source={pictures[exercise.picture]} resizeMode={fit} style={styles.whole} accessible={false} />
      </View>
    );
  };
}

const styles = StyleSheet.create({
  fill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  /** A picture filling its tile: an Image laid out by its edges alone is drawn at its own size. */
  whole: { width: "100%", height: "100%" },
});
