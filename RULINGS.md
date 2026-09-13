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

- 2026-07-15 · The fitness profile lives in its own table, one row per user; weight stays on the user row. [archive :323] **"Weight stays on the user row" SUPERSEDED 2026-09-10**: see the redesign line under this heading.
- 2026-07-15 · Unanswered is not "beginner": a field is empty until answered; no invented defaults anywhere. Calorie targets refuse to compute until every input exists and say what is missing. [archive :328, :497]
- 2026-07-19 · Onboarding is required before the training side ("Skip for now" removed). [archive :470] · 2026-09-07: screens are saved as you go; a gym code is applied first.
- 2026-09-13 · A code that arrives on a poster link is put in front of the person FIRST: someone not yet set up meets the "Your code" screen moved to the front of setup, the code already in its box; someone set up lands on the join page with it; the sign-in page says "Sign in to use your code …". Nothing is sent until they tap "Ask to join". *"1"* — of three: the code screen first · a page of its own before setup · a strip on top of "Your goal".
- 2026-07-20 · Reset onboarding wipes every answer. [archive :486] **AMENDED 2026-09-12**: until 4b puts the health question back in setup, a reset keeps the health answer, so a yes goes on blocking the calorie cut; 4b clears it with the rest. *"Keep it until 4b (Recommended)"*
- 2026-07-21 · Time zone comes from the device, never guessed. [archive :618]
- 2026-09-07 · Onboarding v2: workouts and meals are for everyone; running is one question ("Do you run, or want to start?"); the camera is not mentioned; twelve tap-only screens (goal · about you · target · your day · your training with push-up and plank checks · your week · equipment · health · food · running · code · your plan); every answer changes the plan number on screen.
- 2026-09-07 · Health: readiness questions in plain words; any yes opens "Check first": either "a professional has cleared me" (full app, contraindicated exercises excluded, no calorie deficit for named conditions) or "not yet" (Safe mode: no workout or run plans, no intensity progression, no calorie deficit; meals, library behind a warning, gym check-in and consistency goals still work). The choice is recorded and can be changed later.
- 2026-09-07 · Under 18: workouts and goals, never a calorie-cutting target. No calorie deficit in pregnancy or for a flagged heart, blood-pressure or diabetes answer. Calories never go below the floor already in the code. **AMENDED 2026-09-09**: see the next line — the app never asks which condition, so ANY yes means no calorie cut.
- 2026-09-09 · The health screen is ONE general question, never a list of conditions — *"i dont want to withhold any medical data … it is a fitness application only"*: "Do you have a medical condition, an injury, or are you pregnant, or anything else that could affect exercise or eating?" A yes opens Check first (cleared / not yet). ANY yes means no calorie cut, cleared or not (the app cannot know what the yes is). The server stores only the yes/no and the choice; nothing specific is ever asked or kept. The person can change these settings once signed in and everything that reads them updates at once. Exercise exclusions by condition (3c) therefore cannot exist; a cleared person gets the normal plan plus a "follow your professional" line. *"yes start building"*
- 2026-09-09 · Screen 1 asks for ONE main goal, from the seven the app already offers (lose weight · build muscle · get fitter · flexibility · endurance/running · posture · stress relief) — not a multi-select: one goal gives one calorie number, and two that fight (lose weight AND build muscle) cannot both be honoured. The direction the maths works in (lose/gain/keep) is DERIVED from that goal and never asked. Screen 5 keeps the push-up and plank checks — a thirty-second at-home test that sets the first week's numbers — beside the self-rating, and both may be skipped ("I'll rate myself"), so nobody is blocked. *"i agree with you go"* **"ONE main goal" AMENDED 2026-09-10**: see the goals line below.
- 2026-09-10 · Body weight has ONE source: the newest weigh-in by date. A weight typed on screen 2 or in the profile is saved as a weigh-in too, marked "typed by me", and shows in the weigh-in history as one entry. Deleting a mistaken weigh-in brings the previous true weight back on its own; it never leaves a blank and never keeps the mistake. Clearing the weight on purpose still empties it. *"go"*
- 2026-09-10 · **Redesign, the same day**: the weight has NO copy anywhere — the copy on the user row is removed and every screen reads the newest weigh-in each time, so nothing can go stale. A profile save that re-sends the weight already showing writes no "typed by me" entry. Kd asked for the redesign after the post-merge review of 4a-i (*"there are too many critical high appearing"*) — six review rounds had each found one path that forgot to keep the copy in step. *"go"*
- 2026-09-07 · Disclaimer at sign-up (one explicit tap, stored with time, app version and wording), at the health step and on the plan screen: not medical advice; consult a professional; follow them over the app. The words "safe for you", "treats" and "cures" never appear. **"Over the app" AMENDED 2026-09-10**: "follow their advice" stays, the comparison with the app goes (decision D, below).
- 2026-09-07 · Food safety: every food carries allergen tags (milk, eggs, fish, shellfish, tree nuts, peanuts, wheat, soy, sesame); suggestions exclude the user's allergens and show "contains …" plus "check labels; we cannot see hidden ingredients"; photo scans say they estimate calories and cannot detect allergens; no diet claims for conditions. **SUPERSEDED 2026-09-09** (allergen tags and the allergen question): see the next line.
- 2026-09-09 · No allergen tags on foods and no allergy question anywhere — *"it is not needed"*. Every food suggestion carries a caution line instead: the person must take care if they have any food allergy, and check labels. Photo scans still say they estimate calories and cannot detect allergens; still no diet claims for conditions. Stage 1 item 3c is struck.
- 2026-09-10 · Onboarding screens 1–7 replace the old five-step form now (4a-ii), so its free-text conditions box leaves onboarding one card before 4b; the Settings copy stays until 4b switches it off. Finishing is refused while the plan still lacks an answer. *"go"*
- 2026-09-10 · Onboarding look, from the 4a-ii click-through: choice cards carry clean line icons, never cartoon emoji; the units switch is large and first on its screen; the step bar jumps straight to any screen already reached; the daily-number box appears only once the number exists, with no "still needed" list; under the number, the disclaimer's first sentence only ("follow their advice over the app's" is not needed there). *"these icons does not looks preimum"* · *"remove this it is not needed"* **AMENDED the same day** (his second look, next line): "About you" opens with the name, then the units switch.
- 2026-09-10 · Onboarding, Kd's second look at 4a-ii: age, height, weight and target weight are flick wheels with − and +, nothing typed and nothing pre-filled ("Not set" until touched, as the Settings slider does); "About you" opens with "What should we call you?", the one typed box, saved as the account's name; screen 5 asks "How many push-ups can you do in a row?" and "How long can you hold a plank?" as plain questions with "Not sure" — no timer, no test; "How is this worked out?" under the number shows the server's own steps with the person's numbers and each source named (or "the app's own estimate"); Flexibility and Pull-up bar get icons drawn in the library's line style.
- 2026-09-11 · A target on the wrong side of the weight ("Lose weight", 70 kg, target 83) must be impossible to pick, not explained later: the target wheel offers only weights on the goal's side; a stored one on the wrong side is named and the screen waits. *"yes fix it"*
- 2026-09-11 · On a phone a wheel is tapped once before it can be flicked, and that tap picks the number tapped — the price of a page scroll never setting an answer. Kept; no pop-up wheel. Kd judged it in the click-through of 4a-ii: *"all passed"*.
- 2026-09-11 · A goal changed in Settings takes effect at once, and nothing is asked again: ticking Muscle Gain unticks Weight Loss (and back), and the calories follow the change on save. *"it should automatically update according to change"* · *"if i type muscle gain weigt loss is still selected i have to manully undoit really bad"*
- 2026-09-10 · Screen 7 gains "A gym (everything there)" beside the home equipment, built with 4a-iv. *Decision B: yes.* **Label AMENDED 2026-09-11**: "A gym", without "(everything there)" (see the screen-1 line below).
- 2026-09-10 · The one health question gains "or take any medicine, including for weight loss", built with 4b; still one yes/no, nothing named or stored. *Decision C: yes.*
- 2026-09-10 · Disclaimers: "follow their advice" stays on sign-up, the health step and the plan screen, but the comparison with the app goes — *"follow their advice should be kept but over the app should not be there"*. The three wordings change as a new version (so the consent log keeps what each person agreed to) when 4b first shows them. *Decision D.*
- 2026-09-10 · Goals: a person may pick MANY, as other apps allow, but never two that contradict. Screen 1 therefore asks ONE weight choice — lose weight · keep my weight · gain weight — which alone sets the calorie number (lose and gain still ask a target and a pace), plus "also work on", any number of: build muscle · get stronger · get fitter · endurance and running · flexibility · posture · better balance · stress relief. A contradiction is impossible to pick, never refused afterwards. The two new goals and how the workouts follow several goals are the chat's engineering, delegated: *"what else we can add upto you to decide"* · *"i am not the master here"*.
- 2026-09-11 · Building muscle is not gaining weight: choosing Build muscle never asks for a target weight or a pace. It is one of the "also work on" goals of the goals line above; only the weight choice (lose · keep · gain) asks a target. Where the people who already chose it land (keep my weight or gain weight) is asked in 4a-iv's plan, with the science. *"i think you are completely confusing muscle gain and weight gain … both are different if i choose muscle gain why is even there a target weight"* **Answered the same day**: see the next line.
- 2026-09-11 · The people who already chose Build muscle are ASKED their weight choice, never given one: their weight choice starts empty, the calorie rings name that one question, Build muscle stays ticked, and the target and pace they gave stay stored, so "Gain weight" brings back the plan they had. The science leaves keep or gain to the person: muscle grows without a surplus and a small one mostly helps a lean, trained lifter (Helms 2023, Slater 2019, ISSN 2017), while eating less slows it (Murphy & Koehler 2022). *"Ask them (Recommended)"*
- 2026-09-11 · Screen 1, from 4a-iv's click-through: ONE heading, "Your goal", over one grid three to a row — the weight choices are the top row, the goals below — with no second question and neither question's own hint ("Pick one. It sets your daily calories." · "Pick any, or none. You can change these later."); the one line under the heading, which every screen has, reads "Pick one from the top row, and any of the rest", and Kd passed the screen with it (*"all passed"*); a ninth goal, **Stay healthy**, evens the rows; "A gym" loses "(everything there)". *"no seperate things needed all together and heading your goal men"* · *"a gym the bracket everything there not needed"*
- 2026-09-10 · Screen 9 (food) asks the diet: vegetarian · vegetarian with eggs · non-vegetarian · vegan, and every meal suggestion respects it. Kd asked for veg / non-veg; the four choices are the chat's.
- 2026-09-13 · The diet answer is a CEILING, never a demand: non-vegetarian means anything may be suggested, vegetarian and vegan dishes included — *"some one non veg can also eat veg if want"* — so nobody is offered meat every time for having said non-veg. The ladder runs one way only: a vegetarian is never offered meat.
- 2026-09-12 · NO cuisine question, and no cuisine data on the food table — not at sign-up and not in the meal suggestions: *"cuisine data is not needed at all , any way it is a health app hot dog isnot going to be suggested , and hot dog is not any alien food other countries of the world"*. Screen 9 asks the diet and meals a day only; suggestions (7a) come from the whole food table by diet and the calories left.
- 2026-09-10 · EVERYONE is asked a running baseline, not only people who choose running — as the push-up and plank questions are asked of everyone. It is asked, never tested: no all-out run at sign-up. The runner's own questions and the run plan must follow what running coaches and the running community accept; the chat decides the detail. *"should be scitific and professional or running comunity will critisise"*

