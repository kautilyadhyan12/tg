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

export const LEGAL_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
  washington: "/washington-health-data",
  deleteAccount: "/delete-account",
} as const;

/** The day the words below last changed, `YYYY-MM-DD`. */
export const LEGAL_UPDATED_ON = "2026-11-09";

/** Who runs KWAZO (Kd, 2026-11-08: his full name; a sole proprietorship, RULINGS 2026-09-15). */
export const LEGAL_OWNER = "Kautilya Darshan Baruah";

/** The facts chosen when the server goes online (ROADMAP Stage 5 item 21a): the support address (the api's
 *  SUPPORT_EMAIL, the same one) and the company and country the server runs in. Until then the pages say
 *  they are added before KWAZO is published. */
export interface LegalFacts {
  supportEmail: string | null;
  hosting: { company: string; place: string } | null;
}
export const LEGAL_FACTS: LegalFacts = {
  supportEmail: null,
  // The test server (21a-i, RUNBOOK/test-server.md): AWS's free plan opens Sydney alone.
  hosting: { company: "Amazon Web Services (AWS)", place: "Sydney, Australia" },
};

/** How long the test server's nightly copy is kept (21a-ii): the backup bucket's lifecycle rule, 14 days
 *  for a copy and 14 more for an earlier version of it (RUNBOOK/test-server.md, "Backups"). */
export const BACKUP_KEEP_DAYS = 14;

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "strong"; text: string }
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
const h3 = (text: string): LegalBlock => ({ kind: "h3", text });
const strong = (text: string): LegalBlock => ({ kind: "strong", text });
const list = (...items: string[]): LegalBlock => ({ kind: "list", items });

/** "KWAZO ("KWAZO," "we," "us," or "our"), a fitness and nutrition application owned and operated by …":
 *  KWAZO first, then who owns it (Kd, 2026-11-08). */
export const KWAZO_IS = `KWAZO ("KWAZO," "we," "us," or "our"), a fitness and nutrition application owned and operated by ${LEGAL_OWNER}, a sole proprietor based in India`;

const emailLater = "Our contact email address will be included in this Policy before the official publication of KWAZO.";
const emailNow = (facts: LegalFacts): string =>
  facts.supportEmail === null ? emailLater : `Our contact email address is ${facts.supportEmail}.`;

const contactLines = (facts: LegalFacts, nameLabel: string): LegalBlock[] => [
  p(`Owner and Operator: ${LEGAL_OWNER}`),
  p(`${nameLabel}: KWAZO`),
  p("Country: India"),
  p(`Email Address: ${facts.supportEmail ?? "To be added before the official publication of KWAZO."}`),
];

/** The companies that handle people's data for us, each with what it receives. The api's test ties each
 *  one to the settings that switch it on. `healthData`: it may receive what Washington's law calls consumer
 *  health data (a meal photo, notification words, a run's map), so Washington's page names it too. */
export const OUTSIDE_SERVICES = [
  {
    id: "openai",
    healthData: true,
    name: "OpenAI",
    forWhat: "Identifies food items from meal photographs and product packaging labels, and verifies food names.",
    gets: "Submitted photographs with location and capture-time metadata removed, together with food names and quantities. Names and email addresses are not provided.",
  },
  {
    id: "resend",
    healthData: false,
    name: "Resend",
    forWhat: "Delivers emails, including authentication codes, invitations, receipts, and reminders.",
    gets: "The recipient's email address and the contents of the relevant email.",
  },
  {
    id: "firebase",
    healthData: true,
    name: "Google Firebase",
    forWhat: "Delivers push notifications to users' devices.",
    gets: "Device notification tokens or addresses and the contents of notifications.",
  },
  {
    id: "google_sign_in",
    healthData: false,
    name: "Google Sign-In",
    forWhat: "Enables users to authenticate through their Google accounts, where selected.",
    gets: "Google receives information indicating that the user is signing in to KWAZO. Google provides KWAZO with the user's Google identifier, email address, and name.",
  },
  {
    id: "cloudflare",
    healthData: false,
    name: "Cloudflare",
    forWhat: "Provides automated bot-verification checks when an unusually high number of authentication codes is requested and on business enquiry forms.",
    gets: "The user's IP address and browser-related information while the verification check is displayed.",
  },
  {
    id: "openfreemap",
    healthData: true,
    name: "OpenFreeMap",
    forWhat: "Provides map rendering within the mobile Application.",
    gets: "The user's IP address and information identifying the map area displayed on the device.",
  },
  {
    id: "openstreetmap",
    healthData: true,
    name: "OpenStreetMap and LocationIQ",
    forWhat: "Provide map rendering and location search functionality on the running-related pages of the KWAZO website.",
    gets: "The user's IP address, the map area displayed, and location or place-search information entered by the user.",
  },
  {
    id: "sentry",
    healthData: false,
    name: "Sentry",
    forWhat: "Identifies and reports errors occurring in KWAZO's server infrastructure.",
    gets: "Technical information relating to application code failures. User-submitted content, names, and email addresses are not provided.",
  },
  {
    id: "square",
    healthData: false,
    name: "Square",
    forWhat: "Processes card payments for participating businesses that use Square and maintains payment cards on file for those businesses.",
    gets: "The user's name, email address, phone number, and payment card information. KWAZO retains only the card brand, last four digits, and expiration date.",
  },
  {
    id: "paddle_razorpay",
    healthData: false,
    name: "Paddle and Razorpay",
    forWhat: "Process subscription payments made by participating businesses for KWAZO plans.",
    gets: "The payer's email address and country. Razorpay additionally receives the business's payment-related phone number.",
  },
] as const;
export type OutsideServiceId = (typeof OUTSIDE_SERVICES)[number]["id"];

