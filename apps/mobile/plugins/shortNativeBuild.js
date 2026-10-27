// An Expo config plugin for every package with C++ in it. Its build folder moves to
// android/.cxx/<package>, and it compiles two files at a time.
// Windows finds a file only up to 259 characters, and the C++ build of a package deep in
// node_modules checks files near 265 (react-native-nitro-google-signin, measured
// 2026-10-27; ninja says "build.ninja still dirty after 100 tries"). Here they are about 100 shorter.
// Gradle builds one part at a time (scripts/phone.mjs), but a C++ part runs ninja, which
// compiles as many files at once as the laptop has threads, plus two (14 on Kd's); with
// the Google package's C++ that ran a 16 GB laptop out of memory. CMake's job pools keep it
// to two compiles and one link. The app built is the same either way.
const { withAppBuildGradle, withProjectBuildGradle } = require("expo/config-plugins");

const MARK = "// shortNativeBuild (apps/mobile/plugins/shortNativeBuild.js)";
const POOLS = `"-DCMAKE_JOB_POOLS=compile=2;link=1", "-DCMAKE_JOB_POOL_COMPILE=compile", "-DCMAKE_JOB_POOL_LINK=link"`;

// Set as each package takes Android's library or app plugin, before Android reads it. The
// app itself is read before this runs, so it takes its pools in its own file, below.
const PACKAGES = `
${MARK}
subprojects { p ->
  ["com.android.library", "com.android.application"].each { id ->
    p.plugins.withId(id) {
      if (p.state.executed) {
        println("shortNativeBuild: already read: " + p.name)
      } else {
        p.android.externalNativeBuild.cmake.buildStagingDirectory = new File(rootDir, ".cxx/" + p.name)
        p.android.defaultConfig.externalNativeBuild.cmake.arguments(${POOLS})
      }
    }
  }
}
`;

const APP = `
${MARK}
android.defaultConfig.externalNativeBuild.cmake.arguments(${POOLS})
`;

/** Written once, at the end: an older copy of the block is replaced, never doubled. */
function atTheEnd(contents, block) {
  const at = contents.indexOf(MARK);
  const before = at === -1 ? contents : contents.slice(0, at).trimEnd() + "\n";
  return before + block;
}

module.exports = function shortNativeBuild(config) {
  const withPackages = withProjectBuildGradle(config, (gradle) => {
    if (gradle.modResults.language !== "groovy") throw new Error("shortNativeBuild: android/build.gradle is not Groovy");
    gradle.modResults.contents = atTheEnd(gradle.modResults.contents, PACKAGES);
    return gradle;
  });
  return withAppBuildGradle(withPackages, (gradle) => {
    if (gradle.modResults.language !== "groovy") throw new Error("shortNativeBuild: android/app/build.gradle is not Groovy");
    gradle.modResults.contents = atTheEnd(gradle.modResults.contents, APP);
    return gradle;
  });
};
