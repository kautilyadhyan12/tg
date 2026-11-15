// An Expo config plugin for the store's app alone (app.config.ts, ROADMAP Stage 5 21c-i). Android signs the
// release build with KWAZO's upload key, which Google Play knows as the key of every update. The key lives on the
// laptop outside every folder, and scripts/store.mjs hands Gradle its file and passwords through four
// environment settings, so no password is written into the Android project. A release built without them stops
// before anything is made: the template's own release is signed with the development key, and Google Play
// refuses that.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARK = "// storeSigning (apps/mobile/plugins/storeSigning.js)";

const SETTINGS = ["KWAZO_UPLOAD_STORE_FILE", "KWAZO_UPLOAD_STORE_PASSWORD", "KWAZO_UPLOAD_KEY_ALIAS", "KWAZO_UPLOAD_KEY_PASSWORD"];

const BLOCK = `
${MARK}
def kwazoUpload = ${JSON.stringify(SETTINGS)}.collectEntries { [(it): System.getenv(it) ?: ""] }
def kwazoMissing = kwazoUpload.findAll { it.value.isEmpty() }.keySet()
if (kwazoMissing.isEmpty()) {
  android.signingConfigs {
    upload {
      storeFile file(kwazoUpload["KWAZO_UPLOAD_STORE_FILE"])
      storePassword kwazoUpload["KWAZO_UPLOAD_STORE_PASSWORD"]
      keyAlias kwazoUpload["KWAZO_UPLOAD_KEY_ALIAS"]
      keyPassword kwazoUpload["KWAZO_UPLOAD_KEY_PASSWORD"]
    }
  }
  android.buildTypes.release.signingConfig android.signingConfigs.upload
}
gradle.taskGraph.whenReady { graph ->
  def release = graph.allTasks.any { it.project.path == project.path && it.name.contains("Release") }
  if (release && !kwazoMissing.isEmpty()) {
    throw new GradleException("The store's app is signed with KWAZO's upload key, and " + kwazoMissing.join(", ") + " is not set. Build it with: corepack pnpm --filter mobile store-version")
  }
}
`;

/** Written once, at the end: an older copy of the block is replaced, never doubled. */
function atTheEnd(contents) {
  const at = contents.indexOf(MARK);
  const before = at === -1 ? contents : contents.slice(0, at).trimEnd() + "\n";
  return before + BLOCK;
}

module.exports = function storeSigning(config) {
  return withAppBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== "groovy") throw new Error("storeSigning: android/app/build.gradle is not Groovy");
    gradle.modResults.contents = atTheEnd(gradle.modResults.contents);
    return gradle;
  });
};

module.exports.SETTINGS = SETTINGS;
module.exports.atTheEnd = atTheEnd;
