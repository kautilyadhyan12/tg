import { describe, expect, it } from "vitest";
import { OUTSIDE_SERVICES, privacyPolicy } from "@app/shared";
import {
  BUSINESSES,
  COLLECTED,
  GOOGLE_PURPOSES,
  GOOGLE_TYPES,
  NOT_SHARING,
  OUTSIDE,
  PERMISSIONS,
  POLICY_PARTS,
  dataSafetyFaults,
  type Answers,
} from "../scripts/playDataSafety.mjs";

// Build 458835's own manifest (the store version on Kd's phone, 2026-11-15), as storeCheck's `declaredPermissions` read
// it from `aapt2 dump xmltree --file AndroidManifest.xml` (build tools 36.0.0): 39 permissions, in its order.
const BUILD_458835 = [
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.CAMERA",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.INTERNET",
  "android.permission.VIBRATE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.DETECT_SCREEN_CAPTURE",
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_ADMIN",
  "android.permission.WAKE_LOCK",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.POST_NOTIFICATIONS",
  "com.google.android.c2dm.permission.RECEIVE",
  "com.kwazo.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",
  "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
  "com.sec.android.provider.badge.permission.READ",
  "com.sec.android.provider.badge.permission.WRITE",
  "com.htc.launcher.permission.READ_SETTINGS",
  "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.sonyericsson.home.permission.BROADCAST_BADGE",
  "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT",
  "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.huawei.android.launcher.permission.CHANGE_BADGE",
  "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS",
  "android.permission.READ_APP_BADGE",
  "com.oppo.launcher.permission.READ_SETTINGS",
  "com.oppo.launcher.permission.WRITE_SETTINGS",
  "me.everything.badger.permission.BADGE_COUNT_READ",
  "me.everything.badger.permission.BADGE_COUNT_WRITE",
];

/** The headings of the privacy policy's "Personal Information We Collect", as the published page shows them. */
function policyParts(): string[] {
  const section = privacyPolicy().sections.find((s) => s.id === "what-we-collect");
  if (section === undefined) throw new Error("The privacy policy has no section on what is collected.");
  return section.blocks.flatMap((b) => (b.kind === "h3" ? [b.text] : []));
}

const today = () => ({ permissions: BUILD_458835, policyParts: policyParts(), outsideIds: OUTSIDE_SERVICES.map((s) => s.id) });
const answers = (change: Partial<Answers>): Answers => ({ COLLECTED, PERMISSIONS, POLICY_PARTS, OUTSIDE, ...change });
const without = (type: string) => answers({ COLLECTED: COLLECTED.filter((c) => c.type !== type) });

describe("Google's page never tells people something false about their data", () => {
  it("every permission the store's app asks for is answered, and today's answers have no fault", () => {
    expect(BUILD_458835).toHaveLength(39);
    expect(dataSafetyFaults(today())).toEqual([]);
  });

  // From Android's own permission list, none of them in the app today: each one a door to data the answers never declared.
  it.each([
    "android.permission.ACCESS_BACKGROUND_LOCATION",
    "android.permission.READ_CONTACTS",
    "android.permission.RECORD_AUDIO",
    "android.permission.READ_MEDIA_VIDEO",
    "android.permission.READ_CALENDAR",
    "android.permission.ACTIVITY_RECOGNITION",
    "android.permission.BODY_SENSORS",
    "android.permission.health.READ_HEART_RATE",
    "com.google.android.gms.permission.AD_ID",
  ])("a build that asks for %s is stopped until it is answered", (permission) => {
    expect(dataSafetyFaults({ ...today(), permissions: [...BUILD_458835, permission] })).toEqual([
      `The app asks for ${permission}, which the Data safety answers do not cover.`,
    ]);
  });

  it.each([
    ["Precise location", ["android.permission.ACCESS_FINE_LOCATION", "android.permission.FOREGROUND_SERVICE_LOCATION", "3.10. Running"]],
    ["Approximate location", ["android.permission.ACCESS_COARSE_LOCATION", "3.10. Running"]],
    ["Photos", ["android.permission.CAMERA", "3.8. Meal and Food Label Images", "3.11. Business Page"]],
    ["Fitness info", ["android.permission.BLUETOOTH_CONNECT", "3.10.1. Heart Rate", "3.5. Workout"]],
    ["Health info", ["3.4. Health-Related Screening", "3.9. Body Measurements"]],
    ["App interactions", ["3.14. Application Usage"]],
    ["Device or other IDs", ["com.google.android.c2dm.permission.RECEIVE", "3.12. Notification"]],
  ])("answering %s as not collected is refused where the app or the policy collects it", (type, where) => {
    const faults = dataSafetyFaults(today(), without(type));
    for (const w of where) expect(faults.some((f) => f.includes(w) && f.includes(`leads to ${type}, which the answers say is not collected`))).toBe(true);
  });

  it("a new part of the privacy policy, or a new company in it, stops it until it is answered", () => {
    expect(dataSafetyFaults({ ...today(), policyParts: [...policyParts(), "3.16. Contacts From Your Address Book"] })).toEqual([
      `The privacy policy's "3.16. Contacts From Your Address Book" is not answered in Data safety.`,
    ]);
    expect(dataSafetyFaults({ ...today(), outsideIds: [...today().outsideIds, "mixpanel"] })).toEqual([
      "The privacy policy names mixpanel, which the Data safety answers do not cover.",
    ]);
  });

  it("every part of the policy's section 3 is answered, and every answer is a part the policy has", () => {
    expect(policyParts().length).toBeGreaterThan(10);
    expect(Object.keys(POLICY_PARTS).sort()).toEqual([...policyParts()].sort());
    expect(Object.keys(OUTSIDE).sort()).toEqual(OUTSIDE_SERVICES.map((s) => s.id).sort());
  });

  it("the roadmap's two: time in the app is app activity, a run's heart rate is fitness info, both linked to the person", () => {
    expect(POLICY_PARTS["3.14. Application Usage Information"]).toEqual(["App interactions"]);
    expect(POLICY_PARTS["3.10.1. Heart Rate From a Heart Rate Monitor"]).toEqual(["Fitness info"]);
    expect(COLLECTED.find((c) => c.type === "App interactions")?.what).toMatch(/minutes the app is open/);
    expect(COLLECTED.find((c) => c.type === "Fitness info")?.what).toMatch(/heart rate/);
  });
});

