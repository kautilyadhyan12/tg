// KWAZO's own documents for the people who use it (ROADMAP Stage 5 item 21b-i; Stage 4 item 3): the
// Privacy Policy, the Terms of Use and the page Washington State's law asks for. Written by us with no
// lawyer (rulings/2026-10-23-18u-i.md): each law's own list and what the code really does. The web shows
// them at the three addresses below and the phone opens them there.
//
// They say only what is true. The api's tests hold them to the code: every outside service the server
// can be switched on for is named in OUTSIDE_SERVICES or said to receive nothing about a person, and
// every table the Day-14 purge keeps is covered by KEPT_AFTER_DELETION (apps/api/test/legal.unit.test.ts).
// A job that makes the app collect or send something new changes these words in the same pull request
// (Kd, 2026-11-08, rulings/2026-11-08-21b-i.md), and they are read again whole before publishing.
// KWAZO is a fitness and nutrition app, never called a health app (Kd, 2026-11-08).
import { ACCOUNT_UNDO_DAYS } from "./privacy.js";
import { GYM_CAN_SEE, GYM_NEVER_SEES, GYM_SEES_IF_YOU_ALLOW } from "./invitations.js";

export const LEGAL_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
  washington: "/washington-health-data",
} as const;

/** The day the words below last changed, `YYYY-MM-DD`. */
export const LEGAL_UPDATED_ON = "2026-11-08";

/** Who runs KWAZO (Kd, 2026-11-08: his full name; a sole proprietorship, RULINGS 2026-09-15). */
export const LEGAL_OWNER = "Kautilya Darshan Baruah";

/** The facts chosen when the server goes online (ROADMAP Stage 5 item 21a): the support address (the api's
 *  SUPPORT_EMAIL, the same one) and the company and country the server runs in. Until then the pages say
 *  they are added before KWAZO is published. */
export interface LegalFacts {
  supportEmail: string | null;
  hosting: string | null;
}
export const LEGAL_FACTS: LegalFacts = { supportEmail: null, hosting: null };

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: readonly string[] }
  | { kind: "table"; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: "links"; items: readonly { label: string; to: string }[] };

export interface LegalSection {
  id: string;
  heading: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  title: string;
  /** The opening paragraphs, before the first section. */
  lead: readonly string[];
  sections: readonly LegalSection[];
}

