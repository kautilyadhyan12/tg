import { useEffect, useRef, useState } from "react";
import { Linking, Modal, Pressable, StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "../../look/Button";
import { colours, orangeGradient, shadows, sizes } from "../../look/colours";
import { Icon } from "../../look/Icon";
import { Txt } from "../../look/Txt";

// A photo for a post, taken in the app (ROADMAP Stage 5 17b). The phone's own camera app is not used: on Kd's phone
// Android closed this app to make room while it was open, and the photo was lost (seen 2026-10-30, the low memory killer).

export function PostCamera({ open, onPhoto, onClose }: { open: boolean; onPhoto: (uri: string) => void; onClose: () => void }) {
  return (
    <Modal visible={open} animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {open ? <Lens onPhoto={onPhoto} onClose={onClose} /> : null}
    </Modal>
  );
}

function Lens({ onPhoto, onClose }: { onPhoto: (uri: string) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [permission, ask] = useCameraPermissions();
  const lens = useRef<CameraView | null>(null);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const asked = useRef(false);

  // The phone's own question, once, the first time the camera opens.
  useEffect(() => {
    if (permission === null || permission.granted || !permission.canAskAgain || asked.current) return;
    asked.current = true;
    void ask();
  }, [permission, ask]);

  const take = async () => {
    if (lens.current === null || !ready || taking) return;
    setTaking(true);
    setFailed(null);
    try {
      const picture = await lens.current.takePictureAsync({ quality: 0.9, exif: false });
      onPhoto(picture.uri);
    } catch {
      setFailed("Couldn't take the photo. Try again.");
    } finally {
      setTaking(false);
    }
  };

  const allowed = permission?.granted === true;
  return (
    <View testID="post-camera" style={styles.page}>
      {allowed ? (
        <CameraView
          ref={lens}
          style={StyleSheet.absoluteFill}
          facing="back"
          onCameraReady={() => {
            setReady(true);
          }}
          onMountError={() => {
            setFailed("The camera couldn't start. Choose a photo instead.");
          }}
        />
      ) : (
        <View style={[styles.allow, { paddingTop: insets.top + 80 }]}>
          <Icon name="camera" size={34} colour="orange" />
          <Txt kind="h2" style={styles.centre}>
            Allow the camera
          </Txt>
          <Txt kind="small" style={styles.centre}>
            To take a photo for your post.
          </Txt>
          {permission === null ? null : (
            <Button
              label={permission.canAskAgain ? "Allow camera" : "Open settings"}
              onPress={() => {
                if (permission.canAskAgain) void ask();
                else void Linking.openSettings();
              }}
              style={styles.centreSelf}
            />
          )}
        </View>
      )}
      <Pressable accessibilityRole="button" accessibilityLabel="Close camera" onPress={onClose} style={[styles.close, { top: insets.top + 12 }]}>
        <Icon name="x" size={20} />
      </Pressable>
      <View style={[styles.foot, { paddingBottom: insets.bottom + 28 }]}>
        {failed === null ? null : (
          <View style={styles.notice} accessibilityLiveRegion="polite">
            <Txt kind="small" colour="text" style={styles.centre}>
              {failed}
            </Txt>
          </View>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          accessibilityState={{ disabled: !allowed || !ready || taking }}
          disabled={!allowed || !ready || taking}
          onPress={() => void take()}
          style={[styles.shutter, !allowed || !ready ? styles.dim : null]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colours.page },
  allow: { alignItems: "center", gap: 12, paddingHorizontal: sizes.edge },
  centre: { textAlign: "center" },
  centreSelf: { alignSelf: "center" },
  close: {
    position: "absolute",
    left: sizes.edge,
    width: sizes.press,
    height: sizes.press,
    borderRadius: sizes.round,
    backgroundColor: colours.scrim,
    alignItems: "center",
    justifyContent: "center",
  },
  foot: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: sizes.edge, gap: 18, alignItems: "center" },
  notice: { padding: 12, borderRadius: 16, backgroundColor: colours.scrim },
  shutter: { width: 78, height: 78, borderRadius: sizes.round, borderWidth: 3, borderColor: colours.text, alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 62, height: 62, borderRadius: sizes.round, backgroundColor: colours.orange, experimental_backgroundImage: orangeGradient, boxShadow: shadows.button },
  dim: { opacity: 0.45 },
});