/** What is kept after an account is deleted for good, and for how long. The api's test ties every table
 *  the purge keeps to one of these. */
export const KEPT_AFTER_DELETION = [
  {
    id: "tombstone",
    what: "An account existence record, without the user's name or email address",
    howLong: "Retained to maintain references and associations required by the remaining records described below.",
  },
  {
    id: "consent",
    what: "Records of acknowledged notices and agreements, including the text accepted and the time of acknowledgment",
    howLong: "Retained for six years following account deletion as evidence of the user's acknowledgment or agreement.",
  },
  {
    id: "signed_papers",
    what: "Waivers and agreements signed with a participating business, including the name entered by the user",
    howLong: "Retained for up to six years on behalf of the business as evidence of the relevant agreement.",
  },
  {
    id: "business_records",
    what: "Business-controlled records, including memberships, visits, bookings, payments, bills, notes, and the last four digits of a payment card",
    howLong: "Retained until the business deletes the information or the records are removed through KWAZO's cleanup process for businesses that have discontinued use of the Services.",
  },
  {
    id: "business_content",
    what: "Information created or configured by a user while acting as business staff, including posts, events, classes, challenges, and meal plans",
    howLong: "Retained for as long as the participating business continues to maintain the relevant information.",
  },
  {
    id: "money_records",
    what: "Invoices and billing records relating to a participating business's KWAZO subscription",
    howLong: "Retained for the period required under applicable tax laws.",
  },
  {
    id: "change_log",
    what: "Application change logs recording the identity of the individual making a change, the change performed, and the time of the change",
    howLong: "Retained for service security and dispute-resolution purposes. Following account deletion, the individual's identity is displayed as a deleted user.",
  },
  {
    id: "totals",
    what: "Aggregated information without personal names, including daily business statistics, KWAZO's operating costs, and leaderboards with names removed",
    howLong: "Retained in a form that does not identify the individual and is therefore no longer associated with that person's identity.",
  },
] as const;
export type KeptAfterDeletionId = (typeof KEPT_AFTER_DELETION)[number]["id"];