/** "8 November 2026". */
export function legalDayText(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${String(d ?? "")} ${months[(m ?? 1) - 1] ?? ""} ${String(y ?? "")}`;
}

const p = (text: string): LegalBlock => ({ kind: "p", text });
const list = (...items: string[]): LegalBlock => ({ kind: "list", items });

function writeToUs(facts: LegalFacts): string {
  return facts.supportEmail === null
    ? "Our email address is added here before KWAZO is published."
    : `Write to us at ${facts.supportEmail}.`;
}

/** The companies that handle people's data for us, each with what it receives. The api's test ties each
 *  one to the settings that switch it on. */
export const OUTSIDE_SERVICES = [
  {
    id: "openai",
    name: "OpenAI",
    forWhat: "Reads the food in a meal photo or on a pack's label, and checks food names.",
    gets: "The photo, with the place and time it was taken removed, and the food names and amounts. Never your name or email.",
  },
  {
    id: "resend",
    name: "Resend",
    forWhat: "Sends our emails: sign-in codes, invitations, receipts and reminders.",
    gets: "Your email address and the email itself.",
  },
  {
    id: "firebase",
    name: "Google Firebase",
    forWhat: "Delivers notifications to your phone.",
    gets: "Your phone's notification address and the notification's words.",
  },
  {
    id: "google_sign_in",
    name: "Google sign-in",
    forWhat: "Lets you sign in with your Google account, if you choose to.",
    gets: "That you are signing in to KWAZO. Google gives us your Google id, email and name.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    forWhat: "The robot check, shown only when many codes are asked for, and on a business's enquiry form.",
    gets: "Your internet address and browser details while the check is on screen.",
  },
  {
    id: "openfreemap",
    name: "OpenFreeMap",
    forWhat: "Draws the maps on the phone.",
    gets: "Your internet address and the part of the map on your screen.",
  },
  {
    id: "openstreetmap",
    name: "OpenStreetMap and LocationIQ",
    forWhat: "Draw the maps and find places on our website's running pages.",
    gets: "Your internet address, the part of the map on your screen and the place you type.",
  },
  {
    id: "sentry",
    name: "Sentry",
    forWhat: "Tells us when something breaks in our server.",
    gets: "What went wrong in our code. Never what you sent, your name or your email.",
  },
  {
    id: "square",
    name: "Square",
    forWhat: "Takes card payments for a business that uses it, and keeps a card on file for that business.",
    gets: "Your name, email, phone number and card. We keep only the card's brand, last four digits and expiry date.",
  },
  {
    id: "paddle_razorpay",
    name: "Paddle and Razorpay",
    forWhat: "Take the payment when a business pays us for its plan.",
    gets: "The payer's email address and country, and for Razorpay the business's payments phone number.",
  },
] as const;
export type OutsideServiceId = (typeof OUTSIDE_SERVICES)[number]["id"];

/** What is kept after an account is deleted for good, and for how long. The api's test ties every table
 *  the purge keeps to one of these. */
export const KEPT_AFTER_DELETION = [
  {
    id: "tombstone",
    what: "A record that an account existed, with no name and no email address",
    howLong: "So that the records below still point somewhere",
  },
  {
    id: "consent",
    what: "Your ticks on our notes: the words you agreed to and when",
    howLong: "Six years after the account is deleted, as proof of what you agreed to",
  },
  {
    id: "signed_papers",
    what: "Waivers and agreements you signed with a business, with the name you typed",
    howLong: "Up to six years, for the business, as its proof",
  },
  {
    id: "business_records",
    what: "A business's own records about you: your membership, visits, bookings, payments, bills, notes and the last four digits of a card",
    howLong: "Until the business deletes them, or until our clean-up of a business that has stopped using KWAZO",
  },
  {
    id: "business_content",
    what: "What you wrote or set up for a business as its staff: its posts, events, classes, challenges and meal plans",
    howLong: "As long as the business keeps them",
  },
  {
    id: "money_records",
    what: "Our invoices and billing records for a business's plan",
    howLong: "As long as tax law requires",
  },
  {
    id: "change_log",
    what: "Our log of changes made in the app (who changed what, and when), with the person shown as a deleted user",
    howLong: "To keep the service secure and to answer disputes",
  },
  {
    id: "totals",
    what: "Totals with nobody's name in them: a business's daily numbers, our costs and leaderboards with the name removed",
    howLong: "With nobody's name, so they are not about you",
  },
] as const;
export type KeptAfterDeletionId = (typeof KEPT_AFTER_DELETION)[number]["id"];

const keptTable = (): LegalBlock => ({
  kind: "table",
  head: ["What is kept", "For how long"],
  rows: KEPT_AFTER_DELETION.map((k) => [k.what, k.howLong]),
});

const servicesTable = (): LegalBlock => ({
  kind: "table",
  head: ["Company", "What it does for us", "What it receives"],
  rows: OUTSIDE_SERVICES.map((s) => [s.name, s.forWhat, s.gets]),
});

export function privacyPolicy(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  return {
    title: "Privacy Policy",
    lead: [
      "KWAZO is a fitness and nutrition app, for people who train on their own and for the members and staff of gyms, studios and other fitness businesses. This policy says what we collect, why, who else receives it, how long we keep it, and what you can do about it.",
    ],
    sections: [
      {
        id: "who-we-are",
        heading: "Who we are",
        blocks: [
          p(`KWAZO is run by ${LEGAL_OWNER}, a sole proprietor in India ("we", "us"). We decide how your details are used to run the app, except a business's own records, explained below. ${writeToUs(facts)}`),
        ],
      },
      {
        id: "which-part",
        heading: "Which parts are about you",
        blocks: [
          p("Everything under \"What we collect\" is about everyone who uses KWAZO. Then read the part for you:"),
          {
            kind: "links",
            items: [
              { label: "You use KWAZO on your own", to: "#on-your-own" },
              { label: "You are a member of a gym, studio or other fitness business", to: "#members" },
              { label: "You run a business on KWAZO, or work for one", to: "#businesses" },
              { label: "A business added you, and you do not use the app", to: "#added-by-a-business" },
            ],
          },
        ],
      },
      {
        id: "what-we-collect",
        heading: "What we collect",
        blocks: [
          list(
            "Your account: your email address and name, your phone's time zone, and your units. If you sign in with Google, Google's id for you and the email and name Google gives us.",
            "Your sign-ins: when you signed in, and the internet address and the browser or phone it came from, to keep your account safe.",
            "Your setup answers: age, sex, height, the weight you aim for, your fitness level and goals, your training days, places and equipment, your diet and meals a day.",
            "The health question: one yes or no answer, whether you have a condition, an injury or a pregnancy that needs care, and whether a professional has cleared you. We never ask which condition. A yes makes the app more careful.",
            "Your training: workouts, sets, repetitions, times, form scores, streaks, badges and challenges.",
            "The camera, when you train with it: it watches you only while you exercise, on your own phone. Nothing is recorded. No video or photo is saved, sent to us or seen by anyone, not even us, and when you finish, it is gone. Only your results are kept, as words and numbers: your repetitions, sets, time, form score and the mistakes found.",
            "Your food: the meals you log (foods, amounts, calories and nutrients), your own foods and dishes, and your meal plan.",
            "Meal and label photos: sent to our server to read the food, then thrown away. We never keep the photo. The food list read from it waits up to 24 hours for you to save it.",
            "Your body: the weight and body measurements you log.",
            "Your runs: your phone's location while you record a run, giving its route, distance and times. Only while the app is open or the run's notification is showing, never in the background otherwise.",
            "On a business's page: the posts, photos, comments and reactions you add, and the reports and blocks you make.",
            "Notifications: your phone's notification address and your notification switches.",
            "Your ticks: when you tick one of our notes, the words, their version, the app's version and the time.",
            "How you use the app: the minutes it is open each day, and when you use a meal scan or plan a route, to run the service and its daily limits.",
            "What you write to us.",
          ),
        ],
      },
      {
        id: "why",
        heading: "Why we use it",
        blocks: [
          list(
            "To give you the app: your plan, your numbers, your workouts, your food and your runs. This is what you sign up for.",
            "The health question, your weight and your measurements: only with your consent, given when you answer or log them. You can withdraw it by deleting them or your account.",
            "To keep KWAZO secure and stop misuse: sign-ins, robot checks, daily limits and our log of changes.",
            "To meet the law: invoices, and proof of what you agreed to.",
            "To tell you what you asked to hear: sign-in codes, a business's messages, and the reminders you switch on.",
          ),
          p("We do not sell your details, we show no advertising, we use no advertising or analytics tools, and we do not follow you across other apps or websites. We do not use your details to train AI models."),
        ],
      },
      {
        id: "who-else",
        heading: "Who else receives it",
        blocks: [
          p("These companies work for us, and each receives only what it needs:"),
          servicesTable(),
          p(
            facts.hosting === null
              ? "The company that runs our server and keeps our database is named here before KWAZO is published."
              : `Our server and database run with ${facts.hosting}.`,
          ),
          p("Some of these companies work in other countries, including the United States, so your details may be handled there, under each company's own terms for handling data for its customers. We share details with the police or a court only when the law requires it."),
        ],
      },
      {
        id: "on-your-own",
        heading: "If you use KWAZO on your own",
        blocks: [
          p("What you put in is yours. No business sees it. If you later join a business, the part below says what it sees."),
        ],
      },
      {
        id: "members",
        heading: "If you are a member of a gym, studio or other fitness business",
        blocks: [
          p("Your workouts, food, body and runs stay yours. The business sees only this, the same list the app shows when you join:"),
          list(...GYM_CAN_SEE),
          p("Only if you allow it:"),
          list(...GYM_SEES_IF_YOU_ALLOW),
          p("Never:"),
          list(...GYM_NEVER_SEES, "Your answer to the health question"),
          p("The business keeps its own records about you in KWAZO: your membership, visits, bookings, payments, its notes, and the waivers and agreements you sign with it. Those records are the business's. It decides about them and answers for them, and we keep them for it. When you leave or delete your account, the business keeps its records of your time with it."),
        ],
      },
      {
        id: "businesses",
        heading: "If you run a business on KWAZO, or work for one",
        blocks: [
          p("Your own account is handled like anyone's above. The details your business adds about other people (its members' list, its leads and their payments) are your business's. You must have their permission, which the app asks you to confirm when you import or invite. We keep them only to run KWAZO for your business."),
          p("What staff change is kept in our log of changes. If a business has no paid plan and none of its staff signs in for six months, its members' list and leads are deleted, after emails a month and a week before."),
          p(`To run the service, we (${LEGAL_OWNER}) can see each person's name, email address, sign-up date, last visit, plan, minutes in the app and meal scans. Never their health answer, weight, meals, photos or runs.`),
        ],
      },
      {
        id: "added-by-a-business",
        heading: "If a business added you, and you do not use the app",
        blocks: [
          p("A business you belong to may keep your details in KWAZO: your name, email address, phone number, membership and date of birth, and its own columns. The business is responsible for them, and we handle them only for it. It may send you an invitation to the app by email. If you fill in a business's enquiry form, your name, email, phone number and message go to that business."),
          p(`To see, correct or delete these details, ask the business. You can also write to us. ${writeToUs(facts)}`),
        ],
      },
      {
        id: "how-long",
        heading: "How long we keep it",
        blocks: [
          p(`We keep your details while your account is open. When you delete your account, you are signed out at once and you leave every business you belong to. Your account is deleted for good ${String(ACCOUNT_UNDO_DAYS)} days later. Until then, the link we email you brings it back. After that, only this is kept:`),
          keptTable(),
          p("A sign-in code is deleted two days after it was sent."),
        ],
      },
      {
        id: "your-rights",
        heading: "Your choices and your rights",
        blocks: [
          list(
            "See and download your details: in the app, Me, then Settings, then Download my data.",
            "Correct them: in the app, Me, then Settings.",
            "Delete your account: in the app, Me, then Settings, then Delete account. Someone who owns a business deletes their account on the website, where they manage the business.",
            "Withdraw your consent, object to how we use your details, or ask us anything about them: write to us. We answer within one month.",
            "Complain to the authority that looks after personal data where you live.",
          ),
        ],
      },
      {
        id: "age",
        heading: "Age",
        blocks: [
          p("KWAZO is for people aged 18 or older. We do not knowingly collect details from anyone younger. If we learn that we have, we delete them."),
        ],
      },
      {
        id: "security",
        heading: "How we protect it",
        blocks: [
          p("Sign-in codes and passwords are kept only in a form that cannot be read back. Card numbers never reach us. The phone keeps your sign-in in its own secure storage."),
        ],
      },
      {
        id: "laws",
        heading: "The laws we follow",
        blocks: [
          p("We follow the privacy laws of the places our users live, among them India's Digital Personal Data Protection Act, the European Union's and the United Kingdom's GDPR, Canada's PIPEDA and California's privacy laws. Where those laws use the words, we are the \"data fiduciary\" or \"controller\" for your own details, and the \"processor\" of a business's records."),
          p("KWAZO does not follow you across websites, so it treats a browser's \"Do Not Track\" signal like any other visit."),
          {
            kind: "links",
            items: [{ label: "If you live in Washington State: the Washington Consumer Health Data Privacy Policy", to: LEGAL_PATHS.washington }],
          },
        ],
      },
      {
        id: "changes",
        heading: "Changes to this policy",
        blocks: [
          p("When this policy changes, the date at the top changes. If a change matters to you, the app tells you before it applies."),
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        blocks: [p(`${LEGAL_OWNER}, India. ${writeToUs(facts)}`)],
      },
    ],
  };
}

