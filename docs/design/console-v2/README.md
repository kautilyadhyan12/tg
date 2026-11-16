# The console's second look — the boards (2026-10-18)

Kd's approved designs for every console page (spec Part 3 §17.10; `rulings/2026-10-18-console-redesign-v2.md`).
They change how pages look, never what they do (rule 14 on the `Main` board).

- **See them** on Kd's design canvas: https://claude.ai/artifact/UXjYcm75LYDxVZSJP2ndv9 (private to his account;
  a terminal reads a board with the Artifact tool, `read` with that url and the board's path, e.g. `project/Sell.dc.html`).
- **These files** are the same boards: `Name.dc.html` a screen (the canvas runtime fills `{{look}}`; `t-dark` is the dark
  look, `t-light` the light one), `kit.css` the tokens and building blocks every board uses, `canvas.json` the pages and
  each board's title. A board that shows a panel over a page names the page under it in `<dc-import name="…">`.
- **Build from them** as the ROADMAP's V job says: the board's layout, sizes and words, the page's own buttons, fields,
  messages and permissions (where a board lacks something the page has, the page keeps it, drawn from the same blocks).

| Board | Page on the canvas | What it shows | Built in |
|---|---|---|---|
| `Main` | 1 Read me first | The rules every page follows | — (the rules) |
| `Before` | 1 Read me first | What is wrong today — real pictures | — (the rules) |
| `Anatomy` | 1 Read me first | One page, explained | — (the rules) |
| `PersonMaya` | 2 A member's page | A member's page — paid up (Maya) | V2a |
| `PersonArnav` | 2 A member's page | Payment overdue, paid by a parent (Arnav) | V2a |
| `PersonMeera` | 2 A member's page | Pays for her family (Meera) | V2a |
| `PersonDev` | 2 A member's page | Nothing set up yet (Dev) | V2a |
| `PersonLight` | 2 A member's page | The same page in the light look | V2a |
| `AddMember` | 2 A member's page | Add member | V2b |
| `PersonEdit` | 2 A member's page | Edit their details | V2b |
| `PersonAddMembership` | 2 A member's page | Add a membership | V2b |
| `PersonRecordPayment` | 2 A member's page | Record a payment | V2b |
| `PersonQuick` | 2 A member's page | Quick boxes: More, tags, who pays, a payment | V2b |
| `PersonCancel` | 2 A member's page | Cancel a membership | V2b |
| `PersonFreeze` | 2 A member's page | Freeze a membership | V2b |
| `PersonRefund` | 2 A member's page | Money questions: refund, void, waive, unfreeze | V2b |
| `PersonReceipt` | 2 A member's page | A receipt | V2b |
| `PersonRemove` | 2 A member's page | People questions: invite, remove, delete | V2b |
| `PersonMerge` | 2 A member's page | Merge a duplicate | V2b |
| `PersonPast` | 2 A member's page | A past member who is still in the app (Riya) | V2a |
| `Overview` | 3 Overview & getting in | Overview — a gym in use | V5 |
| `OverviewNew` | 3 Overview & getting in | Overview — a gym made today | V5 |
| `OverviewPlan` | 3 Overview & getting in | Your gym's plan: choose a plan, change size, the plan card | V5 |
| `Banners` | 3 Overview & getting in | The banner above every page | V5 |
| `Orgs` | 3 Overview & getting in | Your organisations | V5 |
| `CreateGym` | 3 Overview & getting in | Create your organisation | V5 |
| `GymReady` | 3 Overview & getting in | Start your free trial — opens over a new gym | V5 |
| `SignIn` | 3 Overview & getting in | Sign in | V5 |
| `StaffInvite` | 3 Overview & getting in | A staff invitation, and the sign-in code | V5 |
| `OverviewLight` | 3 Overview & getting in | Overview in the light look | V5 |
| `Attendance` | 4 Attendance & front desk | Attendance — one list, a day at a time | V7 |
| `AttendanceSearch` | 4 Attendance & front desk | Checking someone in by name | V7 |
| `Desk` | 4 Attendance & front desk | Front desk tablet — ready | V7 |
| `DeskWelcome` | 4 Attendance & front desk | Front desk — checked in | V7 |
| `DeskRefused` | 4 Attendance & front desk | Front desk — please see a member of staff | V7 |
| `DeskWaiver` | 4 Attendance & front desk | Front desk — the camera open | V7 |
| `DeskSetup` | 4 Attendance & front desk | Front desk — setting it up | V7 |
| `Classes` | 5 Classes & training | Classes | V8 |
| `ClassesCalendar` | 5 Classes & training | Calendar — the week at a glance | V8 |
| `ClassSession` | 5 Classes & training | One class on one day | V8 |
| `ClassAdd` | 5 Classes & training | Add a class | V8 |
| `ClassTimeSlot` | 5 Classes & training | Add a time slot | V8 |
| `PT` | 5 Classes & training | Personal training | V8 |
| `PTBook` | 5 Classes & training | Book a session — opens under the time pressed | V8 |
| `PTHours` | 5 Classes & training | A coach's hours | V8 |
| `PTTimeOff` | 5 Classes & training | A coach's time off | V8 |
| `Sell` | 6 Sell & memberships | Sell — the register | V4a |
| `SellMember` | 6 Sell & memberships | A sale recorded, and a sale's ⋯ | V4a |
| `SellProducts` | 6 Sell & memberships | Products, and adding one | V4a |
| `SellTax` | 6 Sell & memberships | Tax | V4a |
| `Memberships` | 6 Sell & memberships | Memberships — your price list | V4b |
| `MembershipAdd` | 6 Sell & memberships | Add a membership type | V4b |
| `MembershipsBills` | 6 Sell & memberships | Discounts, and adding one | V4b |
| `Leads` | 7 Leads & at risk | Leads | V6 |
| `LeadDrawer` | 7 Leads & at risk | One lead | V6 |
| `LeadAdd` | 7 Leads & at risk | Add lead | V6 |
| `LeadImport` | 7 Leads & at risk | Import leads — after the file is read | V6 |
| `GymPage` | 7 Leads & at risk | Your gym page | V6 |
| `AtRisk` | 7 Leads & at risk | At risk | V6 |
| `AtRiskNew` | 7 Leads & at risk | At risk — a gym in its first two weeks of check-ins | V6 |
| `Updates` | 8 Community | Updates | V9a |
| `UpdatesPerson` | 8 Community | One member’s posts (their name pressed) | V9a |
| `UpdatesRemove` | 8 Community | Remove a post | V9a |
| `UpdatesStop` | 8 Community | Stop someone posting | V9a |
| `Events` | 8 Community | Events | V9a |
| `EventAdd` | 8 Community | Add an event | V9a |
| `EventCancel` | 8 Community | Cancel an event | V9a |
| `Challenges` | 8 Community | Challenges | V9b |
| `ChallengeDetail` | 8 Community | One challenge, opened | V9b |
| `ChallengeAdd` | 8 Community | Add a challenge | V9b |
| `Leaderboard` | 8 Community | Leaderboard | V9b |
| `LeaderboardPerson` | 8 Community | One person on the board | V9b |
| `Reports` | 9 Reports | Reports — members, leads, attendance, classes | V10 |
| `ReportsMoney` | 9 Reports | Reports — money, with Download payments open | V10 |
| `Settings` | 10 Settings | Settings — Gym details | V11 |
| `SettingsHours` | 10 Settings | When we’re open | V11 |
| `SettingsReach` | 10 Settings | How members reach you | V11 |
| `SettingsMessages` | 10 Settings | Automatic messages | V11 |
| `SettingsReferral` | 10 Settings | Refer a friend | V11 |
| `SettingsBooking` | 10 Settings | Booking rules | V11 |
| `SettingsDesk` | 10 Settings | Check-in devices | V11 |
| `SettingsWho` | 10 Settings | Who can check in | V11 |
| `SettingsWaiver` | 10 Settings | Waiver | V11 |
| `SettingsFollowUp` | 10 Settings | Follow-up emails to leads | V11 |
| `PhoneOverview` | 11 On a phone | Overview | V5 |
| `PhonePerson` | 11 On a phone | A member’s page | V2a |
| `PhoneRecordPayment` | 11 On a phone | Record a payment (sheet) | V2b |
| `PhoneForm` | 11 On a phone | Add member | V2b |
| `PhoneAttendance` | 11 On a phone | Attendance | V7 |
| `PhoneSell` | 11 On a phone | Sell | V4a |
| `PhoneClasses` | 11 On a phone | Classes — calendar | V8 |
| `PhoneMore` | 11 On a phone | More | V1 |
| `MembersRef` | 12 Members & staff (your choice) | Today, kept as it is (for comparing) | — (today, for comparing) |
| `MembersNew` | 12 Members & staff (your choice) | Proposal · Your list | V3a |
| `MembersNewSelected` | 12 Members & staff (your choice) | Proposal · people ticked, one action bar | V3a |
| `MembersNewMessage` | 12 Members & staff (your choice) | Proposal · Send message names who gets it | V3a |
| `MembersNewFilter` | 12 Members & staff (your choice) | Proposal · Filter from the right | V3a |
| `MembersNewApp` | 12 Members & staff (your choice) | Proposal · In the app, and people waiting to join | V3b |
| `MembersNewStaff` | 12 Members & staff (your choice) | Proposal · Staff | V3b |
| `MembersNewStaffPerson` | 12 Members & staff (your choice) | Proposal · one person on the staff | V3b |
| `MembersNewPhone` | 12 Members & staff (your choice) | Proposal · on a phone | V3a |