export function privacyPolicy(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  return {
    title: "Privacy Policy",
    lead: [
      `${KWAZO_IS}. This Privacy Policy ("Policy") describes how KWAZO collects, uses, processes, discloses, retains, and protects personal information in connection with the KWAZO application ("Application" or "Services").`,
      "KWAZO provides fitness and nutrition services to individuals who train independently, as well as to members, owners, and staff of gyms, fitness studios, and other fitness-related businesses.",
      "This Policy explains the categories of personal information we collect, the purposes for which such information is processed, the third parties with whom information may be shared, applicable retention periods, and the rights and choices available to individuals regarding their personal information.",
    ],
    sections: [
      {
        id: "who-we-are",
        heading: "1. Identity and Responsibility for Personal Information",
        blocks: [
          p(`1.1. KWAZO is owned and operated by ${LEGAL_OWNER}, a sole proprietor based in India.`),
          p("1.2. For personal information collected and processed in connection with individual KWAZO accounts and the operation of the Application, KWAZO determines the purposes and means of processing such information."),
          p("1.3. Where a gym, fitness studio, or another participating business uses KWAZO to manage its own members, prospective customers, payments, or business records, that business determines how its records are used. KWAZO processes and stores such information on behalf of the respective business, as further explained in this Policy."),
          p(`1.4. ${emailNow(facts)}`),
        ],
      },
      {
        id: "which-part",
        heading: "2. Scope and Applicability",
        blocks: [
          p("2.1. This Policy applies to individuals who access or use KWAZO, including independent users, members of participating fitness businesses, business owners, and authorized staff."),
          p("2.2. The information described in Section 3, \"Personal Information We Collect,\" applies to users of KWAZO, according to the features and services they use."),
          p("2.3. Additional provisions apply depending on your relationship with KWAZO:"),
          {
            kind: "links",
            items: [
              { label: "Independent Users: individuals who use KWAZO for their personal fitness and nutrition activities. See Section 6.", to: "#on-your-own" },
              { label: "Fitness Business Members: individuals who belong to a gym, studio, or another fitness business using KWAZO. See Section 7.", to: "#members" },
              { label: "Business Owners and Staff: individuals who operate or work for a business using KWAZO. See Section 8.", to: "#businesses" },
              { label: "Individuals Added by a Business: individuals whose information is maintained by a participating business but who do not personally use the Application. See Section 9.", to: "#added-by-a-business" },
            ],
          },
        ],
      },
      {
        id: "what-we-collect",
        heading: "3. Personal Information We Collect",
        blocks: [
          p("Depending on your use of KWAZO, we may collect and process the following categories of information."),
          h3("3.1. Account and Registration Information"),
          p("We collect information necessary to create, maintain, and administer your account, including:"),
          list("Your name and email address.", "Your device's time zone.", "Your preferred measurement units."),
          p("If you choose to sign in through Google, we also receive your Google account identifier, email address, and name as provided by Google."),
          h3("3.2. Authentication and Sign-In Information"),
          p("To maintain account security and prevent unauthorized access, we collect information relating to account sign-ins, including:"),
          list(
            "The date and time of sign-in activity.",
            "The Internet Protocol (IP) address associated with the sign-in.",
            "Information identifying the browser or mobile device used to access the account.",
          ),
          p("Our server's logs also record the IP address of each request, to keep the Services secure. How long these logs are kept will be stated in this Policy before the official publication of KWAZO."),
          h3("3.3. Fitness Profile and Onboarding Information"),
          p("During account setup and onboarding, we collect information used to personalize fitness and nutrition functionality, including:"),
          list(
            "Age and sex.",
            "Height.",
            "Target body weight.",
            "Fitness level and fitness goals.",
            "Preferred training days.",
            "Training locations and available exercise equipment.",
            "Dietary preferences and dietary information.",
            "Preferred number of meals per day.",
            "Training pace, daily activity level, session length, preferred workout time, and push-up and plank results.",
          ),
          h3("3.4. Health-Related Screening Information"),
          p("KWAZO collects a limited health-related screening response through a yes-or-no question concerning whether you have a medical condition, physical injury, or pregnancy requiring special care, and whether a qualified professional has provided clearance."),
          p("KWAZO does not request or collect the name or details of any particular medical condition through this screening question."),
          p("Where an affirmative response indicates a relevant health consideration, the Application applies additional caution when providing fitness-related guidance."),
          h3("3.5. Workout and Exercise Information"),
          p("We collect information generated through your fitness activities, including:"),
          list(
            "Workouts and exercise sessions.",
            "Exercise sets and repetition counts.",
            "Exercise durations and recorded times.",
            "Exercise form scores.",
            "Training streaks.",
            "Badges and achievements.",
            "Participation in challenges.",
          ),
          h3("3.6. Camera-Based Exercise Analysis"),
          p("Certain KWAZO features use your device's camera to analyze exercise movements and provide feedback."),
          p("Camera-based exercise analysis is performed locally on your device and operates only while you are actively using the relevant exercise functionality."),
          p("KWAZO does not record, store, or transmit video footage or photographs obtained through this functionality."),
          p("Such footage is not transmitted to KWAZO's servers, is not accessible to KWAZO or any other person, and is discarded when the exercise session ends."),
          p("Only the resulting exercise information is retained in text or numerical form, including:"),
          list("Repetition counts.", "Exercise sets.", "Exercise duration.", "Form scores.", "Identified exercise form errors or mistakes."),
          h3("3.7. Nutrition and Meal Information"),
          p("We collect information relating to your dietary tracking and nutrition activities, including:"),
          list(
            "Logged meals and food items.",
            "Food quantities and portion amounts.",
            "Estimated calories and nutritional values.",
            "Custom foods and dishes created by you.",
            "Your meal plans.",
          ),
          h3("3.8. Meal and Food Label Images"),
          p("When you use the meal-scanning or food-label recognition functionality, photographs submitted through the feature are transmitted to our server for food identification and analysis."),
          p("The submitted photographs are discarded after processing and are not retained by KWAZO."),
          p("The food items identified from these photographs may remain temporarily available for up to 24 hours to allow you to review and save them."),
          h3("3.9. Body Measurements"),
          p("We collect body-related information that you voluntarily record within the Application, including:"),
          list("Body weight.", "Body measurements."),
          h3("3.10. Running and Location Information"),
          p("When you activate the running-tracking functionality, KWAZO accesses your device's location information to record:"),
          list("Running routes.", "Distances traveled.", "Running times."),
          p("Location information is accessed while a running session is being recorded and the Application is open or the active running notification is displayed, and while the Running page is open, to show the strength of the GPS signal. That reading stays on your device and is not kept."),
          p("KWAZO does not otherwise collect your location in the background outside these circumstances."),
          h3("3.11. Business Page and Community Information"),
          p("When you interact with pages operated by participating businesses, we may collect and process:"),
          list("Posts and photographs you publish.", "Comments and reactions.", "Reports submitted by you.", "Blocking actions initiated by you."),
          h3("3.12. Notification Information"),
          p("To provide application notifications, we collect:"),
          list(
            "Your device's notification token or notification address.",
            "Your notification preferences and enabled or disabled notification settings.",
          ),
          h3("3.13. Records of Acknowledgments and Agreements"),
          p("When you acknowledge or accept a notice, statement, or other agreement presented within KWAZO, we may retain:"),
          list(
            "The text of the acknowledged statement.",
            "The version of that statement.",
            "The version of the Application.",
            "The date and time of acknowledgment.",
          ),
          h3("3.14. Application Usage Information"),
          p("To operate the Services and enforce applicable usage limits, we collect limited information concerning your use of the Application, including:"),
          list(
            "The number of minutes the Application remains open each day.",
            "Usage of meal-scanning functionality.",
            "Usage of route-planning functionality.",
          ),
          p("This information is used to administer the Services and applicable daily usage limits."),
          h3("3.15. Communications"),
          p("We collect and process information that you voluntarily provide when contacting or communicating with KWAZO."),
        ],
      },
      {
        id: "why",
        heading: "4. Purposes and Basis of Processing",
        blocks: [
          p("We collect and process personal information for the purposes described below."),
          h3("4.1. Provision and Operation of Services"),
          p("We process information necessary to provide the features and functionalities requested by users, including personalized fitness plans, calculations, workout tracking, nutrition management, and running-related functionality."),
          p("Such processing supports the services for which users register and maintain their KWAZO accounts."),
          h3("4.2. Processing Based on Consent"),
          p("Health-related screening responses, body weight, and body measurements are processed with your consent."),
          p("Consent is provided when you voluntarily answer the relevant health-related question or enter the applicable body measurement information."),
          p("You may withdraw this consent by deleting the relevant information or deleting your KWAZO account."),
          h3("4.3. Security and Prevention of Misuse"),
          p("We process certain information to maintain the security and integrity of KWAZO, including:"),
          list(
            "Sign-in records and authentication activity.",
            "Automated verification and anti-bot checks.",
            "Daily usage limits.",
            "Logs recording changes made within the Application.",
          ),
          h3("4.4. Compliance with Legal Obligations"),
          p("We process and retain information where necessary to comply with applicable legal requirements, including:"),
          list(
            "Invoices and billing documentation.",
            "Records demonstrating acknowledgment or acceptance of applicable notices and agreements.",
          ),
          h3("4.5. Service-Related Communications"),
          p("We use contact and notification information to provide communications requested by or relevant to users, including:"),
          list(
            "Authentication and sign-in codes.",
            "Communications sent by participating businesses.",
            "Notifications and reminders that users have chosen to enable.",
          ),
          h3("4.6. Advertising, Analytics, Tracking, and Artificial Intelligence"),
          p("KWAZO does not sell users' personal information."),
          p("KWAZO does not display advertisements and does not use advertising or analytics tools."),
          p("KWAZO does not track users across third-party applications or websites."),
          p("Personal information collected through KWAZO is not used to train artificial intelligence models."),
        ],
      },
      {
        id: "who-else",
        heading: "5. Third-Party Service Providers and Disclosure of Information",
        blocks: [
          p("5.1. KWAZO engages third-party service providers to support the operation, delivery, and maintenance of its Services."),
          p("5.2. Each service provider receives only the information required to perform its designated function."),
          p("5.3. The following service providers are used in connection with KWAZO:"),
          {
            kind: "table",
            head: ["Service Provider", "Purpose of Processing", "Information Received"],
            rows: OUTSIDE_SERVICES.map((s) => [s.name, s.forWhat, s.gets]),
          },
          h3("5.4. Hosting and Database Infrastructure"),
          p("KWAZO uses a third-party infrastructure provider to operate its servers and maintain its database."),
          p(
            facts.hosting === null
              ? "The identity of this service provider will be disclosed in this Policy before the official publication of KWAZO."
              : `This service provider is ${facts.hosting.company}, and KWAZO's servers and database are located in ${facts.hosting.place}.`,
          ),
          h3("5.5. International Processing and Data Transfers"),
          p("Certain third-party service providers operate in countries outside the user's country of residence, including the United States, Australia and Japan."),
          p("Accordingly, personal information may be processed or handled in such jurisdictions, subject to the respective service providers' applicable terms governing the handling of customer data."),
          h3("5.6. Disclosures Required by Law"),
          p("KWAZO may disclose personal information to law enforcement authorities, including the police, or to courts only where such disclosure is required by applicable law."),
        ],
      },
      {
        id: "on-your-own",
        heading: "6. Privacy of Independent Users",
        blocks: [
          p("6.1. Where you use KWAZO independently and are not associated with a participating fitness business, the personal fitness, nutrition, and other information you provide remains yours."),
          p("6.2. No participating fitness business is granted access to this information solely because you use KWAZO independently."),
          p("6.3. If you subsequently join a gym, studio, or other participating fitness business through KWAZO, the information that becomes accessible to that business is governed by Section 7 of this Policy."),
        ],
      },
      {
        id: "members",
        heading: "7. Privacy of Members of Participating Fitness Businesses",
        blocks: [
          p("7.1. When you join a gym, fitness studio, or other fitness-related business through KWAZO, you retain your personal workout, nutrition, body measurement, and running information."),
          p("7.2. The business is granted access only to the categories of information disclosed to you when joining the business through the Application, as specified below."),
          h3("7.3. Information Accessible to the Business"),
          p("The following information may be accessed by the participating business:"),
          list(
            "Your name and email address.",
            "Workout information, including workout dates, exercises, sets, repetitions, hold times, and exercise duration.",
            "Exercise form scores and identified form faults.",
            "Training streaks and participation in challenges.",
          ),
          h3("7.4. Information Accessible Only With Your Permission"),
          p("The following categories of information are accessible to the business only where you have explicitly allowed such access:"),
          list("Meals and nutritional information.", "Body weight and body measurements."),
          h3("7.5. Information Not Accessible to the Business"),
          p("The participating business is not provided access to:"),
          list("Your recorded running routes.", "Your response to the health-related screening question."),
          h3("7.6. Business-Controlled Records"),
          p("A participating business may independently maintain information relating to its relationship with you through KWAZO, including:"),
          list(
            "Membership records.",
            "Attendance and visit histories.",
            "Bookings.",
            "Payment information.",
            "Notes maintained by the business.",
            "Waivers and agreements signed between you and the business.",
          ),
          p("These records belong to and are controlled by the respective business."),
          p("The business determines how such records are used and remains responsible for them. KWAZO stores and processes these records on the business's behalf."),
          h3("7.7. Retention Following Departure or Account Deletion"),
          p("If you leave a participating business or delete your KWAZO account, the business retains its own records relating to the period during which you were associated with it."),
          p("Such records are subject to the applicable retention provisions described in Section 10 of this Policy."),
          h3("7.8. Information Visible to Other Members"),
          p("Other members of the business can see your name, your place, and your gym-day, workout-day, and streak counts on its leaderboards, and the posts and comments you publish on its page."),
          p("You can hide yourself from the business's leaderboards at any time through:"),
          strong("Me → Settings → Hide me"),
        ],
      },
      {
        id: "businesses",
        heading: "8. Information Relating to Business Owners and Staff",
        blocks: [
          h3("8.1. Personal Accounts"),
          p("The personal KWAZO accounts of business owners and staff members are subject to the same privacy practices applicable to other individual users."),
          h3("8.2. Business-Controlled Personal Information"),
          p("Information entered or maintained by a participating business concerning other individuals remains under the responsibility and control of that business."),
          p("This includes:"),
          list("Member lists and associated member information.", "Prospective customer or lead information.", "Payment-related records."),
          p("The business is responsible for obtaining the necessary permission from individuals whose information it collects, imports, or maintains."),
          p("KWAZO requires the business to confirm that such permission has been obtained when importing records or inviting individuals to the Application."),
          p("KWAZO processes and stores this information only for the purpose of providing the Services to the participating business."),
          h3("8.3. Business Activity Logs"),
          p("Changes made by authorized business staff within KWAZO are recorded in the Application's activity or change logs."),
          p("These records are maintained to support the operation, accountability, and security of the Services."),
          h3("8.4. Inactive Business Data"),
          p("If a participating business does not maintain an active paid plan and none of its staff members signs in to KWAZO for a continuous period of six months, the business's member list and prospective customer or lead records will be deleted."),
          p("Before deletion, KWAZO sends notification emails approximately:"),
          list("One month before the scheduled deletion.", "One week before the scheduled deletion."),
          h3("8.5. Administrative Access by KWAZO"),
          p(`For the purpose of operating and administering the Services, ${LEGAL_OWNER}, as the operator of KWAZO, may access limited information relating to individual users, including:`),
          list(
            "Name.",
            "Email address.",
            "Account registration or sign-up date.",
            "Most recent visit or activity.",
            "Subscription or plan information.",
            "Time spent using the Application.",
            "Meal-scanning usage.",
            "The businesses they belong to.",
            "Their device's time zone.",
          ),
          p("This administrative access does not include:"),
          list("Responses to health-related screening questions.", "Body weight.", "Meal information.", "Photographs.", "Running information."),
        ],
      },
      {
        id: "added-by-a-business",
        heading: "9. Individuals Added by a Business Without Using KWAZO",
        blocks: [
          p("9.1. A participating business may maintain records relating to individuals who have not independently registered for or used the KWAZO Application."),
          p("9.2. Such records may include:"),
          list(
            "Name.",
            "Email address.",
            "Phone number.",
            "Membership information.",
            "Date of birth.",
            "Additional custom fields or columns maintained by the business.",
          ),
          p("9.3. The participating business is responsible for the collection, accuracy, management, and use of this information."),
          p("KWAZO processes and stores such information solely on behalf of the relevant business."),
          h3("9.4. Business Invitations"),
          p("A participating business may use KWAZO to send an email invitation encouraging an individual to access or register for the Application."),
          h3("9.5. Business Enquiry Forms"),
          p("Where an individual submits an enquiry through a participating business's enquiry form, the following information is transmitted to that business:"),
          list("Name.", "Email address.", "Phone number.", "The message submitted through the enquiry form."),
          h3("9.6. Access, Correction, and Deletion Requests"),
          p("Individuals who wish to access, correct, or delete information maintained about them by a participating business should direct their request to the relevant business."),
          p("Such individuals may also contact KWAZO for assistance."),
          p(emailNow(facts)),
        ],
      },
      {
        id: "how-long",
        heading: "10. Data Retention and Account Deletion",
        blocks: [
          h3("10.1. Retention During Account Activity"),
          p("KWAZO retains personal information for as long as the relevant user account remains active, subject to the specific retention arrangements described in this Policy."),
          h3("10.2. Account Deletion Procedure"),
          p("A user may request account deletion in the Application, under Settings, or on the KWAZO website without the Application, by confirming a code sent to the account's email address."),
          { kind: "links", items: [{ label: "Account Deletion", to: LEGAL_PATHS.deleteAccount }] },
          p("When a user requests account deletion:"),
          list(
            "The user is signed out of the Application immediately.",
            "The user's association with all participating businesses is terminated.",
            `The account enters a ${String(ACCOUNT_UNDO_DAYS)}-day deletion period.`,
          ),
          p(`The account is permanently deleted ${String(ACCOUNT_UNDO_DAYS)} days after the deletion request.`),
          p(`During this ${String(ACCOUNT_UNDO_DAYS)}-day period, the user may restore the account through the account-recovery link sent by email.`),
          h3("10.3. Information Retained Following Account Deletion"),
          p("After permanent account deletion, KWAZO retains only the categories of information described below, subject to the stated retention conditions."),
          {
            kind: "table",
            head: ["Category of Retained Information", "Retention Period or Condition"],
            rows: KEPT_AFTER_DELETION.map((k) => [k.what, k.howLong]),
          },
          h3("10.4. Authentication Code Retention"),
          p("Sign-in and authentication codes stop working shortly after they are sent, and are deleted once they are more than two days old, when the next code is requested."),
          h3("10.5. Backup Copies"),
          p(
            `To protect against data loss, KWAZO makes a copy of its database and stored files each night and keeps it with the same hosting provider, in a separate storage location. Each copy is deleted automatically after ${String(BACKUP_KEEP_DAYS)} days, and any earlier version of a copy is permanently deleted no more than ${String(BACKUP_KEEP_DAYS)} days after that. Information deleted from KWAZO may therefore remain in these copies for up to ${String(2 * BACKUP_KEEP_DAYS)} days. The copies are used only to restore the Services after a failure.`,
          ),
        ],
      },
      {
        id: "your-rights",
        heading: "11. Your Privacy Rights and Choices",
        blocks: [
          p("Subject to applicable law and the procedures described below, KWAZO provides users with options to access, manage, and control their personal information."),
          h3("11.1. Access and Data Download"),
          p("You may access and download your personal information through the following navigation path within the Application:"),
          strong("Me → Settings → Download my data"),
          h3("11.2. Correction of Personal Information"),
          p("You may review and correct your account information through:"),
          strong("Me → Settings"),
          h3("11.3. Account Deletion"),
          p("You may request the deletion of your KWAZO account through:"),
          strong("Me → Settings → Delete account"),
          p("Individuals who own a business using KWAZO must delete their accounts through the KWAZO website, where the business's account and management functions are administered."),
          h3("11.4. Withdrawal of Consent, Objections, and Enquiries"),
          p("You may contact KWAZO to:"),
          list(
            "Withdraw previously provided consent.",
            "Object to the processing or use of your personal information.",
            "Request information or clarification concerning how your personal information is handled.",
            "Raise other privacy-related questions or concerns.",
          ),
          p("KWAZO will respond to such communications within one month."),
          h3("11.5. Complaints to Regulatory Authorities"),
          p("You may submit a complaint to the competent personal data protection or privacy authority responsible for overseeing privacy matters in your country or jurisdiction of residence."),
        ],
      },
      {
        id: "age",
        heading: "12. Age Restrictions and Children's Privacy",
        blocks: [
          p("12.1. KWAZO is intended exclusively for individuals who are at least 18 years of age."),
          p("12.2. KWAZO does not knowingly collect or process personal information belonging to individuals younger than 18 years of age."),
          p("12.3. If KWAZO becomes aware that personal information has been collected from an individual under the age of 18, such information will be deleted."),
        ],
      },
      {
        id: "security",
        heading: "13. Information Security",
        blocks: [
          p("13.1. KWAZO implements measures designed to protect account credentials, payment information, and user authentication data."),
          p("13.2. Authentication codes and passwords are maintained only in a non-reversible form that prevents the original values from being read back."),
          p("13.3. Full payment card numbers are not received or stored by KWAZO."),
          p("13.4. On mobile devices, account sign-in information is maintained using the device's secure storage mechanisms."),
        ],
      },
      {
        id: "laws",
        heading: "14. Applicable Data Protection Laws and Regulatory Compliance",
        blocks: [
          h3("14.1. Data Protection Frameworks"),
          p("KWAZO follows the applicable privacy and personal data protection laws of the jurisdictions in which its users reside, including, where applicable:"),
          list(
            "India: The Digital Personal Data Protection Act.",
            "European Union: The General Data Protection Regulation (GDPR).",
            "United Kingdom: The United Kingdom General Data Protection Regulation (UK GDPR).",
            "Canada: The Personal Information Protection and Electronic Documents Act (PIPEDA).",
            "California, United States: Applicable California privacy legislation.",
          ),
          h3("14.2. Roles in the Processing of Personal Information"),
          p("Where applicable data protection legislation recognizes the relevant classifications, KWAZO acts as:"),
          list(
            "A Data Fiduciary or Data Controller in relation to personal information processed for its own Application and individual user services.",
            "A Data Processor in relation to personal information maintained and controlled by participating businesses through KWAZO.",
          ),
          h3("14.3. Do Not Track Signals"),
          p("KWAZO does not track users across external websites."),
          p("Accordingly, browser-based \"Do Not Track\" signals do not result in different handling of the user's visit, as KWAZO does not engage in such cross-website tracking."),
          h3("14.4. Washington State Consumer Health Data Privacy"),
          p("Individuals residing in Washington State may refer to KWAZO's separate Washington Consumer Health Data Privacy Policy for additional information concerning the handling of consumer health data."),
          { kind: "links", items: [{ label: "Washington Consumer Health Data Privacy Policy", to: LEGAL_PATHS.washington }] },
        ],
      },
      {
        id: "changes",
        heading: "15. Amendments to This Privacy Policy",
        blocks: [
          p("15.1. KWAZO may revise or update this Privacy Policy as the Application and its associated Services evolve."),
          p("15.2. Whenever this Policy is amended, the \"Last Updated\" date displayed at the beginning of the document will be revised to reflect the update."),
          p("15.3. Where a change materially affects users, KWAZO will notify users by email or through the Application before the relevant modification takes effect."),
        ],
      },
      {
        id: "contact",
        heading: "16. Contact Information",
        blocks: [
          p("For questions, requests, complaints, or other communications concerning this Privacy Policy or the processing of personal information through KWAZO, please contact:"),
          ...contactLines(facts, "Business Name"),
        ],
      },
    ],
  };
}

