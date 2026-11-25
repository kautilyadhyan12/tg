import { Suspense, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { ClipNative } from "../../library/clipNative";
import { useOwnClip, type OwnClip } from "./ExerciseImage";

/** Whether this exercise's clip can play on this phone now: it has one, it has come, and the app has a player. */
export function useClipReady(clip: OwnClip | null): boolean {
  return useOwnClip(clip) !== null && clip !== null && ClipNative !== null;
}

/** How far in a clip's edges melt into the grey round it, as a share of its width (sides) and height (top, foot), short of
 *  KWAZO (4 % of the short side in from a bottom corner, about 2.3 % up from the foot). The clip command moves a clip's grey
 *  to meet its picture's (62b), so only the little left over, the grey's own unevenness, is melted. */
const MELT_SIDE = 0.035;
const MELT_TOP = 0.05;
const MELT_FOOT = 0.018;

/** An exercise's clip (62b), laid over its own picture in the same box: looping, no sound. Nothing until the clip has
 *  come, and nothing on a copy of the app with no player: the picture under it shows. Each exercise's clip has a player
 *  of its own and stays unseen until its own first frame is drawn, so the last exercise's clip is never what shows.
 *  `ground` is the picture's own grey round it, which the clip's edges melt into, so it never reads as a box. */
export function ClipOver({ id, clip, playing, ground }: { id: string; clip: OwnClip | null; playing: boolean; ground: string }) {
  const uri = useOwnClip(clip);
  if (clip === null || uri === null || ClipNative === null) return null;
  return <Shown key={`${id} ${clip.file}`} id={id} uri={uri} playing={playing} shape={clip} ground={ground} />;
}

function Shown({ id, uri, playing, shape, ground }: { id: string; uri: string; playing: boolean; shape: { width: number; height: number }; ground: string }) {
  const [seen, setSeen] = useState(false);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const Player = ClipNative;
  if (Player === null) return null;
  // The clip as it is fitted whole in the box, centred: where its edges are.
  const fitted = box === null ? null : (() => {
    const width = Math.min(box.width, (box.height * shape.width) / shape.height);
    const height = (width * shape.height) / shape.width;
    return { width, height, left: (box.width - width) / 2, top: (box.height - height) / 2 };
  })();
  // The picture's own colour, read from the picture, to see-through: the one colour a screen takes from data.
  const melt = (to: string) => `linear-gradient(to ${to}, ${ground}, ${ground}00)`;
  return (
    <View
      testID={`clip-${id}`}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, seen ? null : styles.unseen]}
      onLayout={(e: LayoutChangeEvent) => {
        setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
      }}
    >
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
      {fitted === null ? null : (
        <View style={[styles.edges, { left: fitted.left, top: fitted.top, width: fitted.width, height: fitted.height }]}>
          <View style={[styles.side, { left: -1, width: fitted.width * MELT_SIDE, experimental_backgroundImage: melt("right") }]} />
          <View style={[styles.side, { right: -1, width: fitted.width * MELT_SIDE, experimental_backgroundImage: melt("left") }]} />
          <View style={[styles.end, { top: -1, height: fitted.height * MELT_TOP, experimental_backgroundImage: melt("bottom") }]} />
          <View style={[styles.end, { bottom: -1, height: fitted.height * MELT_FOOT, experimental_backgroundImage: melt("top") }]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  unseen: { opacity: 0 },
  fill: { width: "100%", height: "100%" },
  edges: { position: "absolute" },
  side: { position: "absolute", top: -1, bottom: -1 },
  end: { position: "absolute", left: -1, right: -1 },
});
