// THE WORST THING THE PRIVACY POLICY COULD DO TO A REAL PERSON: tell them we do not share or keep
// something that we do (ROADMAP Stage 5 21b-i). So the policy's two lists are held to the code's own,
// from outside the policy: every setting of the server's (config.ts) is either the switch of a service
// the policy names, or said here to send nothing about a person; and every table the Day-14 purge keeps
// (privacy/tables.ts) is covered by a line of "How long we keep it". A new outside service or a new kept
// table fails here until the policy says so.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KEPT_AFTER_DELETION,
  KWAZO_IS,
  LEGAL_FACTS,
  OUTSIDE_SERVICES,
  privacyPolicy,
  termsOfUse,
  washingtonHealthDataPolicy,
  type KeptAfterDeletionId,
  type LegalDocument,
  type OutsideServiceId,
  GYM_CAN_SEE,
  GYM_NEVER_SEES,
  GYM_SEES_IF_YOU_ALLOW,
} from "@app/shared";
import { USER_LINKED_NOT_PURGED_TABLES } from "../src/modules/privacy/tables.js";

const src = new URL("../src/", import.meta.url);
const configText = readFileSync(new URL("config.ts", src), "utf8");
const settings = [...(configText.match(/const envSchema = z\.object\(\{([\s\S]*?)\n\}\)/)?.[1] ?? "").matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map(
  (m) => m[1] ?? "",
);

/** The settings that switch on an outside service the policy names. */
const SERVICE_SWITCHES: Record<string, OutsideServiceId> = {
  OPENAI_API_KEY: "openai",
  MEAL_VISION_MODEL: "openai",
  RESEND_API_KEY: "resend",
  EMAIL_FROM: "resend",
  INVITE_EMAIL_FROM: "resend",
  RESEND_WEBHOOK_SECRET: "resend",
  OPERATOR_EMAIL: "resend",
  CODE_EMAILS_PER_DAY: "resend",
  INVITE_EMAILS_PER_DAY: "resend",
  INVITES_PAUSED: "resend",
  FIREBASE_SERVICE_ACCOUNT_FILE: "firebase",
  GOOGLE_CLIENT_ID: "google_sign_in",
  GOOGLE_CLIENT_SECRET: "google_sign_in",
  GOOGLE_CALLBACK_URL: "google_sign_in",
  TURNSTILE_SITE_KEY: "cloudflare",
  TURNSTILE_SECRET_KEY: "cloudflare",
  MAP_SOURCE: "openfreemap",
  SENTRY_DSN: "sentry",
  SQUARE_ENV: "square",
  SQUARE_APPLICATION_ID: "square",
  SQUARE_APPLICATION_SECRET: "square",
  SQUARE_WEBHOOK_SIGNATURE_KEY: "square",
  SQUARE_WEBHOOK_URL: "square",
  PAYMENT_TOKENS_KEY: "square",
  PADDLE_ENV: "paddle_razorpay",
  PADDLE_API_KEY: "paddle_razorpay",
  PADDLE_CLIENT_TOKEN: "paddle_razorpay",
  PADDLE_WEBHOOK_SECRET: "paddle_razorpay",
  RAZORPAY_KEY_ID: "paddle_razorpay",
  RAZORPAY_KEY_SECRET: "paddle_razorpay",
  RAZORPAY_WEBHOOK_SECRET: "paddle_razorpay",
};

/** Settings that send nothing about a person to anyone outside, each with why. */
const SENDS_NOTHING_ABOUT_A_PERSON: Record<string, string> = {
  NODE_ENV: "the server's own",
  PORT: "the server's own",
  LOG_LEVEL: "the server's own",
  DATABASE_URL: "our own database (the host is named in the policy once chosen, 21a)",
  DATABASE_POOL_MAX: "the server's own",
  WEB_ORIGIN: "our own website",
  API_ORIGIN: "our own server",
  JWT_SECRET: "the server's own",
  ACCESS_TTL_MIN: "the server's own",
  REFRESH_TTL_DAYS: "the server's own",
  REDIS_URL: "our own store",
  LIVE_LINES: "the server's own",
  LIVE_PORT: "the server's own",
  INVITE_HMAC_SECRET: "the server's own",
  CHECKIN_PASS_SECRET: "the server's own",
  ADMIN_USER_ID: "the server's own (the policy says the owner sees account details)",
  JOIN_CODES: "the server's own",
  MEMBER_TAP: "the server's own",
  PHOTO_DIR: "our own disk",
  SUPPORT_EMAIL: "our own address",
  POSTHOG_API_KEY: "nothing calls it: no event is sent (checked below)",
  POSTHOG_HOST: "nothing calls it: no event is sent (checked below)",
  ORS_API_KEY: "route planning: no screen asks the server for a route today (checked below; the policy adds OpenRouteService when one does)",
  PACKAGED_FOOD_UPDATES: "downloads Open Food Facts' public files; sends only our own contact address",
  OPEN_FOOD_FACTS_CONTACT: "our own contact address, in that download's request",
  MAP_PROTOMAPS_FILE: "our own copy of the map",
  MAP_PROTOMAPS_GLYPHS: "our own copy of the map's letters",
  HEIGHTS_DIR: "our own copy of the heights",
  HEIGHTS_COPERNICUS: "public height files, asked for by whole squares of the map, never with a person or a run",
  HEIGHTS_MAPZEN: "public height files, asked for by whole squares of the map, never with a person or a run",
  HEIGHTS_MOST_SQUARES_KEPT: "the server's own",
};

/** Where each table the purge keeps is said in "How long we keep it", every one named: a new kept table
 *  fails until somebody says which line covers it. */
const KEPT_TABLES: Record<string, KeptAfterDeletionId> = {
  users: "tombstone",
  consent_log: "consent",
  gym_waiver_signatures: "signed_papers",
  gym_waiver_desk_signatures: "signed_papers",
  gym_agreement_signatures: "signed_papers",
  gym_agreement_sign_links: "signed_papers",
  gym_card_agreements: "signed_papers",
  gym_posts: "business_content",
  gym_post_comments: "business_content",
  gym_events: "business_content",
  gym_challenges: "business_content",
  gym_meal_plans: "business_content",
  gym_meal_plan_audiences: "business_content",
  gym_page_photos: "business_content",
  gym_class_types: "business_content",
  gym_class_schedules: "business_content",
  gym_class_sessions: "business_content",
  gym_closures: "business_content",
  gym_price_raises: "business_content",
  gym_membership_word_links: "business_content",
  gym_trainers: "business_content",
  gym_trainer_time_off: "business_content",
  gym_waivers: "business_content",
  gym_agreements: "business_content",
  gym_referral_settings: "business_content",
  gym_group_messages: "business_content",
  gyms: "business_records",
  gym_members: "business_records",
  gym_staff: "business_records",
  gym_join_applications: "business_records",
  gym_attendance: "business_records",
  gym_attendance_removed: "business_records",
  gym_cheers: "business_records",
  gym_nudges: "business_records",
  gym_member_list_uploads: "business_records",
  gym_checkin_devices: "business_records",
  gym_class_bookings: "business_records",
  gym_leads: "business_records",
  gym_event_places: "business_records",
  gym_pt_appointments: "business_records",
  gym_staff_invites: "business_records",
  gym_staff_roles: "business_records",
  gym_co_owner_requests: "business_records",
  gym_owner_requests: "business_records",
  gym_member_notes: "business_records",
  gym_member_tags: "business_records",
  gym_member_entry_tags: "business_records",
  gym_member_payers: "business_records",
  gym_member_payments: "business_records",
  gym_member_bills: "business_records",
  gym_member_refunds: "business_records",
  gym_sales: "business_records",
  gym_sale_refunds: "business_records",
  gym_payment_connections: "business_records",
  gym_payment_connect_starts: "business_records",
  gym_square_terminals: "business_records",
  gym_member_cards: "business_records",
  gym_terminal_card_saves: "business_records",
  gym_terminal_payments: "business_records",
  gym_app_payments: "business_records",
  gym_card_charges: "business_records",
  gym_square_refunds: "business_records",
  gym_square_disputes: "business_records",
  gym_autopay_pauses: "business_records",
  gym_referral_member_gifts: "business_records",
  gym_referral_kept_invites: "business_records",
  invoices: "money_records",
  subscriptions: "money_records",
  billing_checkouts: "money_records",
  billing_plan_changes: "money_records",
  audit_log: "change_log",
  org_daily_stats: "totals",
  leaderboard_snapshots: "totals",
  api_cost_events: "totals",
  usage_daily: "totals",
};

/** Kept tables that hold nothing about the person the policy speaks to, each with why (checked below). */
const NOT_ABOUT_THE_PERSON: Record<string, string> = {
  trace_samples: "nothing writes it",
  exercise_definitions: "who of our own team published an app exercise",
};

describe("the privacy policy against the code", () => {
  it("every setting of the server is a service the policy names, or sends nothing about a person", () => {
    expect(settings.length).toBeGreaterThan(40);
    const unsaid = settings.filter((k) => !Object.hasOwn(SERVICE_SWITCHES, k) && !Object.hasOwn(SENDS_NOTHING_ABOUT_A_PERSON, k));
    expect(unsaid).toEqual([]);
    // And the two lists here name only real settings, so neither can hide a renamed one.
    const gone = [...Object.keys(SERVICE_SWITCHES), ...Object.keys(SENDS_NOTHING_ABOUT_A_PERSON)].filter((k) => !settings.includes(k));
    expect(gone).toEqual([]);
  });

  it("every service the policy names is one the app really uses", () => {
    const switched = new Set(Object.values(SERVICE_SWITCHES));
    // The website's running pages call OpenStreetMap and LocationIQ from the browser, with no server setting.
    const fromTheBrowser = new Set<OutsideServiceId>(["openstreetmap"]);
    expect(OUTSIDE_SERVICES.map((s) => s.id).filter((id) => !switched.has(id) && !fromTheBrowser.has(id))).toEqual([]);
    const web = readFileSync(new URL("../../web/src/components/running/LocationAutocomplete.jsx", import.meta.url), "utf8");
    expect(web).toContain("nominatim.openstreetmap.org");
  });

  it("nothing sends PostHog an event, and nothing writes trace_samples", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const path = join(dir, f);
        return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
      });
    const paths = files(src.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    // analytics.ts makes the PostHog client; only app.ts builds it, and nothing calls its `capture`.
    const callers = paths.filter((f) => !f.endsWith("analytics.ts") && /\.capture\(/.test(readFileSync(f, "utf8")));
    expect(callers).toEqual([]);
    const importers = paths
      .filter((f) => /from "(?:\.\.?\/)+analytics\.js"/.test(readFileSync(f, "utf8")))
      .map((f) => f.split(/[\\/]src[\\/]/)[1]);
    expect(importers).toEqual(["app.ts"]);
    const all = paths.map((f) => readFileSync(f, "utf8"));
    expect(all.filter((t) => /INSERT INTO trace_samples|insert\(traceSamples\)/.test(t))).toEqual([]);
  });

  it("no screen of the phone or the website asks the server to plan a route, so OpenRouteService is sent nothing", () => {
    const callers = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const path = join(dir, f);
        if (statSync(path).isDirectory()) return f === "node_modules" ? [] : callers(path);
        return /\.(tsx?|jsx?)$/.test(f) && !f.includes(".test.") && readFileSync(path, "utf8").includes("geo/routes/generate") ? [path] : [];
      });
    const root = (rel: string) => new URL(rel, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    expect([...callers(root("../../mobile/src/")), ...callers(root("../../web/src/"))]).toEqual([]);
  });

  it("Washington's page names every company that may receive consumer health data", () => {
    const washington = JSON.stringify(washingtonHealthDataPolicy());
    expect(OUTSIDE_SERVICES.filter((s) => s.healthData && !washington.includes(`${s.name}:`)).map((s) => s.name)).toEqual([]);
  });

  it("both pages name the company that hosts the server, and the policy names where it is (21a-i)", () => {
    expect(JSON.stringify(privacyPolicy())).toContain(
      "This service provider is Amazon Web Services (AWS), and KWAZO's servers and database are located in Sydney, Australia.",
    );
    expect(JSON.stringify(privacyPolicy())).toContain("including the United States, Australia and Japan.");
    expect(JSON.stringify(washingtonHealthDataPolicy())).toContain("Hosting Infrastructure Provider: Amazon Web Services (AWS), responsible");
  });

  it("the nightly backup goes where the policy says the server is, and the policy says how long a copy stays (21a-ii)", () => {
    const script = readFileSync(new URL("../../../infra/backup-selfhost.sh", import.meta.url), "utf8");
    const region = script.match(/^REGION="([a-z0-9-]+)"$/m)?.[1];
    const AWS_REGION_PLACES: Record<string, string> = { "ap-southeast-2": "Sydney, Australia" };
    expect(AWS_REGION_PLACES[region ?? ""]).toBe(LEGAL_FACTS.hosting?.place);
    expect(script).toContain("pg_dump");
    expect(JSON.stringify(privacyPolicy())).toContain("Information deleted from KWAZO may therefore remain in these copies for up to 28 days.");
  });

  it("what a business sees, in the policy, matches the Join screen's lists one for one", () => {
    const members = JSON.stringify(privacyPolicy().sections.find((s) => s.id === "members"));
    // Each line of the Join screen, and the policy's own words for it (Kd's text).
    const SAID_AS: Record<string, string> = {
      "Your name and email address": "Your name and email address.",
      "Your workouts: dates, exercises, sets, reps, hold times and duration":
        "Workout information, including workout dates, exercises, sets, repetitions, hold times, and exercise duration.",
      "Your form scores and form faults": "Exercise form scores and identified form faults.",
      "Your streaks and challenges": "Training streaks and participation in challenges.",
      "Your meals and nutrition": "Meals and nutritional information.",
      "Your weight and body measurements": "Body weight and body measurements.",
      "Your running routes": "Your recorded running routes.",
    };
    const screen: string[] = [...GYM_CAN_SEE, ...GYM_SEES_IF_YOU_ALLOW, ...GYM_NEVER_SEES];
    expect(screen.filter((line) => !Object.hasOwn(SAID_AS, line))).toEqual([]);
    expect(Object.values(SAID_AS).filter((line) => !members.includes(line))).toEqual([]);
  });

  it("every table the purge keeps is covered by a line of How long we keep it", () => {
    const uncovered = USER_LINKED_NOT_PURGED_TABLES.filter(
      (t) => !Object.hasOwn(KEPT_TABLES, t) && !Object.hasOwn(NOT_ABOUT_THE_PERSON, t),
    );
    expect(uncovered).toEqual([]);
    const kept = new Set<string>(USER_LINKED_NOT_PURGED_TABLES);
    expect([...Object.keys(KEPT_TABLES), ...Object.keys(NOT_ABOUT_THE_PERSON)].filter((t) => !kept.has(t))).toEqual([]);
    // Every line of the policy's list is about a table that is really kept.
    const used = new Set<string>(Object.values(KEPT_TABLES));
    expect(KEPT_AFTER_DELETION.map((k) => k.id).filter((id) => !used.has(id))).toEqual([]);
  });

  it("the sign-in records are not on the kept list: they go with the account", () => {
    const kept = new Set<string>(USER_LINKED_NOT_PURGED_TABLES);
    expect(["refresh_tokens", "one_time_tokens"].filter((t) => kept.has(t))).toEqual([]);
  });

  it("the three documents never call KWAZO a health app, and say it is a fitness and nutrition app", () => {
    const text = (d: LegalDocument) => JSON.stringify(d);
    const docs = [privacyPolicy(), termsOfUse(), washingtonHealthDataPolicy()];
    expect(docs.filter((d) => /health app|medical app|health application/i.test(text(d)))).toEqual([]);
    // KWAZO first, then who owns it (Kd, 2026-11-08), in all three.
    for (const d of docs) expect(d.lead.join(" ")).toContain(KWAZO_IS);
  });
});