export function termsOfUse(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  return {
    title: "Terms of Use",
    lead: [
      `These Terms of Use ("Terms") constitute a legally binding agreement between you ("User" or "you") and ${KWAZO_IS}.`,
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
          p("10.4. Where a modification materially affects users, KWAZO will notify users by email or through the Application before the relevant change takes effect."),
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

/** Washington State's My Health My Data Act (RCW 19.373.020) asks for this page, with its own link.
 *  Cal AI, MacroFactor, Strava and MyFitnessPal publish one (read 2026-11-08). */
export function washingtonHealthDataPolicy(facts: LegalFacts = LEGAL_FACTS): LegalDocument {
  return {
    title: "Washington Consumer Health Data Privacy Policy",
    lead: [
      `This Washington Consumer Health Data Privacy Policy ("Policy") supplements the KWAZO Privacy Policy and describes how ${KWAZO_IS}, collects, uses, processes, and discloses consumer health data in accordance with Washington State's My Health My Data Act.`,
      "This Policy applies exclusively to individuals in Washington State who use KWAZO for their personal fitness and nutrition activities and to information classified as \"consumer health data\" under the Washington My Health My Data Act.",
      "This Policy should be read in conjunction with the general KWAZO Privacy Policy.",
    ],
    sections: [
      {
        id: "collected",
        heading: "1. Categories of Consumer Health Data Collected and Purposes of Processing",
        blocks: [
          p("KWAZO collects and processes the following categories of consumer health data for the specified purposes:"),
          h3("1.1. Health-Related Screening Information"),
          p("We collect your response to the application's health-related screening question, including whether a qualified healthcare professional has provided clearance for physical activity."),
          p("This information is used to apply additional precautions and provide more appropriate fitness-related guidance."),
          h3("1.2. Body Weight and Measurements"),
          p("We collect body weight and body measurements that you voluntarily record within the Application."),
          p("This information is used to monitor your fitness progress and establish or adjust your personalized fitness and nutrition plans."),
          h3("1.3. Nutrition and Dietary Information"),
          p("We collect information relating to meals you record, including food items, caloric values, and nutritional information."),
          p("This information is used to calculate and monitor your dietary intake in relation to your personalized nutrition plan."),
          h3("1.4. Exercise and Physical Activity Information"),
          p("We collect information relating to your workouts, exercise form scores, and recorded running activities."),
          p("This information is used to track your physical activity, calculate training-related metrics, and display your fitness progress."),
          h3("1.5. Derived Fitness and Nutrition Information"),
          p("KWAZO may generate or calculate additional fitness and nutrition information based on the data described above, including personalized calorie and protein targets."),
          p("This information is used to support the fitness and nutrition planning functionalities provided through the Application."),
        ],
      },
      {
        id: "sources",
        heading: "2. Sources of Consumer Health Data",
        blocks: [
          p("2.1. KWAZO collects consumer health data directly from information you voluntarily provide through the Application."),
          p("2.2. Certain information is also generated or collected through your mobile device while you actively use the relevant functionalities of KWAZO."),
          p("This includes:"),
          list(
            "Camera-Based Exercise Results: Exercise-related measurements generated through camera-based analysis, including repetition counts and exercise form scores. Camera processing occurs locally on your device. No video footage is recorded, and no video is transmitted from your device to KWAZO or any third party.",
            "Running and Location Information: Device location information collected while you actively record a running session through the Application.",
          ),
        ],
      },
      {
        id: "shared",
        heading: "3. Disclosure and Sharing of Consumer Health Data",
        blocks: [
          h3("3.1. Prohibition on Sale"),
          p("KWAZO does not sell consumer health data."),
          h3("3.2. Third-Party Service Providers"),
          p("KWAZO shares consumer health data only with service providers involved in the operation and delivery of its Services, as described below:"),
          list(
            facts.hosting === null
              ? "Hosting Infrastructure Provider: The company responsible for hosting KWAZO's server infrastructure and supporting the operation of the Application."
              : `Hosting Infrastructure Provider: ${facts.hosting.company}, responsible for hosting KWAZO's server infrastructure and supporting the operation of the Application.`,
            "OpenAI: Processes submitted meal photographs to identify and analyze food information.",
            "Google Firebase: Facilitates the delivery of application notifications, which may contain information relating to your workouts, training activities, or meals.",
            "OpenFreeMap: Provides the maps in the mobile Application, including while a run is recorded, and receives your IP address and the map area around you.",
            "OpenStreetMap and LocationIQ: Provide maps and place search on the running-related pages of the KWAZO website, and receive your IP address, the map area displayed, and the places you search for.",
          ),
          h3("3.3. Participating Fitness Businesses"),
          p("Where you are a member of a gym, fitness studio, or another fitness-related business using KWAZO, certain fitness-related information may be disclosed to that business."),
          p("The information accessible to the business includes:"),
          list("Workout information.", "Exercise form scores."),
          p("The following categories of information are disclosed to the participating business only with your permission:"),
          list("Meals and nutritional information.", "Body weight.", "Body measurements."),
          p("Other members of the business can see your name, your place, and your gym-day, workout-day, and streak counts on its leaderboards, unless you hide yourself through Me → Settings → Hide me."),
        ],
      },
      {
        id: "rights",
        heading: "4. Consumer Rights Under Washington Law",
        blocks: [
          p("Individuals covered by this Policy may exercise the following rights concerning their consumer health data, subject to applicable law."),
          h3("4.1. Right to Confirm Processing"),
          p("You may request confirmation of whether KWAZO collects, holds, or processes consumer health data relating to you."),
          h3("4.2. Right to Access"),
          p("You may request access to the consumer health data maintained by KWAZO concerning you."),
          p("You may also access and download your personal information through the Application by navigating to:"),
          strong("Me → Settings → Download my data"),
          h3("4.3. Right to Deletion"),
          p("You may request the deletion of your consumer health data."),
          p("You may initiate account deletion through the Application by navigating to:"),
          strong("Me → Settings → Delete account"),
          h3("4.4. Right to Withdraw Consent"),
          p("You may withdraw previously provided consent relating to the collection, use, or processing of your consumer health data."),
          h3("4.5. Submission of Privacy Requests"),
          p("Requests concerning the confirmation, access, deletion, or withdrawal of consent relating to consumer health data may be submitted directly to KWAZO."),
          p(emailNow(facts)),
        ],
      },
      {
        id: "appeals",
        heading: "5. Appeals and Complaints",
        blocks: [
          p("5.1. If KWAZO declines a request to exercise any of the rights described in this Policy, you may appeal the decision by submitting a further written request to KWAZO."),
          p("5.2. The appeal may be submitted through the contact email address provided in this Policy."),
          p("5.3. If you remain dissatisfied with KWAZO's response to your appeal, you may contact the Washington State Attorney General regarding your complaint."),
        ],
      },
      {
        id: "contact",
        heading: "6. Contact Information",
        blocks: [
          p("For questions, requests, appeals, or other communications concerning this Washington Consumer Health Data Privacy Policy or the processing of consumer health data, please contact:"),
          ...contactLines(facts, "Business Name"),
        ],
      },
    ],
  };
}
