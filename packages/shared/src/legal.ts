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
import { CURRENT_DISCLAIMER_VERSION, DISCLAIMER_WORDINGS } from "./health.js";
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
  lead: string;
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

const signUpNote = (): string => {
  const words = DISCLAIMER_WORDINGS.sign_up[CURRENT_DISCLAIMER_VERSION.sign_up];
  if (words === undefined) throw new Error("no words for the sign-up note");
  return words;
};

export function privacyPolicy(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  return {
    title: "Privacy Policy",
    lead:
      "KWAZO is a fitness and nutrition app, for people who train on their own and for the members and staff of gyms, studios and other fitness businesses. This policy says what we collect, why, who else receives it, how long we keep it, and what you can do about it.",
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
    lead: `These terms are the agreement between you and ${LEGAL_OWNER}, who runs KWAZO, a fitness and nutrition app. By creating an account or using KWAZO, you agree to them and to our Privacy Policy.`,
    sections: [
      {
        id: "who-can-use",
        heading: "Who can use KWAZO",
        blocks: [
          list(
            "You must be 18 or older.",
            "One account is for one person. Keep your sign-in to yourself; what is done with it is your responsibility.",
            "The details you give must be true, so that the app's numbers fit you.",
          ),
        ],
      },
      {
        id: "not-medical-advice",
        heading: "Not medical advice",
        blocks: [
          p(signUpNote()),
          p("KWAZO is not a medical device. It does not diagnose, treat or prevent any condition."),
        ],
      },
      {
        id: "estimates",
        heading: "Our numbers are estimates",
        blocks: [
          p("Calories, nutrients, meal scans, repetition counts, form scores, distances and predictions are estimates and can be wrong. Check a food's label and its allergens yourself. You train at your own risk: stop if you feel pain, dizziness or shortness of breath. When you run, watch the road and the people around you, not the screen."),
        ],
      },
      {
        id: "on-your-own",
        heading: "If you use KWAZO on your own",
        blocks: [
          p("Some features may need a paid plan. The app shows the price before you pay. A plan bought through Google Play or the App Store follows their terms for billing, cancelling and refunds."),
        ],
      },
      {
        id: "members",
        heading: "If you are a member of a business",
        blocks: [
          p("A gym, studio or other fitness business uses KWAZO to run its memberships, classes, payments and page. What it sells you, its prices, its rules, its waiver and its agreements are between you and the business, and the business is responsible for them and for its classes, its trainers and its premises. We provide the software."),
        ],
      },
      {
        id: "businesses",
        heading: "If you run a business on KWAZO, or work for one",
        blocks: [
          list(
            "You may add only people whose details you are allowed to keep, and email only people you are allowed to email.",
            "Your business is responsible for its prices, its terms, its waivers, its refunds and the laws where it works.",
            "Staff you add act for your business. Give each person only the access they need.",
          ),
        ],
      },
      {
        id: "what-you-post",
        heading: "What you post",
        blocks: [
          p("What you post stays yours. You let us show it to the people the app shows it to, such as the members of your business. Do not post anything unlawful, hateful, threatening, sexual or violent, anyone's private details, spam, or anything pretending to be somebody else. A business and we may remove a post, and anyone can report or block."),
        ],
      },
      {
        id: "fair-use",
        heading: "Using KWAZO fairly",
        blocks: [
          p("Do not break or overload KWAZO, copy its contents in bulk, get around its limits or its checks, take it apart, or use somebody else's account. KWAZO's code, look, words and exercises are ours; you may use them in the app."),
        ],
      },
      {
        id: "ending",
        heading: "Ending",
        blocks: [
          p("You can delete your account at any time: in the app, Me, then Settings, then Delete account. We may suspend or close an account that breaks these terms, and we tell you why, unless the law stops us."),
        ],
      },
      {
        id: "changes",
        heading: "Changes",
        blocks: [
          p("KWAZO changes as we build it: features are added, changed or removed. When these terms change, the date at the top changes. If a change matters to you, the app tells you before it applies."),
        ],
      },
      {
        id: "liability",
        heading: "Our responsibility",
        blocks: [
          p("KWAZO is provided as it is. We work to keep it running and correct, but we cannot promise it is always available or free of mistakes."),
          p("As far as the law allows, we are not responsible for indirect losses, or for what a business does or sells, and our total responsibility to you is the larger of what you paid us in the last 12 months and 100 US dollars. Nothing here limits responsibility the law does not let us limit, such as for death or injury caused by our negligence, or for fraud."),
          p("Nothing in these terms takes away a right the consumer law of your country gives you."),
        ],
      },
      {
        id: "law",
        heading: "The law",
        blocks: [
          p("These terms are governed by the laws of India, and disputes go to the courts of India. If the law of your country gives you the right to go to your own courts, you keep it."),
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

/** Washington State's My Health My Data Act (RCW 19.373.020) asks for this page, with its own link: its
 *  five items and nothing more. Cal AI, MacroFactor, Strava and MyFitnessPal publish one (read 2026-11-08). */
export function washingtonHealthDataPolicy(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  return {
    title: "Washington Consumer Health Data Privacy Policy",
    lead: "Washington State's My Health My Data Act asks for this page. It adds to our Privacy Policy, and covers only the people of Washington State using KWAZO for themselves, and only what that law calls \"consumer health data\".",
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
