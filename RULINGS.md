# RULINGS — the product owner's decisions, one line each

Kd owns this product. These are his decisions, in his words where they were short.
They bind every chat. A chat's own engineering choices are NOT recorded here; they
live in the code, its tests and its comments.

How to use: read this whole file at the start of every session (it is short).
When Kd decides something new, add ONE line under the right heading, dated, in the
same commit as the change. If a ruling is reversed, edit the line to say what
replaced it; never delete a ruling. `[archive :NNNN]` points at the full story in
`archive/records/DECISIONS.md` for anyone who needs the detail.

Superseded rulings are kept and marked **SUPERSEDED**.

## Product direction

- 2026-08-18 · The phone app is the product; the web is a side surface and the test rig for camera work. *"my whole aim is mobile app, the web is just side not main"* · 2026-09-07: launch on BOTH web and mobile, then get users. [archive :9604]
- 2026-08-18 · The market is gyms in the US, Canada, Europe and India. Jorhat is not the market. *"my market is usa not jorhat"* [archive :9604, :20296]
- 2026-08-24 · Gym management (the console) exists in the phone app AND on the web, with the same features in each. *"both men both"* [archive :17765]
- 2026-08-18 · The AI chat coach is DROPPED from web and mobile. Off, not deleted from the code. Reconfirmed 08-19, 08-24, 09-07. *"i have decided to drop the chat bot from both web and mobile"* [archive :9604 §5]
- 2026-08-24 · Nutrition and running leave the web and become phone-app features; the server side stays. Web shows "available in the app". [archive :16812]
- 2026-08-25 · Everything Kd listed gets built, in his order, gym stage feature by feature; the admin panel (controls the whole application) is built LAST. *"no i disagree need to build all the things i mentioned please"* [archive :17519, :19016, :26385]
- 2026-09-07 · Territory capture, random matching (the Pact) and identity reveal are built AFTER launch, once there are users.
- 2026-08-25 · The Pact is designed in full and approved: pairs or squads of 4 · random within a mutual gender preference · own-gym or worldwide · under-18s barred · 7/30/90 days at launch · survival rule "never 3 days without training", never voted on · no free text, one-tap compliments with no cap · no photos until the end · reveal is automatic and both are told on day one · finishing produces a joint photo only if everyone taps yes. Run routes must never be visible inside a pact. [archive :18128 §2, :18408, :18449]
- 2026-08-25 · Territory capture is an INDIVIDUAL perk; gym-team territory is dropped. *"lets drop it"* [archive :18128]
- 2026-08-25 · Struck, never re-propose: a "witnessed" leaderboard · rep-where-you-broke · gym-vs-gym league · machine QR stickers · body map · off-peak shifting · anonymous in-gym challenges · exercises-as-territory. [archive :18128]
- 2026-08-25 · The camera coach is a HOME feature. Gym users log by hand. No camera-dependent gym feature. [archive :18128]
- 2026-08-16 · Users never add their own exercises; the catalog is closed on purpose. *"no user should not add exercise"* [archive :8771]
- 2026-08-24 · Coach-uploaded instruction videos: 20 per gym, one minute each, stored on R2 (reverses the 08-18 drop). [archive :17012, :17487]
- 2026-08-16 · Watches / wearables both ways: wanted later; needs the phone app; not now. [archive :8808]
- 2026-08-19 · The member's dashboard is the normal dashboard plus a gym greeting and feed, not a separate members' app. [archive :11181, :33091]
- 2026-08-18 · Wanted and not yet built: classes, scheduling and booking · member-to-coach messaging · gym announcements · gyms set their own prices, offers and promos · coach-authored workout and diet plans · recipes and a grocery list · nearby gyms · gym profile page (map of gyms later) · live "training right now" count · gyms sell products · a full photo/stats editor (ruled IN 08-25, stats never typed). [archive :9604 §7, :11181, :17902, :18128]
- 2026-08-18 · NOT decided, do not build: day passes · paid friend/family invites · training together live · nearby-runner connection (an unanswered safety question). [archive :9604 §8]

## Sign-in and accounts

