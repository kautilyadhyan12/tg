import { Suspense, useState } from "react";
import { StyleSheet, View } from "react-native";
import { ClipNative } from "../../library/clipNative";
import { useOwnClip, type OwnClip } from "./ExerciseImage";

/** Whether this exercise's clip can play on this phone now: it has one, it has come, and the app has a player. */
export function useClipReady(clip: OwnClip | null): boolean {
  return useOwnClip(clip) !== null && clip !== null && ClipNative !== null;
}

/** An exercise's clip (62b), laid over its own picture in the same box: looping, no sound. Nothing until the clip has
 *  come, and nothing on a copy of the app with no player: the picture under it shows. Each exercise's clip has a player
 *  of its own and stays unseen until its own first frame is drawn, so the last exercise's clip is never what shows. */
export function ClipOver({ id, clip, playing }: { id: string; clip: OwnClip | null; playing: boolean }) {
  const uri = useOwnClip(clip);
  if (clip === null || uri === null || ClipNative === null) return null;
  return <Shown key={`${id} ${clip.file}`} id={id} uri={uri} playing={playing} />;
}

function Shown({ id, uri, playing }: { id: string; uri: string; playing: boolean }) {
  const [seen, setSeen] = useState(false);
  const Player = ClipNative;
  if (Player === null) return null;
  return (
    <View testID={`clip-${id}`} pointerEvents="none" style={[StyleSheet.absoluteFill, seen ? null : styles.unseen]}>
      <Suspense fallback={null}>
        <Player
          uri={uri}
          playing={playing}
          onFirstFrame={() => {
            setSeen(true);
          }}
          style={styles.fill}
        />
      </Suspense>
    </View>
  );
}

const styles = StyleSheet.create({
  unseen: { opacity: 0 },
  fill: { width: "100%", height: "100%" },
});