## Goals and plans

- 2026-09-07 · A goal is *"burning this much calories, eating healthy food, achieving to do exercises recommended by the app or set by myself"* — NOT how many days someone plans to attend. [archive :37031 R15]
- 2026-09-07 · Goals have periods: daily, weekly, monthly and yearly. The app sets a starter set from onboarding; the user can change, remove or add any goal.
- 2026-09-07 · Weekly plans are built per person from their answers, never one plan for everyone; the shape from days and level, the exercises from goal, equipment and health limits, the numbers from level and goal; always editable.
- 2026-09-13 · The dashboard's "Recommended" box gets a row of OPTIONS across its top — Exercise · Food · Running (*"etc"*: the rest is the chat's) — and tapping one shows that kind of recommendation in the same box: *"I want a option exercise food running etc where user click options then the recommendations are shown … same recommendation box, on top the options"*. Each option is fed by its own plan once that plan is built. ROADMAP 7a-ii; the post-workout card is separate and stays.
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
- 2026-08-06 · Post-workout summary content is ported verbatim. [archive :5473] **AMENDED 2026-09-13**: its meal ideas follow the diet (RULINGS 2026-09-10) — the same calorie bands, a food the diet rules out swapped for one it allows (a vegan gets grilled tofu for the chicken, soy yogurt for the Greek yogurt). *"Follow the diet (Recommended)"* **AMENDED AGAIN the same day, from Kd's click-through — the meal ideas are no longer a verbatim port**: no "before bed" on a post-workout card, every timing counts from the workout — *"1 hour before bed what 1 hour before bed it is completely wrong, also this is just a post workout suggestion so what is bed"*; and the foods are what the market eats, rice never the starch the ideas reach for — *"most of the customers are from USA Canada Europe Australia Brazil etc and there rice is not much consumed"*. The third high-band idea's timing is **"In 3–4 hours"** (Kd, 2026-09-13, picked over keeping "Later today", which does not count from the workout: *"In 3–4 hours (Recommended)"*). The stretches and the record labels stay ported. The seven lines are on ROADMAP 4b-ii.
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
- 2026-09-12 · The food list GROWS, and it is not vegetarian-first: the market is the US, Canada and Europe, where more people eat meat — *"my target audience is western and there is more meat consumption so should have non veg also it is not completely veg"*. About 300 foods (131 today, counted this session), meat, fish and eggs among them, each labelled by diet so screen 9's answer can filter them. Built at ROADMAP 7a-i, before the meal suggestions read it.
- 2026-09-12 · A person may build their OWN diet plan beside the app's suggestion — *"user should have a option to make thier own diet plan apart from recommended one just same as the exercises and running"*: swap a meal, add your own, change a portion, keep it for the week, exactly as the weekly workout plan and the run plan allow. ROADMAP 7c.
- 2026-09-11 · Protein is set in grams per kilo and never capped as a share of the calories: the IOM's 10–35 % is a whole-diet guide with no upper safety limit behind it, not a ceiling for a calorie cut. 2.0 g a kilo on a loss (the top of the ISSN's 1.4–2.0 for people who train), 1.6 to keep, 2.2 to gain. A body heavier than BMI 30 for its height is counted at its BMI-30 weight (120 kg at 175 cm: 184 g a day, not 240). "How is this worked out?" names the sources. Kd rejected the first framing (cap at 35 % or keep): *"i dont think so do some research and be scientific"* · then *"go"*.

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
- 2026-09-08 · Trial abuse: NO approval queue; every organisation starts the moment it is created. Four layers, built with Stage 3 item 2 before launch: (1) one person for trial counting across Gmail dots and `+tags`, throwaway email domains refused at the Manage door · (2) the trial belongs to the GYM, not the email: a new organisation whose first members were members of an already-trialled organisation gets no second trial and sees the subscribe prompt; the owner's own device counts as member one · (3) weaker clues (same city and similar name, same address, same laptop) never block; they go on a "have a look" list for Kd (an email until the admin panel), who may pause or remove · (4) a real owner of two gyms gets a second-trial code from Kd. Device rule: ONE DEVICE, ONE TRIAL, whatever the email (a browser mark on the web, the stores on the phone); NOT one device per account — the console on phone and web at once stays. *"i agree to all your recommendation"*