- 2026-07-11 · Tokens travel only as httpOnly cookies; never in a JSON body, never in localStorage. [archive :104]
- 2026-07-24 · Google sign-in on the new API; sign-up and sign-in share it. [archive :930]
- 2026-08-18 · Two doors, one account: the sign-in page asks member or gym; same email, same password; the choice only decides where you land. [archive :10824] · 2026-09-07: no door at sign-up; the two doors stay on sign-in only, relabelled "Train" and "Manage my gym, studio or clients".
- 2026-08-19 · The gym door skips the fitness questionnaire; it is asked the first time that person enters the training side. *"a gym owner needs gym management, later if want to login as member then onboarding should come"* [archive :10959]
- 2026-08-19 · The two doors are the ONLY way between the member app and the console; no crossing links inside. [archive :11616]
- 2026-08-19 · Staff and coaches use the same one-account model; the owner invites them by email. [archive :11181]
- 2026-08-20 · Phone OTP at sign-up: NO. *"phone otp cancel aswell"* [archive :12600]
- 2026-09-07 · Sign-in by 6-digit email code is the main way in; Google second; Apple on the iPhone app. A code lasts 10 minutes and a resend replaces it. **AMENDED the same day** (was: optional password in Settings; resends at 60 s and 5 min; three codes a day): NO password anywhere — *"professional ones does not have passwords"*; ONE resend per code, after 60 seconds; at most two codes a day per address, then the address waits until tomorrow. Deleting an account is confirmed with a code emailed to the account's own address. **AMENDED 2026-09-08** (the click-through locked Kd out after a normal day of use): a code that signed you in does not count; the two-a-day cap counts only codes never used.
- 2026-09-07 · Email goes out through Resend. Free plan while building and testing; Pro ($20 a month, from their pricing page that day) the day the first gym signs. Kd's account, key and verified domain; the app boots in production only with the key set.
- 2026-09-07 · Organisation types: gym, studio, personal trainer. A trainer's clients join by code like members; opening hours are optional for a trainer. (2026-08-18: *"no clinic will be there only gyms and fitness centers"* — clinics stay out. [archive :10248])
- 2026-09-07 · Age is asked as a plain number, not a birth year. The app is for 16 and over.

## Onboarding and profile

- 2026-07-15 · The fitness profile lives in its own table, one row per user; weight stays on the user row. [archive :323]
- 2026-07-15 · Unanswered is not "beginner": a field is empty until answered; no invented defaults anywhere. Calorie targets refuse to compute until every input exists and say what is missing. [archive :328, :497]
- 2026-07-19 · Onboarding is required before the training side ("Skip for now" removed). [archive :470] · 2026-09-07: screens are saved as you go; a gym code is applied first.
- 2026-07-20 · Reset onboarding wipes every answer. [archive :486]
- 2026-07-21 · Time zone comes from the device, never guessed. [archive :618]
- 2026-09-07 · Onboarding v2: workouts and meals are for everyone; running is one question ("Do you run, or want to start?"); the camera is not mentioned; twelve tap-only screens (goal · about you · target · your day · your training with push-up and plank checks · your week · equipment · health · food · running · code · your plan); every answer changes the plan number on screen.
- 2026-09-07 · Health: readiness questions in plain words; any yes opens "Check first": either "a professional has cleared me" (full app, contraindicated exercises excluded, no calorie deficit for named conditions) or "not yet" (Safe mode: no workout or run plans, no intensity progression, no calorie deficit; meals, library behind a warning, gym check-in and consistency goals still work). The choice is recorded and can be changed later.
- 2026-09-07 · Under 18: workouts and goals, never a calorie-cutting target. No calorie deficit in pregnancy or for a flagged heart, blood-pressure or diabetes answer. Calories never go below the floor already in the code.
- 2026-09-07 · Disclaimer at sign-up (one explicit tap, stored with time, app version and wording), at the health step and on the plan screen: not medical advice; consult a professional; follow them over the app. The words "safe for you", "treats" and "cures" never appear.
- 2026-09-07 · Food safety: every food carries allergen tags (milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame); suggestions exclude the user's allergens and show "contains …" plus "check labels; we cannot see hidden ingredients"; photo scans say they estimate calories and cannot detect allergens; no diet claims for conditions.

## Goals and plans