## Brought up to date (V0, from 2026-11-15)

The boards above were drawn on 2026-10-18; the console has grown since (ROADMAP item 22, V0; `rulings/2026-11-15-v0-a.md`).
The V0 boards are also on their own canvas, https://claude.ai/artifact/7mTA4UbxX7AZ4njAHBNw4g (private to the Claude account
of the web folder's laptop). V0 draws what they miss, in the same look and the same blocks, from the real pages: V0-a took a picture and the words of
every console page and of each box a member's page opens, signed in to the US Square test gym on the web folder's own
database (`apps/api/.cost/v0-a/today.mts` and `boxes.mts`, untracked), and counted, page by page, the lines no board has.
Every word on a V0 board is the real page's; the gym (Iron House, Austin, in dollars, because cards and the Terminal are
Square's) and its people are made up. The menu on each V0 board has the two lines the real menu gained: Failed payments
under Money, Fitness plans under Community.

### Drawn in V0-a: a member's page and its boxes

| Board | Page on the canvas | What it shows | Built in |
|---|---|---|---|
| `PersonCard` | 2 A member's page | Pays by card: agreement signed, a payment on the Terminal with View receipt and Refund, Change membership, Meal plan, Card on file | V2a |
| `PersonCardStates` | 2 A member's page | Card on file in each case: saved, paused, none (in the app, asked, not in the app) | V2a |
| `PersonChargeback` | 2 A member's page | A lost chargeback and its refund on a bill; agreement not signed | V2a |
| `PersonChargebackStates` | 2 A member's page | The chargeback line: waiting for an answer, a bank inquiry, won, lost | V2a |
| `PersonTakePayment` | 2 A member's page | Take a payment: Card on Terminal (choose the Terminal, save the card), or Charge the card on file | V2b |
| `PersonRefundCard` | 2 A member's page | The Refund menu, then Refund to card in the middle | V2b |
| `PersonCardTerminal` | 2 A member's page | Save or replace a card on the Terminal, and waiting on it | V2b |
| `PersonCardType` | 2 A member's page | Type card instead: Square's card form and the member's tick | V2b |
| `PersonCardRemove` | 2 A member's page | Remove card asks first | V2b |
| `PersonCardPause` | 2 A member's page | Pause automatic payments asks first, naming each membership | V2b |
| `PersonAgreementView` | 2 A member's page | A signed agreement, from the right | V2b |
| `PersonAgreementSign` | 2 A member's page | Sign the agreement at the desk, handed to the member or a parent | V2b |
| `PersonChange` | 2 A member's page | Change membership: choosing the new one, and the line when a payment is due | V2b |
| `PhonePersonCard` | 11 On a phone | A member's page on a phone with what it gained | V2a |