## Privacy and legal

- 2026-07-13 · Production launches with an EMPTY database; dev data is never imported. [archive/RUNBOOK cutover note]
- 2026-07-23 · Data export excludes push tokens; the profile is enumerated, never `SELECT *`; three exports an hour. [archive :872]
- 2026-08-18 · Sharing is opt-in and scoped; gyms never see meal logs, body weight, coach conversations or run routes. [archive :9604 §6]
- 2026-08-18 · An in-app consent screen for health data and the camera is needed before a US gym signs. Privacy-law scope beyond India (GDPR, CCPA, LGPD) is an OPEN question for Kd and a lawyer. [archive :592, :9944]
- 2026-09-07 · Recorded consent at sign-up; see Onboarding for the health screening, Safe mode and disclaimers.
- 2026-09-09 · The consent log outlives account deletion (proof of the tap; no name or health fact on the row) and is removed six years after the deletion date — the market's standard practice that fits US, EU, Indian and Canadian law. *"do the standard practise"*
- 2026-09-09 · The old free-text "medical conditions" box on the fitness profile is switched off when the v2 health screen (4b) lands, and the stored text is wiped then. *"follow your recommendation"* **AMENDED 2026-09-10**: the onboarding copy went with the old form at 4a-ii; the Settings copy stays until 4b.
- 2026-09-13 · The "What {gym} can see" sheet (the join door, screen 11 and Settings) changes, from Kd's click-through of 4b-ii. Three lines leave the flat "Never": meals and nutrition, weight and body measurements, and run routes — *"it will show if user choose to share"*, which is the opt-in of 2026-08-18 said on the screen. Two lines go entirely: the AI-coach conversations (the coach is dropped, RULINGS 2026-08-18) and "anything from before you joined, or after you leave" — *"these lines not needed"*. A knowing deviation from spec Part 3 §2.4's "exactly this list", recorded here as the email row of 2026-09-03 was. Built as its own line, ROADMAP Stage 1 item 8a.

