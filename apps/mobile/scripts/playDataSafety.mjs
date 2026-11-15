// Google Play's Data safety form, answered for KWAZO (ROADMAP Stage 5 21c-ii), and the rules that keep the answers true
// as the app grows:
//   · every permission the store's app asks the phone for either leads to data answered below, or to none, with why;
//   · every part of the privacy policy's "Personal Information We Collect" is answered under Google's own types;
//   · every company the privacy policy names is answered for, by the exception of Google's that makes it no "sharing".
// Google's names and rules: support.google.com/googleplay/android-developer/answer/10787469, read 2026-11-15.
// "'Collect' means transmitting data from your app off a user's device", SDKs included; "'Sharing' refers to
// transferring user data collected from your app to a third party", except to "Service providers", for "Legal
// purposes", on a "User-initiated action or prominent disclosure and user consent", and "Anonymous data".
// What Play Console shows is typed in by hand from COLLECTED; storeCheck.mjs refuses a build whose permissions are
// not all in PERMISSIONS, and test/playDataSafety.test.ts holds the rest against the privacy policy.

/** Google's data types, by category, exactly as its form names them. */
export const GOOGLE_TYPES = {
  Location: ["Approximate location", "Precise location"],
  "Personal info": ["Name", "Email address", "User IDs", "Address", "Phone number", "Race and ethnicity", "Political or religious beliefs", "Sexual orientation", "Other info"],
  "Financial info": ["User payment info", "Purchase history", "Credit score", "Other financial info"],
  "Health and fitness": ["Health info", "Fitness info"],
  Messages: ["Emails", "SMS or MMS", "Other in-app messages"],
  "Photos and videos": ["Photos", "Videos"],
  "Audio files": ["Voice or sound recordings", "Music files", "Other audio files"],
  "Files and docs": ["Files and docs"],
  Calendar: ["Calendar events"],
  Contacts: ["Contacts"],
  "App activity": ["App interactions", "In-app search history", "Installed apps", "Other user-generated content", "Other actions"],
  "Web browsing": ["Web browsing history"],
  "App info and performance": ["Crash logs", "Diagnostics", "Other app performance data"],
  "Device or other IDs": ["Device or other IDs"],
};

/** Google's purposes, exactly as its form names them. */
export const GOOGLE_PURPOSES = [
  "App functionality",
  "Analytics",
  "Developer communications",
  "Advertising or marketing",
  "Fraud prevention, security, and compliance",
  "Personalization",
  "Account management",
];

/** Google's exceptions to "sharing", exactly as named. */
export const NOT_SHARING = {
  serviceProvider: "Service providers",
  userInitiated: "User-initiated action or prominent disclosure and user consent",
};

/** What KWAZO collects: one entry for each of Google's types it ticks; every other type is "not collected". Shared:
 *  none (every company is a service provider or a transfer the person starts: OUTSIDE below). `required`: Google's
 *  "Data collection is required (users can't turn off this data collection)" against "Users can choose whether this
 *  data is collected". `ephemeral`: "only stored in memory and retained for no longer than necessary to service the
 *  specific request in real-time", for ALL of that type's data. */
export const COLLECTED = [
  {
    type: "Approximate location",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "A run's route, when the person lets the phone give only their approximate location.",
  },
  {
    type: "Precise location",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "A run's route, distance and pace, recorded while the person runs (with the screen locked too).",
  },
  {
    type: "Name",
    required: true,
    ephemeral: false,
    purposes: ["App functionality", "Account management"],
    what: "The name typed in setup, or given by Google sign-in; seen by a business the person joins.",
  },
  {
    type: "Email address",
    required: true,
    ephemeral: false,
    purposes: ["App functionality", "Account management"],
    what: "Signing in by emailed code, and the emails a business the person joins sends them.",
  },
  {
    type: "User IDs",
    required: true,
    ephemeral: false,
    purposes: ["Account management"],
    what: "The account's own id, and the Google account's id with Google sign-in.",
  },
  {
    type: "Other info",
    required: true,
    ephemeral: false,
    purposes: ["App functionality", "Personalization"],
    what: "Age and sex from setup, for the plan and the calorie numbers.",
  },
  {
    type: "User payment info",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "A card saved for a membership: typed into Square's own form; KWAZO keeps the brand, last four digits and expiry.",
  },
  {
    type: "Purchase history",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "Memberships and other things bought from a business in the app, their payments and receipts.",
  },
  {
    type: "Health info",
    required: true,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "The yes-or-no health question in setup; body weight and measurements; the meals and nutrition logged.",
  },
  {
    type: "Fitness info",
    required: true,
    ephemeral: false,
    purposes: ["App functionality", "Personalization"],
    what: "Setup's fitness answers, workouts and form scores, runs and a heart rate monitor's readings, streaks, badges, challenges.",
  },
  {
    type: "Photos",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "A meal or food label photo, sent to find the foods and then discarded; photos posted on a business's page, which are kept.",
  },
  {
    type: "App interactions",
    required: true,
    ephemeral: false,
    purposes: ["App functionality", "Fraud prevention, security, and compliance"],
    what: "The minutes the app is open each day, and how many meal scans and route plans were used, for the daily limits.",
  },
  {
    type: "In-app search history",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "Foods searched for and barcodes scanned, looked up on the server (a barcode can stay in its request log).",
  },
  {
    type: "Other user-generated content",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "Posts and comments on a business's page, own foods and dishes, meal and run plans, goals.",
  },
  {
    type: "Other actions",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "Reactions, reports and blocks on a business's page; bookings for classes and personal training.",
  },
  {
    type: "Device or other IDs",
    required: false,
    ephemeral: false,
    purposes: ["App functionality"],
    what: "The phone's notification token, so that notifications the person allows reach it.",
  },
];

