import { describe, expect, it } from "vitest";
import { phoneAppExtraSchema } from "@app/shared";
import { COPY_KEYS, MOST_VERSION_CODE, SCREENSHOT_PERMISSIONS, STORE, STORE_BLOCKED_PERMISSIONS, configFor, copyFor, firebaseAppsIn, storeConfig, withServer } from "../app.config";

describe("a folder's copy of the app", () => {
  it("each folder has its own name, application id, api and bundler port", () => {
    const all = COPY_KEYS.map(copyFor);
    expect(all.map((c) => c.name)).toEqual(["Feature 1", "Feature 2", "Exercise 1", "Exercise 2"]);
    for (const field of ["name", "applicationId", "scheme", "apiUrl", "webUrl", "metroPort"] as const) {
      expect(new Set(all.map((c) => c[field])).size).toBe(all.length);
    }
  });

  it("feature folder 1 talks to its own api, through the cable", () => {
    expect(copyFor("feature1\n")).toMatchObject({
      name: "Feature 1",
      applicationId: "com.aihomegym.dev.feature1",
      apiUrl: "http://localhost:3000",
      webUrl: "http://localhost:5173",
      metroPort: 8091,
    });
  });

  it("what a build hands the running app is what the app reads", () => {
    const config = configFor(copyFor("exercise2"));
    expect(config.name).toBe("Exercise 2");
    expect(config.android?.package).toBe("com.aihomegym.dev.exercise2");
    // Add card's screenshot block brings no photos permission with it; the one it needs to load stays.
    expect(config.android?.blockedPermissions).toEqual(SCREENSHOT_PERMISSIONS);
    expect(SCREENSHOT_PERMISSIONS).toContain("android.permission.READ_MEDIA_IMAGES");
    expect(SCREENSHOT_PERMISSIONS).not.toContain("android.permission.DETECT_SCREEN_CAPTURE");
    expect(phoneAppExtraSchema.parse(config.extra)).toEqual({
      copyName: "Exercise 2",
      apiUrl: "http://localhost:3003",
      webUrl: "http://127.0.0.3:5176",
    });
  });

  it.each(["", "feature3", "Feature 1", "toString", "__proto__"])("refuses %j", (written) => {
    expect(() => copyFor(written)).toThrow(
      /must hold one of: feature1, feature2, exercise1, exercise2/,
    );
  });
});

describe("a copy pointed at the online test server (21a-i)", () => {
  const copy = copyFor("feature1");

  it("talks to the cable when neither address is set", () => {
    expect(withServer(copy, {})).toBe(copy);
    expect(withServer(copy, { PHONE_SERVER: " ", PHONE_WEBSITE: "" })).toBe(copy);
  });

  it("reads an address with spaces around it, as a line typed in a terminal has", () => {
    expect(withServer(copy, { PHONE_SERVER: " https://api.getkwazo.com ", PHONE_WEBSITE: "https://getkwazo.com " })).toMatchObject({
      apiUrl: "https://api.getkwazo.com",
      webUrl: "https://getkwazo.com",
    });
  });

  it("talks to the online server, and hands the app exactly those two addresses", () => {
    const online = withServer(copy, { PHONE_SERVER: "https://api.getkwazo.com", PHONE_WEBSITE: "https://getkwazo.com/" });
    expect(online).toMatchObject({ name: "Feature 1", applicationId: "com.aihomegym.dev.feature1", apiUrl: "https://api.getkwazo.com", webUrl: "https://getkwazo.com" });
    expect(phoneAppExtraSchema.parse(configFor(online).extra)).toEqual({ copyName: "Feature 1", apiUrl: "https://api.getkwazo.com", webUrl: "https://getkwazo.com" });
  });

  it.each([
    [{ PHONE_SERVER: "https://api.getkwazo.com" }, /PHONE_WEBSITE/],
    [{ PHONE_WEBSITE: "https://getkwazo.com" }, /PHONE_SERVER/],
    [{ PHONE_SERVER: "http://api.getkwazo.com", PHONE_WEBSITE: "https://getkwazo.com" }, /PHONE_SERVER/],
    [{ PHONE_SERVER: "https://api.getkwazo.com/v1", PHONE_WEBSITE: "https://getkwazo.com" }, /PHONE_SERVER/],
    [{ PHONE_SERVER: "api.getkwazo.com", PHONE_WEBSITE: "https://getkwazo.com" }, /PHONE_SERVER/],
  ])("refuses %j", (env, named) => {
    expect(() => withServer(copy, env)).toThrow(named);
  });
});