Notes for V2a and V2b: the receipt (`PersonReceipt`) gains its "Paid by card on Terminal" and "Taken by" lines; Add a
membership (`PersonAddMembership`) picks the type from one list; Choose who pays and Add someone they pay for keep
`PersonQuick`'s search box. Today's page puts Record payment under the membership; the boards keep it on the bill that
is owed, where the approved boards put it.

### Drawn in V0-b: money pages and Overview

From V0-a's pictures of the whole pages and V0-b's of each box they open (`apps/api/.cost/v0-b/shots.mts`, untracked;
nothing saved, charged or sent). Each Overview box shows only when it has something in it.

| Board | Page on the canvas | What it shows | Built in |
|---|---|---|---|
| `OverviewMoney` | 3 Overview & getting in | Start here at 6 of 8, then Failed payments, Refunds to review, App payments to review, Cancelled in the app and Chargebacks, the trial | V5 |
| `OverviewStartHere` | 3 Overview & getting in | See all 8 steps opened: each step, Done or Not done yet, and its button | V5 |
| `OverviewMoneyStates` | 3 Overview & getting in | Chargebacks waiting, only lost, Square to reconnect (owner, other staff); refunds to review after a cooling-off cancel, a refund that went wrong, a lost chargeback on a sale; Keep the fee asks first | V5 |
| `SellTerminal` | 6 Sell & memberships | Card on Terminal and choosing the Terminal, waiting on it, and each way it ends | V4a |
| `SellDay` | 6 Sell & memberships | Another day's sales: the day's sums, refunds noted, Part refunded and Chargeback lost, the chargeback and refund lines | V4a |
| `SellRefund` | 6 Sell & memberships | Refund on a sale: Refund to card or Note a refund, then which product | V4a |
| `MembershipsList` | 6 Sell & memberships | The price list with Sold in the app, taxes, joining fee, minimum term, early cancellation fee, notice and cooling-off; Bills with billing day, freeze fee and the card expiry reminder | V4b |
| `MembershipTerms` | 6 Sell & memberships | Change membership type: taxes ticked, joining fee, minimum term, early cancellation fee, notice, cooling-off, both reminders, Sell in the app | V4b |
| `MembershipRaise` | 6 Sell & memberships | A higher price for members already on it: keep or move them, the notice, who pays the new price and who won't change | V4b |
| `FailedPayments` | 6 Sell & memberships | Failed payments, its own page, with Try again open | V4a |
| `FailedPaymentsCard` | 6 Sell & memberships | Add a new card opens the card box under the row | V4a |
| `SquareReturn` | 10 Settings | The page after Connect Square: connecting, nothing connected, finishing failed | V9a |