export function termsOfUse(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  return {
    title: "Terms of Use",
    lead: [
      `These Terms of Use ("Terms") constitute a legally binding agreement between you ("User" or "you") and ${LEGAL_OWNER}, the owner and operator of KWAZO ("KWAZO," "we," "us," or "our"), a fitness and nutrition application.`,
      "By creating an account, accessing, or using KWAZO, you acknowledge that you have read, understood, and agreed to be bound by these Terms and our Privacy Policy.",
    ],
    sections: [
      {
        id: "eligibility",
        heading: "1. Eligibility and Account Responsibilities",
        blocks: [
          p("1.1. You must be at least 18 years of age to create an account or use KWAZO."),
          p("1.2. Each account is intended for individual use by a single person. You are responsible for maintaining the confidentiality of your account credentials and for all activities conducted through your account."),
          p("1.3. You agree to provide accurate, truthful, and complete information when registering for and using KWAZO. Accurate personal information is necessary for the application to generate recommendations, calculations, and other results appropriate to your individual circumstances."),
        ],
      },
      {
        id: "health-disclaimer",
        heading: "2. Health and Medical Disclaimer",
        blocks: [
          p("2.1. KWAZO is intended exclusively for individuals aged 18 years or older and provides fitness, workout, exercise, and nutrition-related guidance designed to support users in achieving their health and fitness objectives."),
          p("2.2. All information, recommendations, and guidance provided through KWAZO are intended for general fitness and informational purposes only and must not be considered a substitute for professional medical advice, diagnosis, or treatment."),
          p("2.3. If you have an existing medical condition, physical injury, are pregnant, take any medication, or have any specific health-related concerns, you should consult a qualified healthcare professional before making significant modifications to your exercise routine, physical activity, or dietary habits. You should follow the advice and recommendations provided by such professionals."),
          p("2.4. KWAZO is not a medical device and is not intended to diagnose, treat, or prevent any medical condition or disease."),
        ],
      },
      {
        id: "estimates",
        heading: "3. Fitness Figures and Training Safely",
        blocks: [
          p("3.1. KWAZO calculates calories, nutritional values, meal scans, exercise repetition counts, exercise form scores, distances, and other fitness figures to help you understand and track your progress."),
          p("3.2. These figures are carefully calculated estimates. As with any fitness application, they may occasionally differ from exact values, so they are best used as a guide alongside your own judgment."),
          p("3.3. If you have a food allergy or a specific dietary requirement, please check food labels and ingredients before eating."),
          p("3.4. Train at a pace that suits your fitness level, and pause or stop if you feel pain, dizziness, or shortness of breath."),
          p("3.5. When running or training outdoors, stay aware of traffic, other people, and your surroundings. KWAZO's spoken updates let you keep your attention on your route rather than your screen."),
        ],
      },
      {
        id: "payments",
        heading: "4. Individual Users, Subscriptions, and Payments",
        blocks: [
          p("4.1. KWAZO may offer certain features and functionalities that require a paid subscription or plan."),
          p("4.2. Where payment is required, the applicable subscription price will be displayed to the user before the purchase is completed."),
          p("4.3. Subscriptions or plans purchased through Google Play or the Apple App Store are subject to the respective platform's applicable terms and conditions, including provisions governing billing, subscription cancellation, and refunds."),
        ],
      },
      {
        id: "members",
        heading: "5. Memberships and Services Provided by Fitness Businesses",
        blocks: [
          p("5.1. KWAZO may be used by gyms, fitness studios, and other fitness-related businesses to manage memberships, classes, payments, and business pages through the application."),
          p("5.2. Any products, memberships, classes, training sessions, or other services offered or sold by a participating business are provided by that business and not by KWAZO."),
          p("5.3. The prices, policies, membership conditions, waivers, contractual agreements, and other terms applicable to such products or services are established between the user and the relevant business."),
          p("5.4. Each participating business remains responsible for its products, services, classes, trainers, facilities, premises, and the performance of its contractual obligations to its members or customers."),
          p("5.5. KWAZO acts as a software platform that facilitates the management and administration of these business activities and does not assume responsibility for the products or services independently provided by participating businesses."),
        ],
      },
      {
        id: "businesses",
        heading: "6. Responsibilities of Business Owners and Staff",
        blocks: [
          p("6.1. Businesses using KWAZO must ensure that they have the necessary authorization or lawful basis to collect, add, store, and maintain the personal information of individuals within the application."),
          p("6.2. Businesses may send emails or other permitted communications only to individuals they are legally authorized to contact."),
          p("6.3. Each business is independently responsible for establishing and administering its pricing, terms and conditions, waivers, refund policies, and compliance with all applicable laws and regulations in the jurisdictions in which it operates."),
          p("6.4. Staff members granted access to a business account act on behalf of the respective business. The business is responsible for assigning and managing staff permissions and ensuring that each staff member receives only the level of access necessary to perform their assigned responsibilities."),
        ],
      },
      {
        id: "content",
        heading: "7. User-Generated Content and Community Standards",
        blocks: [
          p("7.1. You retain ownership of the content you create, submit, upload, or publish through KWAZO."),
          p("7.2. By submitting or publishing content through the application, you grant KWAZO permission to display and make such content available to the individuals or groups for whom it is intended to be visible within the application, including members of a business where applicable."),
          p("7.3. You must not submit, upload, publish, or distribute content that:"),
          list(
            "Violates any applicable law or regulation.",
            "Contains hateful, threatening, sexually explicit, or violent material.",
            "Discloses another individual's private or personal information without appropriate authorization.",
            "Constitutes spam or unsolicited promotional material.",
            "Impersonates another person or misrepresents an individual's identity.",
          ),
          p("7.4. KWAZO and participating businesses reserve the right to remove content that violates these Terms or applicable community standards."),
          p("7.5. Users may report inappropriate content or block other users through the reporting and blocking functionalities made available within the application."),
        ],
      },
      {
        id: "acceptable-use",
        heading: "8. Acceptable Use and Intellectual Property",
        blocks: [
          p("8.1. You agree to use KWAZO only for lawful purposes and in accordance with these Terms."),
          p("8.2. You must not:"),
          list(
            "Disrupt, damage, interfere with, or place an excessive load on the application, its systems, or its services.",
            "Copy, extract, or reproduce the application's content in bulk.",
            "Circumvent, bypass, or interfere with any technical restrictions, usage limits, security measures, or verification mechanisms implemented by KWAZO.",
            "Reverse engineer, decompile, disassemble, or otherwise attempt to examine or reconstruct the application's underlying software or technical components.",
            "Access or use another individual's account without authorization.",
          ),
          p("8.3. All intellectual property rights relating to KWAZO, including its software code, visual design, appearance, written content, and exercise materials, belong to KWAZO."),
          p("8.4. Users are permitted to access and use these materials only within the application and in accordance with these Terms."),
        ],
      },
      {
        id: "ending",
        heading: "9. Account Deletion, Suspension, and Termination",
        blocks: [
          p("9.1. Users may request the deletion of their accounts at any time through the following navigation path within the application: Me → Settings → Delete account."),
          p("9.2. KWAZO reserves the right to suspend or terminate accounts that violate these Terms."),
          p("9.3. Where an account is suspended or terminated for a violation, KWAZO will provide the affected user with an explanation of the reason for such action, except where disclosure is prohibited by applicable law."),
        ],
      },
      {
        id: "changes",
        heading: "10. Changes to the Application and These Terms",
        blocks: [
          p("10.1. KWAZO is an evolving software platform, and its features, functionalities, and services may be introduced, modified, updated, or discontinued as part of its ongoing development."),
          p("10.2. KWAZO reserves the right to modify or update these Terms from time to time."),
          p("10.3. Whenever these Terms are revised, the \"Last Updated\" date displayed at the beginning of this document will be amended accordingly."),
          p("10.4. Where a modification materially affects users, KWAZO will provide notice through the application before the relevant change takes effect."),
        ],
      },
      {
        id: "liability",
        heading: "11. Disclaimer of Warranties and Limitation of Liability",
        blocks: [
          p("11.1. We work continuously to keep KWAZO reliable, accurate, and available. As with any online service, there may occasionally be interruptions, updates, or errors, and KWAZO is therefore provided on an \"as is\" basis."),
          p("11.2. To the maximum extent permitted by applicable law, KWAZO shall not be liable for indirect losses or damages arising from or relating to the use of the application."),
          p("11.3. KWAZO shall not be responsible for the conduct, products, services, or transactions of independently operated businesses that use the platform."),
          p("11.4. To the maximum extent permitted by applicable law, KWAZO's total aggregate liability to any user arising from or relating to the application or these Terms shall not exceed the greater of:"),
          list(
            "The total amount paid by that user directly to KWAZO during the 12 months immediately preceding the event giving rise to the claim; or",
            "USD 100 (one hundred United States dollars).",
          ),
          p("11.5. Nothing in these Terms excludes or limits any liability that cannot lawfully be excluded or limited, including liability for death or personal injury resulting from negligence, or liability arising from fraud."),
          p("11.6. Nothing in these Terms shall exclude, restrict, or diminish any mandatory rights or protections available to users under the applicable consumer protection laws of their respective countries."),
        ],
      },
      {
        id: "law",
        heading: "12. Governing Law and Jurisdiction",
        blocks: [
          p("12.1. These Terms shall be governed by and interpreted in accordance with the laws of India."),
          p("12.2. Any dispute arising from or relating to these Terms or the use of KWAZO shall be subject to the jurisdiction of the courts of India."),
          p("12.3. Notwithstanding the foregoing, where the applicable laws of a user's country grant that user the right to initiate legal proceedings before the courts of their own jurisdiction, nothing in these Terms shall restrict or remove that right."),
        ],
      },
      {
        id: "contact",
        heading: "13. Contact Information",
        blocks: [
          p("For inquiries, concerns, or communications relating to these Terms of Use or the KWAZO application, users may contact:"),
          p(`Owner and Operator: ${LEGAL_OWNER}`),
          p("Application: KWAZO"),
          p("Country: India"),
          p(`Email Address: ${facts.supportEmail ?? "To be added before the official publication of KWAZO."}`),
        ],
      },
    ],
  };
}