describe("the store's app, KWAZO (21c-i)", () => {
  const firebase = ["com.aihomegym.dev.feature1", "com.kwazo.app"];
  const env = { KWAZO_VERSION_CODE: "459876" };

  it("is KWAZO with its own id, talking to the online server alone, over https, naming no copy", () => {
    const config = storeConfig(env, firebase);
    expect(config.name).toBe("KWAZO");
    expect(config.android?.package).toBe("com.kwazo.app");
    expect(config.android?.versionCode).toBe(459876);
    expect(config.version).toBe(STORE.version);
    expect(config.scheme).toBe("kwazo");
    expect(phoneAppExtraSchema.parse(config.extra)).toEqual({ apiUrl: "https://api.getkwazo.com", webUrl: "https://getkwazo.com" });
    expect(config.android?.googleServicesFile).toBe("./google-services.json");
  });

  it("leaves out the bundler's overlay and the phone-wide brightness, and signs with the upload key", () => {
    const config = storeConfig(env, firebase);
    expect(config.android?.blockedPermissions).toEqual(STORE_BLOCKED_PERMISSIONS);
    expect(STORE_BLOCKED_PERMISSIONS).toEqual(expect.arrayContaining([...SCREENSHOT_PERMISSIONS, "android.permission.SYSTEM_ALERT_WINDOW", "android.permission.WRITE_SETTINGS"]));
    expect(config.plugins).toContain("./plugins/storeSigning.js");
    // A folder's copy keeps the overlay its bundler needs, and is never signed with the store's key.
    const copy = configFor(copyFor("feature1"), true);
    expect(copy.android?.blockedPermissions).toEqual(SCREENSHOT_PERMISSIONS);
    expect(copy.plugins).not.toContain("./plugins/storeSigning.js");
    expect(copy.android?.versionCode).toBeUndefined();
  });

  it.each(["", "0", "01", "12a", "1.5", "-3", String(MOST_VERSION_CODE + 1), "99999999999"])("refuses the build number %j", (written) => {
    expect(() => storeConfig({ KWAZO_VERSION_CODE: written }, firebase)).toThrow(/KWAZO_VERSION_CODE/);
  });

  it("takes the highest build number Google Play allows", () => {
    expect(storeConfig({ KWAZO_VERSION_CODE: String(MOST_VERSION_CODE) }, firebase).android?.versionCode).toBe(MOST_VERSION_CODE);
  });

  it("refuses a Firebase file without the store's app: its testers would get no notifications", () => {
    expect(() => storeConfig(env, ["com.aihomegym.dev.feature1"])).toThrow(/google-services\.json has no Android app com\.kwazo\.app/);
    expect(() => storeConfig(env, [])).toThrow(/google-services\.json/);
  });

  it("refuses a folder's server address beside it", () => {
    expect(() => storeConfig({ ...env, PHONE_SERVER: "http://localhost:3000" }, firebase)).toThrow(/PHONE_SERVER/);
    expect(() => storeConfig({ ...env, PHONE_WEBSITE: "https://getkwazo.com" }, firebase)).toThrow(/PHONE_WEBSITE/);
    expect(storeConfig({ ...env, PHONE_SERVER: " ", PHONE_WEBSITE: "" }, firebase).name).toBe("KWAZO");
  });

  it("reads the Android apps Firebase's file names, and nothing from a file of another shape", () => {
    const file = JSON.stringify({
      project_info: { project_id: "kwazo-ae97d" },
      client: [
        { client_info: { android_client_info: { package_name: "com.aihomegym.dev.feature1" } } },
        { client_info: { android_client_info: { package_name: "com.kwazo.app" } } },
        { client_info: {} },
        "not a client",
      ],
    });
    expect(firebaseAppsIn(file)).toEqual(["com.aihomegym.dev.feature1", "com.kwazo.app"]);
    expect(firebaseAppsIn("{}")).toEqual([]);
    expect(firebaseAppsIn("[]")).toEqual([]);
    expect(firebaseAppsIn(JSON.stringify({ client: { package_name: "com.kwazo.app" } }))).toEqual([]);
  });
});