Notes for V4a, V4b and V5: today's Memberships and Sell are one long page each; the boards keep the approved tabs, with
Tax and Discounts as drawn in `SellTax` and `MembershipsBills`. Failed payments is a new menu line under Money: V4a builds
its page. Stock left shows on each product ("24 left"), as `Sell` already draws it.

### Drawn in V0-c: Settings and the new pages

From V0-a's pictures of the whole pages and V0-c's of each box they open (`apps/api/.cost/v0-c/shots.mts`, untracked;
nothing saved, sent or paired). Where the test gym has nothing to show (comments, reactions, sent messages, duplicates,
people to review, kept forms, pairing a Terminal), the words are the code's own. The menu on each V0-c board also has
Your account at its foot, above Sign out, as the real menu has.

| Board | Page on the canvas | What it shows | Built in |
|---|---|---|---|
| `SettingsPayments` | 10 Settings | Payments: connected to Square, the business and location, Square Terminals and Pair a Terminal, the paying-twice line, Ask members to add their card, Disconnect Square | V11 |
| `SettingsPaymentsBoxes` | 10 Settings | Remove this Terminal?, pairing a Terminal with its code and each way it ends, Disconnect Square? | V11 |
| `SettingsAgreement` | 10 Settings | Membership agreements: the default one, Other agreements, Add agreement, Before they book with who has not signed | V11 |
| `SettingsAgreementAdd` | 10 Settings | Add agreement (name, terms, used for), and Stop new bookings until they sign chosen | V11 |
| `SettingsDeletedForms` | 10 Settings | Signed forms of deleted members: search, the forms kept, one opened | V11 |
| `SettingsBookingOverdue` | 10 Settings | Booking rules' third box, Overdue payments: stop new bookings until they pay, the grace period, who it stops | V11 |
| `Account` | 10 Settings | Your account: Delete account, and each step after (an owner first chooses a new owner; anyone else gets a code) | V11 |
| `Plans` | 8 Community | Fitness plans: the meal plans and who gets each, New meal plan opened | V9a |
| `PlanOpen` | 8 Community | A meal plan opened: Who gets it, the allergy line, the days, each meal, Add a meal | V9a |
| `PlanMeal` | 8 Community | A meal opened with Change: amounts, Search food with allergens, Your own food; Add a meal to Monday | V9a |
| `PlanGive` | 8 Community | Give to members: everybody, a membership, a tag or members chosen, who will get it | V9a |
| `UpdatesComments` | 8 Community | Members can comment, reactions and who reacted, a post's comments with replies, Reply and the comment box | V9a |
| `UpdatesCommentsReported` | 8 Community | Reported comments: Keep, Remove, Stop; a hidden comment; Remove and Stop ask first | V9a |
| `PersonMealPlan` | 2 A member's page | The Meal plan box: Give a meal plan, the plan they get and how | V2b |
| `MembersCardAsk` | 12 Members & staff | No card on file, people ticked, the bar with Ask to add card and Meal plan, the Ask to add card box | V3a |
| `MembersFilterCard` | 12 Members & staff | Filter with Show, Agreement and Card | V3a |
| `MembersReview` | 12 Members & staff | Members who need review | V3a |
| `MembersDuplicates` | 12 Members & staff | Possible duplicates | V3a |
| `MembersSent` | 12 Members & staff | Sent messages by day, and Sent to with the names | V3a |
| `PhoneMoreNow` | 11 On a phone | More on a phone with Failed payments, Fitness plans and Your account | V1 |

Notes: every V0 board now has its V job, so no new V line is needed: Fitness plans is a Community page and goes with V9a;
the menu's three new lines (Failed payments, Fitness plans, Your account) go with V1's menu, as `PhoneMoreNow` and the V0
boards' menus draw them. Today's Settings is one long page of folding sections; the boards keep the approved side list
(`Settings`), with Payments under Your gym and the two agreement sections under Members.