- 2026-09-07 · A goal is *"burning this much calories, eating healthy food, achieving to do exercises recommended by the app or set by myself"* — NOT how many days someone plans to attend. [archive :37031 R15]
- 2026-09-07 · Goals have periods: daily, weekly, monthly and yearly. The app sets a starter set from onboarding; the user can change, remove or add any goal.
- 2026-09-07 · Weekly plans are built per person from their answers, never one plan for everyone; the shape from days and level, the exercises from goal, equipment and health limits, the numbers from level and goal; always editable.
- 2026-09-07 · Target types the app offers: body (weight, keep steady, a measurement) · strength and skill (reps in a set, plank hold, master an exercise, harder version) · consistency (training days, streak, gym visits) · energy (calories burned, active minutes) · running (distance, finish a 5K/10K, pace, complete a plan) · food (within calories, protein, logged days) · mobility (sessions a week).

## Workouts and the camera

- 2026-08-03 · Counting your own reps is a CHOICE, not only a fallback. *"if a user wants to use camera they can, also if …"* [archive :3720]
- 2026-08-07 · If the user chose the camera, the app never switches them to hand counting; a "Count this set myself" button exists instead. [archive :6008]
- 2026-08-10 · Person check cut-off: bone-length only, 0.923. [archive :7037]
- 2026-08-17 · The strong pose model is the default. [archive :9111]
- 2026-08-17 · Frame rate is a readout on screen, never a warning and never an automatic switch. [archive :9003]
- 2026-08-17 · Crowded room: a Follow-along mode the USER chooses, and the app says it exists unprompted. Follow-along sets run on a timer, never on reps counted from the video. [archive :9390, :9452]
- 2026-08-14 · A rep the camera watched for no time bills nothing; pauses and absence are not billed as exercise. [archive :7487, :7404]
- 2026-08-08 · The object-detector idea is dropped. *"yeah drop my idea"* [archive :6489]
- 2026-08-01 · Hand-logged workouts earn the base workout XP. The workout's engine version means the client's build. [archive :3151, :3298]
- 2026-07-24 · XP and levels are kept, with storage added; the level curve is ported verbatim. [archive :1020]
- 2026-08-06 · Post-workout summary content is ported verbatim. [archive :5473]
- 2026-07-09 · Camera parity gate for the first three exercises: the nine recorded clips green is enough (option B). [archive :53]

## Nutrition

- 2026-07-16 · Meal-type sections are display-only time buckets; the user can override the label. [archive :359]
- 2026-07-16 · Quantity stepper; numbers update live from the server; exact calories, never rounded to ten. [archive :362]
- 2026-07-17 · Dishware lives inside the add and photo flows, never a standalone card. [archive :375]
- 2026-07-18 · "Measure with my dish" asks every time; never silently reuse. [archive :419]
- 2026-07-19 · Desktop webcam capture for meal photos: won't build. [archive :456]
- 2026-07-19 · Macro rings stay on past days. [archive :447]
- 2026-08-24 · Meal scanner runs on Gemini 2.5 Flash Lite; nutrition arithmetic stays on our own food table; photos are resized; the prompt is not shortened. [archive :16548]
- 2026-08-24 · Meal photos ARE stored and self-destruct after seven days. [archive :17133, :9732]
- 2026-08-24 · Scan allowances: free 2 a day · gym member 5 a day · paid individual 20 a day · new individual: one week unlimited. *"not financially possible to give gym user 20 scans"* [archive :17366, :16702]

## Running

- 2026-08-24 · Running is built "like Strava": record and draw the line live · pick a route first · reuse your own saved routes · routes other people ran · a recap. [archive :16924]
- 2026-08-25 · "Routes other people ran" means deliberately PUBLISHED routes, never a pooled heatmap (patents, and a route from a front door is a home address); never "compare your time on this stretch against everyone". [archive :18128 §1.3]
- 2026-08-24 · Google Maps is dropped; MapLibre + OpenStreetMap + self-hosted tiles; LocationIQ stays for address search. *"i want it to be like strava"* [archive :17012]
- 2026-08-25 · The gym's name appears in workout stats and never in running stats. [archive :18128 §2.2]
- 2026-08-24 · Route plans: 2 a day for paid users. [archive :16548]

## Gyms and the console

