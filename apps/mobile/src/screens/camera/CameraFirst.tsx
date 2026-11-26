import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Button } from "../../look/Button";
import { CAMERA_OFF } from "../../look/cameraWords";
import { colours, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { PictureTop } from "../../look/PictureTop";
import { Txt } from "../../look/Txt";

// Before the camera is turned on the first time (ROADMAP Stage 5 53a; spec Part 2 §11.8 step 7; Kd's drawing of 2026-11-26,
// board 1): what stays private, said once, on the screen before the phone first asks for the camera (Kd: "user should be
// informed of this to increase trust"). Turned off in the phone's own settings, the camera is said to be off, with the
// one button that opens them.

export const FIRST_TITLE = "Count with the camera";
export const FIRST_LINE = "The video stays on your phone. It is never saved or sent.";

export function CameraFirst({ off, onTurnOn, onByHand, onBack }: { off: boolean; onTurnOn: () => void; onByHand: () => void; onBack: () => void }) {
  return (
    <View style={styles.page}>
      <PictureTop
        picture="squat"
        tall={1.4}
        title={off ? CAMERA_OFF.title : FIRST_TITLE}
        above={
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back} hitSlop={4}>
            <Icon name="back" size={24} colour="text" />
          </Pressable>
        }
      />
      <View style={styles.words}>
        <Txt kind="body" colour="text">
          {off ? CAMERA_OFF.line : FIRST_LINE}
        </Txt>
        <View style={styles.row}>
          <Button label={off ? "Open settings" : "Turn on the camera"} raised onPress={off ? () => void Linking.openSettings() : onTurnOn} style={styles.grow} />
          <Button label="Count myself" kind="link" onPress={onByHand} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  back: { width: 54, height: 54, borderRadius: sizes.round, borderWidth: 1, borderColor: colours.line, backgroundColor: colours.overPicture, alignItems: "center", justifyContent: "center" },
  words: { paddingHorizontal: sizes.edge, gap: 10, paddingTop: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 16 },
  grow: { flex: 1 },
});