/** Washington State's My Health My Data Act (RCW 19.373.020) asks for this page, with its own link: its
 *  five items and nothing more. Cal AI, MacroFactor, Strava and MyFitnessPal publish one (read 2026-11-08). */
export function washingtonHealthDataPolicy(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  return {
    title: "Washington Consumer Health Data Privacy Policy",
    lead: ["Washington State's My Health My Data Act asks for this page. It adds to our Privacy Policy, and covers only the people of Washington State using KWAZO for themselves, and only what that law calls \"consumer health data\"."],
    sections: [
      {
        id: "collected",
        heading: "What we collect, and why",
        blocks: [
          list(
            "Your answer to the health question, and whether a professional has cleared you: to make the app more careful.",
            "The weight and body measurements you log: to show your progress and set your plan.",
            "The meals you log, with their calories and nutrients: to count your food against your plan.",
            "Your workouts, form scores and runs: to count your training and show your progress.",
            "What the app works out from these, such as your calorie and protein targets.",
          ),
        ],
      },
      {
        id: "sources",
        heading: "Where it comes from",
        blocks: [p("From you, and from your phone while you use the app: your results from the camera, such as repetitions and form scores (the camera records nothing, and no video ever leaves your phone), and your location while you record a run.")],
      },
      {
        id: "shared",
        heading: "What we share, and with whom",
        blocks: [
          p("We never sell it. We share it only:"),
          list(
            "With the companies that run KWAZO for us: the company that hosts our server, OpenAI for meal photos, and Google Firebase for notifications, whose words may mention your training or meals.",
            "With a business you are a member of: your workouts and form scores, and your meals, weight and measurements only if you allow it.",
          ),
        ],
      },
      {
        id: "rights",
        heading: "Your rights",
        blocks: [
          p("You can ask whether we hold your consumer health data, see it, delete it, and withdraw your consent. In the app: Me, then Settings, then Download my data or Delete account."),
          p(`Or write to us. ${writeToUs(facts)} If we turn down a request, you can appeal by writing to us again, and if you are not happy with the answer, you can contact the Washington State Attorney General.`),
        ],
      },
    ],
  };
}
