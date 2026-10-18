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