/** Each company the privacy policy names (OUTSIDE_SERVICES in packages/shared/src/legal.ts), and why what it receives
 *  is not "sharing" in Google's words, or that the app never sends it anything. */
export const OUTSIDE = {
  openai: { exception: NOT_SHARING.serviceProvider, why: "Finds the foods in a photo for KWAZO, on KWAZO's instructions." },
  resend: { exception: NOT_SHARING.serviceProvider, why: "Delivers KWAZO's emails." },
  firebase: { exception: NOT_SHARING.serviceProvider, why: "Delivers KWAZO's notifications." },
  google_sign_in: { exception: NOT_SHARING.userInitiated, why: "Only when the person presses Continue with Google." },
  cloudflare: { exception: NOT_SHARING.serviceProvider, why: "Runs KWAZO's robot check." },
  openfreemap: { exception: NOT_SHARING.serviceProvider, why: "Draws the maps KWAZO shows." },
  openstreetmap: { exception: null, why: "The website's running pages only; the app sends it nothing." },
  sentry: { exception: null, why: "The server's errors only, with no names, addresses or what people wrote; the app sends it nothing." },
  square: { exception: NOT_SHARING.userInitiated, why: "Only when the person pays a business or saves a card for it, in Square's own form." },
  paddle_razorpay: { exception: null, why: "A business paying KWAZO, on the website; the app sends it nothing." },
};

/** A business the person joins sees what the join screen names (the privacy policy's section 7): the person's own
 *  step, so a user-initiated transfer, as are other members seeing the leaderboard and the page's posts. */
export const BUSINESSES = { exception: NOT_SHARING.userInitiated, why: "The person joins the business; the join screen says what it will see." };

/** The parts of the privacy policy's section 3, each answered under Google's types (or under none, with why). */
export const POLICY_PARTS = {
  "3.1. Account and Registration Information": ["Name", "Email address", "User IDs"],
  "3.2. Authentication and Sign-In Information": { none: "Sign-in times, the IP address and the device's browser line, kept for security: the sign-in itself, answered under Email address and User IDs." },
  "3.3. Fitness Profile and Onboarding Information": ["Other info", "Fitness info", "Health info"],
  "3.4. Health-Related Screening Information": ["Health info"],
  "3.5. Workout and Exercise Information": ["Fitness info"],
  "3.6. Camera-Based Exercise Analysis": { none: "The camera's picture never leaves the phone; only the counts and scores do, under Fitness info." },
  "3.7. Nutrition and Meal Information": ["Health info", "Other user-generated content"],
  "3.8. Meal and Food Label Images": ["Photos"],
  "3.9. Body Measurements": ["Health info"],
  "3.10. Running and Location Information": ["Precise location", "Approximate location", "Fitness info"],
  "3.10.1. Heart Rate From a Heart Rate Monitor": ["Fitness info"],
  "3.11. Business Page and Community Information": ["Photos", "Other user-generated content", "Other actions"],
  "3.12. Notification Information": ["Device or other IDs"],
  "3.13. Records of Acknowledgments and Agreements": ["Other actions"],
  "3.14. Application Usage Information": ["App interactions"],
  "3.15. Communications": { none: "Emails the person sends KWAZO's support address, outside the app." },
};

const NOTHING_LEAVES = "Works on the phone itself; nothing it reaches leaves the phone.";
const BADGE = "Puts the count of new messages on the app's icon; nothing leaves the phone.";

/** Each permission the store's app asks the phone for, read from build 458835's manifest (2026-11-15), and the data
 *  it leads to, or none, with why. A permission not here stops storeCheck until its answer is written. */