describe("the answers are in Google's own words", () => {
  it("only Google's types and purposes, each type once", () => {
    const types = Object.values(GOOGLE_TYPES).flat();
    expect(types).toHaveLength(38);
    for (const c of COLLECTED) {
      expect(types).toContain(c.type);
      for (const p of c.purposes) expect(GOOGLE_PURPOSES).toContain(p);
    }
    expect(new Set(COLLECTED.map((c) => c.type)).size).toBe(COLLECTED.length);
  });

  it("a misspelt type or a purpose of our own is a fault", () => {
    const misspelt = COLLECTED.map((c) => (c.type === "Precise location" ? { ...c, type: "Precise Location" } : c));
    expect(dataSafetyFaults(today(), answers({ COLLECTED: misspelt }))).toContain('"Precise Location" is not one of Google\'s types.');
    const ours = COLLECTED.map((c) => (c.type === "Name" ? { ...c, purposes: ["Login"] } : c));
    expect(dataSafetyFaults(today(), answers({ COLLECTED: ours }))).toContain(`Name's purpose "Login" is not one of Google's.`);
    const typo = { ...PERMISSIONS, "android.permission.CAMERA": ["Photo"] };
    expect(dataSafetyFaults(today(), answers({ PERMISSIONS: typo }))).toContain('android.permission.CAMERA names "Photo", which is not one of Google\'s types.');
  });

  it("no advertising purpose, as the privacy policy promises, and Analytics only for the minutes the owner's admin page shows", () => {
    const blocks = privacyPolicy().sections.flatMap((s) => s.blocks);
    expect(blocks.some((b) => b.kind === "p" && b.text === "KWAZO does not display advertisements and does not use advertising or analytics tools.")).toBe(true);
    expect(blocks.some((b) => b.kind === "list" && b.items.includes("Time spent using the Application."))).toBe(true);
    for (const c of COLLECTED) expect(c.purposes).not.toContain("Advertising or marketing");
    expect(COLLECTED.filter((c) => c.purposes.includes("Analytics")).map((c) => c.type)).toEqual(["App interactions"]);
  });

  it("what Play Console holds since 2026-11-16: required for everyone, or the person's choice", () => {
    const required = COLLECTED.filter((c) => c.required).map((c) => c.type);
    expect(required).toEqual(["Name", "Email address", "User IDs", "Other info", "Health info", "Fitness info", "App interactions", "Device or other IDs"]);
  });

  it("nothing is shared: each company is one of Google's exceptions, or the app sends it nothing", () => {
    const exceptions = Object.values(NOT_SHARING);
    for (const [id, o] of Object.entries(OUTSIDE)) {
      if (o.exception === null) expect(o.why, id).toMatch(/the app sends it nothing\.$/);
      else expect(exceptions, id).toContain(o.exception);
    }
    expect(exceptions).toContain(BUSINESSES.exception);
  });

  it("photos are kept for posts, so the type is never answered as only passing through", () => {
    expect(COLLECTED.find((c) => c.type === "Photos")).toMatchObject({ ephemeral: false, required: false });
  });
});