## How work is done (the process Kd chose on 2026-09-07)

- One short rules file (`CLAUDE.md`); this file; `ROADMAP.md`; a ten-line `HANDOFF.md` per chat. Everything older is in `archive/` and is not required reading.
- One whole feature per chat; a plan of ten lines or fewer to Kd; he says go; build with tests; checks green; a short click-through for him; commit; pull request to main; merge within a day or two.
- Independent review is KEPT for every feature: one round in a fresh chat, findings fixed by the building chat, one re-check of the fixes only. *"independent review need to be kept as it did find real problems"*
- Mutation tests: keep the tool, run it only for sign-in, money and other-people's-data code; never in CI.
- 2026-08-06 · Severity: Critical/High = security, data loss, privacy, money, a broken core flow, or anything a user can SEE that is FALSE. Everything found is still fixed. [archive :5348, :5807]
- Never remove a feature, hide it, or shrink a screen without Kd's explicit ruling. Off is not deleted.
- Write to Kd in plain English, short, one decision at a time; a hazard comes with its solutions and a recommendation. *"i need solution not acknowledgement"* [archive :11072]
- Never quote a number that was not produced by a command run this session.
- 2026-09-08 · A review round that finds zero Critical/High may end without the re-check of the
  fixes, on Kd's word for that round. *"no extra review needed"* (words-by-type, six Lows).
- 2026-09-08 · Sizing the work is the chat's job, not Kd's: *"do what is best not because i am asking you to"*. One roadmap line is one chat and one pull request; a chat that finds its line too big splits it in `ROADMAP.md` before building. Stage 1 items 3–7 were split that day.
- 2026-09-09 · A card with NO screen gets NO click-through: *"if does not have screen no click through needed"*. Server-only work is proved by its tests and checks and ticked on merge. The click-through stands for anything a user can see, and a card that builds a screen still gets one.
- 2026-09-11 · Once work is under way the chat does not ask whether to finish; it finishes and posts short updates in plain words. *"give me updates not asking to finish"* · *"use human understanble and readble , mot essays"*
- 2026-09-12 · Order of the next three: the setup screens first (4b-ii, 4b-iii, 4c), then the bigger food list (7a-i), then the build-your-own diet plan (7c) — nothing left half-built, and both new features land on finished answers. All before launch. *"i agree with your recommedation"*