- 2026-08-18 · Currency follows the gym's country; there is no default; an unsupported country is refused. Country is required when a gym is created. [archive :10099]
- 2026-08-18 · Member import is one universal spreadsheet path (CSV and XLSX, never PDF), with a column-mapping preview; a joining member attaches to their imported row; verified-email match auto-confirms. [archive :9809, :9870, :11309]
- 2026-08-19 · Typing a join code creates an APPLICATION: pending, no seat, no gym perks, until the front desk confirms; the whole free app stays available while waiting. [archive :11072, :11132]
- 2026-08-19 · Applications expire at 14 days; the gym is reminded at 2 days then weekly; the waiting member may nudge once a day. Ratified 08-20. [archive :11385, :12878]
- 2026-08-27 · Gyms start on their own without Kd's approval; Kd can pause or remove a fraudulent gym. (Reverses the 08-19 approval gate.) [archive :21157]
- 2026-08-19 · Staff roles owner, manager, trainer stay; per-staff privilege ticks on top; custom role names on top of that (08-22). Only an owner changes ticks; the last owner cannot be locked out. [archive :11429, :14796]
- 2026-08-22 · Staff seats are free. *"yes staff seats free"* [archive :14290]
- 2026-08-22 · Taking someone's keys asks whether they also stop being a member; both outcomes offered, neither preselected. [archive :14598]
- 2026-08-22 · Changing what a role may do never changes people silently; the owner is offered "change everyone on this role too?". [archive :15381]
- 2026-08-20 · A removed member is told: "You're no longer a member of {gym}"; they keep every workout and the free app. [archive :12660]
- 2026-08-21 · No names or labels on join codes; no hand-typed dates or limits. [archive :13809, :14023]
- 2026-08-24 · Gyms collect their own member fees (Stripe Connect; "between them"); the app never checks whether a member has paid the gym — removing them is the gym's remedy. [archive :9604 §3, :27992]
- 2026-08-25 · Every gym trial is capped at 300 members; no plan choice during the trial; no card details; the plan cannot be changed mid-trial. [archive :19129, :17956]
- 2026-08-28 · A gym without a live plan gets nothing: the trial starts at creation, the subscribe prompt at its end is a modal that cannot be skipped, members of a lapsed gym fall back to the free app, a person waiting to join a lapsed gym is held and told the truth, a lapsed gym's country stays frozen. [archive :22215, :22697, :22389, :25107]
- 2026-08-29 · A lapsed gym's console is read-only for every member of staff. [archive :23711]
- 2026-08-31 · A lapsed gym is closed after FOUR months (not the spec's 14 days), counted from the day the plan ended. [archive :25771]
- 2026-08-31 · The gym's numbers are attendance numbers: no average form score tile; a workout counts for a gym only if the person was a member and present that gym-day; "trained anywhere" is never shown; attendance by QR scan or manual tap, the gym can tell which, and the owner can switch manual off. [archive :26469, :29961]
- 2026-08-31 · Opening hours: sessions per weekday, many per day, or open 24 hours; no session names; members see the hours; one-off closures; the gym picks a 12h or 24h clock; times from a list, dates from a calendar; a "same every day" button; each weekday folds on its own. [archive :26624, :26684, :27204]
- 2026-09-01 · Staff cannot mark a member present (not now); members see their own attendance history; coming to the gym KEEPS A STREAK ALIVE (streak days = workout days plus attendance days; XP unchanged). [archive :27900]
- 2026-09-01 · A second visit in a different session counts again. [archive :27992]
- 2026-09-03 · A gym with set hours REFUSES attendance outside them; the "I'm here" button is not pressable then. [archive :30867, :31352]
- 2026-09-03 · Visit counts leave the main dashboard; "visited 2 times" beside the name; no initials circles; the day list is a dropdown. [archive :30867]
- 2026-09-03 · The gym can see a member's email. *"gym can see email also"* [archive :31098]
- 2026-09-03 · Switching to "open 24 hours" must not destroy the saved timetable. [archive :31508]
- 2026-09-02 · Overview tiles count VISITS, not workouts; a workout counts for the gym on the same gym-day as a visit; a gym can cheer a member: one tap, no free text, four preset lines, confirmed with a Send button. [archive :29961, :35422]
- 2026-09-04 · "On a roll" measures both weeks and days running. *"both weeks and days run"* [archive :34267]
- 2026-09-05 · A gym may cheer a member once per gym-day (was once a week). [archive :35762]
- 2026-09-07 · "Slipping away" quiet window is 3 gym-days (moved 14 → 7 → 3); a gym message stops showing after 7 days; only gyms send messages, a new one replaces the old. [archive :36816]
- 2026-09-07 · The two people panels are replaced by ONE ranked leaderboard for gyms and members, with filters, on the member's My Gyms screen; the global leaderboard is a separate feature; the board updates instantly; hitting a goal counts toward the score; seven day-circles per row; click a member for detail; an info symbol explains it; "hide me" is opt-out, greys the row, and the gym still sees details. [archive :37031]
- 2026-08-25 · A photo shared to the gym lives one week; reactions, no comments; gym-global sharing needs report-and-remove. [archive :18358]
- 2026-08-25 · Kd's own admin panel exists in the spec and is built last; money-dependent gym actions get an admin tool, not a deferral. [archive :19016]

## Pricing, trials and money

- 2026-08-24/25 · Gym price book, ratified. US, Canada, Europe, one USD book: $35 · $50 · $69 · $99 · $129 · custom above 2,100 members, with rounded band boundaries (…300, 301…). India: ₹1,500 and ₹2,500 fixed by Kd; ₹4,500 · ₹6,500 · ₹8,500 delegated. Individuals: $10 a month international, ₹449 India. Whether the raise of bands 1–2 moves bands 3–5 or the INR book is NOT ruled. [archive :17366, :17902, :18488]
- 2026-09-07 · Trials: 7 days for an individual, 15 days for an organisation (replaces 30). One trial per owner account. No card. Abuse is limited by the app stores' one-trial-per-account rule, one trial per device on the web, verified email or Google, and daily caps on the expensive features.
- 2026-08-24 · Paddle is the app's own billing route. *"ok final paddle it is"* Stripe Connect is for gyms collecting from members. The first four or five gyms go on PayPal invoices. [archive :17546, :6327]
- 2026-08-24 · There is no "first 20 gyms free"; twenty gyms is a sales target. *"first 20 gyms free who even said that men"* [archive :16702]
- 2026-08-20 · Per-seat pricing: NO. [archive :12600]
- 2026-09-07 · Before the first real user: a limited company (not a sole proprietorship), product liability insurance, and lawyer-reviewed terms.

## Privacy and legal

- 2026-07-13 · Production launches with an EMPTY database; dev data is never imported. [archive/RUNBOOK cutover note]
- 2026-07-23 · Data export excludes push tokens; the profile is enumerated, never `SELECT *`; three exports an hour. [archive :872]
- 2026-08-18 · Sharing is opt-in and scoped; gyms never see meal logs, body weight, coach conversations or run routes. [archive :9604 §6]
- 2026-08-18 · An in-app consent screen for health data and the camera is needed before a US gym signs. Privacy-law scope beyond India (GDPR, CCPA, LGPD) is an OPEN question for Kd and a lawyer. [archive :592, :9944]
- 2026-09-07 · Recorded consent at sign-up; see Onboarding for the health screening, Safe mode and disclaimers.

## How work is done (the process Kd chose on 2026-09-07)

- One short rules file (`CLAUDE.md`); this file; `ROADMAP.md`; a ten-line `HANDOFF.md` per chat. Everything older is in `archive/` and is not required reading.
- One whole feature per chat; a plan of ten lines or fewer to Kd; he says go; build with tests; checks green; a short click-through for him; commit; pull request to main; merge within a day or two.
- Independent review is KEPT for every feature: one round in a fresh chat, findings fixed by the building chat, one re-check of the fixes only. *"independent review need to be kept as it did find real problems"*
- Mutation tests: keep the tool, run it only for sign-in, money and other-people's-data code; never in CI.
- 2026-08-06 · Severity: Critical/High = security, data loss, privacy, money, a broken core flow, or anything a user can SEE that is FALSE. Everything found is still fixed. [archive :5348, :5807]
- Never remove a feature, hide it, or shrink a screen without Kd's explicit ruling. Off is not deleted.
- Write to Kd in plain English, short, one decision at a time; a hazard comes with its solutions and a recommendation. *"i need solution not acknowledgement"* [archive :11072]
- Never quote a number that was not produced by a command run this session.
- 2026-09-08 · Sizing the work is the chat's job, not Kd's: *"do what is best not because i am asking you to"*. One roadmap line is one chat and one pull request; a chat that finds its line too big splits it in `ROADMAP.md` before building. Stage 1 items 3–7 were split that day.