export const PERMISSIONS = {
  "android.permission.ACCESS_COARSE_LOCATION": ["Approximate location"],
  "android.permission.ACCESS_FINE_LOCATION": ["Precise location"],
  "android.permission.FOREGROUND_SERVICE_LOCATION": ["Precise location", "Approximate location"],
  "android.permission.CAMERA": ["Photos"],
  "android.permission.BLUETOOTH_SCAN": ["Fitness info"],
  "android.permission.BLUETOOTH_CONNECT": ["Fitness info"],
  "android.permission.BLUETOOTH": ["Fitness info"],
  "android.permission.BLUETOOTH_ADMIN": ["Fitness info"],
  "com.google.android.c2dm.permission.RECEIVE": ["Device or other IDs"],
  "android.permission.FOREGROUND_SERVICE": { none: "Keeps a run recording with the screen locked; what it records is under Precise location." },
  "android.permission.INTERNET": { none: "Reaches KWAZO's server; what is sent is answered by type." },
  "android.permission.ACCESS_NETWORK_STATE": { none: NOTHING_LEAVES },
  "android.permission.ACCESS_WIFI_STATE": { none: NOTHING_LEAVES },
  "android.permission.VIBRATE": { none: NOTHING_LEAVES },
  "android.permission.WAKE_LOCK": { none: NOTHING_LEAVES },
  "android.permission.RECEIVE_BOOT_COMPLETED": { none: "Sets the person's reminders again after the phone restarts; nothing leaves the phone." },
  "android.permission.POST_NOTIFICATIONS": { none: "Shows notifications; the token that reaches them is under Device or other IDs." },
  "android.permission.WRITE_EXTERNAL_STORAGE": { none: "Android 12 and older only: writes on the phone's own storage, which sends nothing." },
  "android.permission.DETECT_SCREEN_CAPTURE": { none: "Added by the screen guard on the pass; the app never listens for screenshots." },
  "android.permission.USE_BIOMETRIC": { none: "The phone's key store, which keeps the sign-in; nothing leaves the phone." },
  "android.permission.USE_FINGERPRINT": { none: "The phone's key store, which keeps the sign-in; nothing leaves the phone." },
  "com.kwazo.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION": { none: "Android's own guard inside the app; nothing leaves the phone." },
  "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE": { none: "Added by an Expo library; the app never reads where it was installed from." },
  "android.permission.READ_APP_BADGE": { none: BADGE },
  "com.sec.android.provider.badge.permission.READ": { none: BADGE },
  "com.sec.android.provider.badge.permission.WRITE": { none: BADGE },
  "com.htc.launcher.permission.READ_SETTINGS": { none: BADGE },
  "com.htc.launcher.permission.UPDATE_SHORTCUT": { none: BADGE },
  "com.sonyericsson.home.permission.BROADCAST_BADGE": { none: BADGE },
  "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE": { none: BADGE },
  "com.anddoes.launcher.permission.UPDATE_COUNT": { none: BADGE },
  "com.majeur.launcher.permission.UPDATE_BADGE": { none: BADGE },
  "com.huawei.android.launcher.permission.CHANGE_BADGE": { none: BADGE },
  "com.huawei.android.launcher.permission.READ_SETTINGS": { none: BADGE },
  "com.huawei.android.launcher.permission.WRITE_SETTINGS": { none: BADGE },
  "com.oppo.launcher.permission.READ_SETTINGS": { none: BADGE },
  "com.oppo.launcher.permission.WRITE_SETTINGS": { none: BADGE },
  "me.everything.badger.permission.BADGE_COUNT_READ": { none: BADGE },
  "me.everything.badger.permission.BADGE_COUNT_WRITE": { none: BADGE },
};

const ALL_TYPES = Object.values(GOOGLE_TYPES).flat();

/** Every fault in the answers against what the app asks for and what the privacy policy says: `permissions` from the
 *  built manifest, `policyParts` the headings of the policy's section 3, `outsideIds` its companies. None: the answers
 *  may be typed into Play Console as they stand. */
export function dataSafetyFaults({ permissions, policyParts, outsideIds }, answers = { COLLECTED, PERMISSIONS, POLICY_PARTS, OUTSIDE }) {
  const faults = [];
  const ticked = new Set(answers.COLLECTED.map((c) => c.type));
  const leadsTo = (where, types) => {
    for (const t of types) {
      if (!ALL_TYPES.includes(t)) faults.push(`${where} names "${t}", which is not one of Google's types.`);
      else if (!ticked.has(t)) faults.push(`${where} leads to ${t}, which the answers say is not collected.`);
    }
  };
  for (const c of answers.COLLECTED) {
    if (!ALL_TYPES.includes(c.type)) faults.push(`"${c.type}" is not one of Google's types.`);
    if (c.purposes.length === 0) faults.push(`${c.type} has no purpose.`);
    for (const p of c.purposes) if (!GOOGLE_PURPOSES.includes(p)) faults.push(`${c.type}'s purpose "${p}" is not one of Google's.`);
  }
  for (const p of permissions) {
    const answer = answers.PERMISSIONS[p];
    if (answer === undefined) faults.push(`The app asks for ${p}, which the Data safety answers do not cover.`);
    else if (Array.isArray(answer)) leadsTo(p, answer);
  }
  for (const part of policyParts) {
    const answer = answers.POLICY_PARTS[part];
    if (answer === undefined) faults.push(`The privacy policy's "${part}" is not answered in Data safety.`);
    else if (Array.isArray(answer)) leadsTo(`The privacy policy's "${part}"`, answer);
  }
  for (const id of outsideIds) {
    if (answers.OUTSIDE[id] === undefined) faults.push(`The privacy policy names ${id}, which the Data safety answers do not cover.`);
  }
  return faults;
}
