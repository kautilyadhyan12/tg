// An Expo config plugin for every build (app.config.ts; ROADMAP Stage 5 51a, and the store's app since 53a). Google's Android pose library,
// MediaPipe Tasks, sends usage reports to Google by itself each time a model starts and as it reads pictures: the
// app's name and version, the library's version, which task, how many pictures and how long each took. Never a
// picture or a body point, but Kd ruled on 2026-10-18 that nothing goes online beyond the result a person shares.
// The library cannot be told to stop (its TaskRunner always makes the logger, and the logger needs Google's "data
// transport"), so this takes away the one way that transport sends: its "cct" backend, declared by the package
// transport-backend-cct. With none declared, the transport deletes what it gathered on the phone ("Unknown backend
// for …, deleting event batch") and sends nothing. Firebase's optional delivery statistics, off unless switched on,
// go the same way; notifications themselves do not use it.
// Job 53a brought the pose library to the store's app (modules/pose-camera), and this plugin with it.
const { withAndroidManifest } = require("expo/config-plugins");

const DISCOVERY = "com.google.android.datatransport.runtime.backends.TransportBackendDiscovery";
const SENDER = "backend:com.google.android.datatransport.cct.CctBackendFactory";

/** The app's manifest with the sender removed from Google's transport, once however often it runs. */
function withoutSender(manifest) {
  const app = manifest.application?.[0];
  if (app === undefined) throw new Error("noUsageReports: the app's manifest has no <application>.");
  manifest.$ = { ...manifest.$, "xmlns:tools": "http://schemas.android.com/tools" };
  const others = (app.service ?? []).filter((s) => s.$?.["android:name"] !== DISCOVERY);
  app.service = [
    ...others,
    {
      $: { "android:name": DISCOVERY, "android:exported": "false" },
      "meta-data": [{ $: { "android:name": SENDER, "tools:node": "remove" } }],
    },
  ];
  return manifest;
}

function noUsageReports(config) {
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest = withoutSender(c.modResults.manifest);
    return c;
  });
}

module.exports = noUsageReports;
module.exports.withoutSender = withoutSender;
module.exports.DISCOVERY = DISCOVERY;
module.exports.SENDER = SENDER;
