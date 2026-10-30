// An Expo config plugin. Android rebuilds the app's screen when the phone's display size or text size is changed in its
// settings, unless told the app handles those itself. A rebuilt screen went back to the Dashboard, and every photo picker
// refused to open until the app was closed ("Attempting to launch an unregistered ActivityResultLauncher"; expo-modules-core
// drops its launchers when the screen is destroyed and registers them only once). Seen on Kd's phone, 2026-10-30.
const { withAndroidManifest } = require("expo/config-plugins");

const ALSO = ["density", "fontScale"];

/** The manifest's screen with those two added to what it handles, each once. */
function withBoth(manifest) {
  const activities = manifest.manifest.application?.[0]?.activity ?? [];
  for (const activity of activities) {
    if (activity.$["android:name"] !== ".MainActivity") continue;
    const now = (activity.$["android:configChanges"] ?? "").split("|").filter((c) => c !== "");
    activity.$["android:configChanges"] = [...now, ...ALSO.filter((c) => !now.includes(c))].join("|");
  }
  return manifest;
}

module.exports = (config) =>
  withAndroidManifest(config, (next) => {
    next.modResults = withBoth(next.modResults);
    return next;
  });
module.exports.withBoth = withBoth;
