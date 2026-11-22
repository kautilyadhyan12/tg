# The console's third look — the boards (2026-11-18)

Kd's approved designs for the console's third look (spec Part 3 §17.11;
`rulings/2026-11-18-console-look-3.md`). They replace the second look's layout and colours
(`docs/design/console-v2`). They take nothing away: every button, field, message and
permission a page has stays.

- **See them** on the design canvas: https://claude.ai/artifact/FC7WVSbtkJvrEw5ttTZfUi (private to
  the Claude account of the web folder's laptop; a terminal reads a board with the Artifact tool,
  `read` with that url and the board's path, e.g. `project/Overview.dc.html`).
- **These files** are the same boards: `Name.dc.html` a screen (the canvas fills `{{look}}`; the
  root's `t-dark` is the dark look, `t-light` added after it is the light one), `kit3.css` the
  colours and building blocks every board uses, `canvas.json` each board's title and size.
- **Build from them** as the ROADMAP's job says: the board's layout, sizes and words, the page's
  own buttons, fields, messages and permissions. Where a board lacks something the page has, the
  page keeps it, drawn from the same blocks.
- **A page with no board here yet** takes its layout from its `console-v2` board and the real
  page, and its look and words from `kit3.css` and the word list (`Main`, spec §17.11), until
  V0-d draws it.

| Board | What it shows | Built in |
|---|---|---|
| `Main` | The eight rules, the building blocks, the word list | V1-c (the blocks) |
| `Overview` | The bar across the top, the menu with counts, Overview with "Needs attention" | V1-c (the bar and menu), V1-d (the counts and the bell), V5 (the page) |
| `OverviewLight` | The same page in the light look | V1-c, V5 |
| `Search` | Search: a topic ("money"), a name ("sam"), and before typing | V1-e |
| `Money` | Payments overview, with Square connected | V1-f |
| `MoneySetup` | Payments overview before Square is connected, drawn as a Pilates studio | V1-f |
| `Members` | Members & staff: Your list | V3a |
| `Person` | A member's page in three columns, the next step under the name | V2a |
| `Phone` | The console on a phone: the top bar, Overview, the five tabs | V1-c (the bar), V5 (the page) |
| `Boxes` | Where a box opens: under its button, from the right, in the middle, a page of its own; each on a computer and on a phone | every V job (V0-d-i) |
| `Sell` | Sell: the register as a till, products on the left and the sale on the right with the payment method, total and Take payment always on screen; Revenue today, Sell a membership, Today's sales | V4a (V0-d-i) |
| `SellSale` | Sell: Card on Terminal waiting and each way it ends, Sale recorded, a sale's ⋯, Void sale in the middle, Refund sale under the sale, a Terminal not ready | V4a (V0-d-i) |
| `SellDay` | Sell: another day, its calendar, refunds noted, chargebacks | V4a (V0-d-i) |
| `SellProducts` | Sell: Products, Add a product from the right, archived, what stands in the way | V4a (V0-d-i) |
| `SellTax` | Tax rates, Add a tax rate under its button, Choose products, Remove, how the tax is charged (Sell's Tax tab and Memberships' Tax tab) | V4a, V4b (V0-d-i) |
| `Discounts` | Discounts, Add a discount from the right, Archive, Put back (Memberships' Discounts tab; Sell's draws the same for products) | V4b, V4a (V0-d-i) |
| `Memberships` | Memberships: the price list, On your member list not set up yet, Billing rules | V4b (V0-d-i) |
| `MembershipsGive` | Give it to them, Renew memberships and Stop counting it: who gets it and who doesn't | V4b (V0-d-i) |
| `MembershipAdd` | Add (and Change) a membership type, a page of its own in five numbered parts with "You're adding" | V4b (V0-d-i) |
| `MembershipRaise` | A higher price for members already on it: keep or move them, the notice, who pays the new price | V4b (V0-d-i) |
| `PhoneSell` | Sell on a phone: the register with Take payment at the foot, today's sales, a sale's ⋯ and Void sale from the bottom | V4a (V0-d-i) |
| `PhoneMemberships` | Memberships on a phone: the price list, Add a membership type and Add a discount as full pages, Give it to them from the bottom | V4b (V0-d-i) |
| `Attendance` | Attendance: Check in, Today's check-ins with Remove under its row, Check-in history by day with a person's visits under their name, a visit added for an earlier day | V7 (V0-d-ii-a) |
| `Desk` | The front desk: waiting, Checked in, see a member of staff, the camera, every other answer, opening a device's link, a browser somebody is signed in to, on a phone | V7 (V0-d-ii-a) |
| `PhoneAttendance` | Attendance on a phone: Check in, Today's check-ins, Remove under its row, Check-in history | V7 (V0-d-ii-a) |
| `Leads` | Leads: the list with its status picks, tick boxes and the selected bar, Select all, Delete in the middle | V6 (V0-d-ii-a) |
| `LeadPanel` | A lead from the right: status, messages from your page, follow-up emails, details, Joined and choosing a record, Add lead, Delete lead | V6 (V0-d-ii-a) |
| `LeadImport` | Import leads in the middle: choosing a file, who will be added and who won't, your columns | V6 (V0-d-ii-a) |
| `GymPage` | Your gym page from the right: the link, about us, photos, facilities, opening hours, the form for your own website | V6 (V0-d-ii-a) |
| `AtRisk` | At risk: who has stopped coming, a message under the name, Who is listed, before there are 14 days of check-ins | V6 (V0-d-ii-a) |
| `PhoneLeads` | Leads and At risk on a phone: the list with the selected bar at the foot, a lead as a full page, At risk | V6 (V0-d-ii-a) |
| `Classes` | Classes: the classes with their time slots, Edit class, Bulk edit, Archive and Cancel asking under what was pressed, Archived classes and Restore, every other state | V8 (V0-d-ii-b) |
| `ClassAdd` | Add class and Edit class from the right, the coach list, a coach who has a session at that time (Save anyway), what the form refuses | V8 (V0-d-ii-b) |
| `ClassTimeSlot` | A new time slot from the right: days, start time, dates with the date picker, length, coach, size, online and its link | V8 (V0-d-ii-b) |
| `ClassSlotEdit` | Edit a time slot from a date, Move anyway, the bookings a move ends in the middle, Bulk edit from the right, Make it online under the time slot | V8 (V0-d-ii-b) |
| `ClassesCalendar` | The Calendar: a week of day columns, the filters, Cancelled and Changed, its other states | V8 (V0-d-ii-b) |
| `ClassSession` | A class on the Calendar from the right: who is booked, the waitlist, Cancelled late, Remove under the person; Came and No-show once it has started | V8 (V0-d-ii-b) |
| `ClassSessionEdit` | A class on the Calendar: Edit (this class only, or this and future), Cancel class, the bookings it ends in the middle, Un-cancel | V8 (V0-d-ii-b) |
| `PhoneClasses` | Classes on a phone: the list, the Calendar by day, a class as a full page, Cancel class from the bottom | V8 (V0-d-ii-b) |
| `PT` | Personal training: How to set up, the trainers, Add a trainer, a trainer's week with its days, booked sessions and available times, every other state | V8 (V0-d-ii-b) |
| `PTBook` | Book a session under the time pressed, Cancel under the session with each choice, Came or No-show and the fee lines | V8 (V0-d-ii-b) |
| `PTHours` | A trainer's hours from the right, what the form refuses, and Your hours as a trainer who is not a manager sees them | V8 (V0-d-ii-b) |
| `PTTimeOff` | Time off from the right: what is coming, Remove under it, Add time off, the sessions and classes it covers | V8 (V0-d-ii-b) |
| `PhonePT` | Personal training on a phone: the trainers, a week, Book a session, hours as a full page | V8 (V0-d-ii-b) |
| `Reports` | Reports: the side list On this page, the period, Members with each figure and how it is worked out, Month by month, Leads that became members, Attendance with Visits day by day, week by week and Busiest hours | V10 (V0-d-iii-a) |
| `ReportsMoney` | Reports: Classes, Money with Export payments opened in its place, Monthly recurring revenue, Collected, Payment due, Lifetime value, the four money tables, Staff activity | V10 (V0-d-iii-a) |
| `ReportsStates` | Reports before there are figures: each part's button to the exact place, who can for staff who may not, a figure without enough behind it, Export payments' other lines, a role without reports or money, loading and Try again | V10 (V0-d-iii-a) |
| `PhoneReports` | Reports on a phone: On this page as a row that scrolls, figures stacked, tables scrolling in their box, Export payments | V10 (V0-d-iii-a) |
| `Settings` | Settings: the side list with each section's state, Gym details with every message, India's mobile number, Leave this page? in the middle | V11 (V0-d-iii-a) |
| `SettingsPayments` | Payments: connected to Square, Square Terminals, the paying-twice line, Ask members to add their card, Disconnect Square; what staff who are not the owner read; before connecting, choosing a location, other countries, after a disconnect | V11 (V0-d-iii-a) |
| `SettingsPaymentsBoxes` | Remove a Terminal under its row, Pair a Square Terminal in the middle with each way it ends, Disconnect Square? under its button | V11 (V0-d-iii-a) |
| `SettingsHours` | When we're open: the clock, Open 24 hours or Set opening times, a day's times, what the form refuses; Closed on a date and Undo | V11 (V0-d-iii-a) |
| `SettingsReach` | How members reach you: phone number and email address | V11 (V0-d-iii-a) |
| `SettingsMessages` | Automatic messages: the ten messages, each with its switch, number, words and own line; the button to the exact place where nobody would get one yet; Save pinned | V11 (V0-d-iii-a) |
| `SettingsReferral` | Refer a friend: the switch, the gift for each side, its promo code, what members and their friend read | V11 (V0-d-iii-a) |
| `PhoneSettings` | Settings on a phone: the list of sections first, each section a page of its own with Save at the foot, Disconnect Square from the bottom | V11 (V0-d-iii-a) |
| `SettingsBooking` | Booking rules: Classes and Personal training, each rule with its own line, the fees, where a fee cannot be set yet, every message Save can say | V11 (V0-d-iii-b) |
| `SettingsBookingOverdue` | Booking rules: Overdue payments, Stop new bookings until they pay, the grace period in Billing rules, who it stops today with View all | V11 (V0-d-iii-b) |
| `SettingsDevices` | Check-in devices: each device with On, Waiting, Off or Paused, the new link to open once, New link and Switch off asked under the device, Add a device | V11 (V0-d-iii-b) |
| `SettingsWho` | Who can check in: who the front desk checks in, overdue payments and waivers, who is sent to staff today and why, Open Attendance | V11 (V0-d-iii-b) |
| `SettingsWaiver` | Waiver: the words, who has signed, who will be asked to sign, Turn off asked under its button; before there is one and once it is turned off | V11 (V0-d-iii-b) |
| `SettingsAgreement` | Membership agreements: the default agreement, Other agreements, Add agreement, Before they book with who has to sign today, Turn off asked under its button | V11 (V0-d-iii-b) |
| `SettingsAgreementAdd` | Add agreement under Other agreements (name, terms, used for, a membership moving from another), one opened under its own line, Turn off for one | V11 (V0-d-iii-b) |
| `SettingsDeletedForms` | Signed forms of deleted members: search, the forms kept, one opened in place with its facts and terms; what staff who are not the owner read | V11 (V0-d-iii-b) |
| `SettingsFollowUp` | Follow-up emails to leads: Send them for me, Replies go to, this month's count, each reason it cannot send with its button | V11 (V0-d-iii-b) |
| `Account` | Your account: Delete account, an owner choosing a new owner first, staff getting a code, the code | V11 (V0-d-iii-b) |
| `PhoneSettingsDesk` | On a phone: Who can check in as a page with Save at the foot, Turn off a waiver from the bottom, a device's new link, Your account from More | V11 (V0-d-iii-b) |

## Drawn in V0-d-i (2026-11-19)

- **Every button, field and message of the real Sell and Memberships pages is on these boards**: 267 of
  267, read from the code (`Sell.jsx`, `SaleRefunds.jsx`, `TerminalPayBox.jsx`, `SellProducts.jsx`,
  `TaxRates.jsx`, `SellDiscounts.jsx`, `MembershipTypesPanel.jsx`, `MembershipFromList.jsx`,
  `BillSettingsCard.jsx` and their views). The words are the code's own; only the word list changes them.
- **Each board was looked at in headless Edge at V1-a's 24 screen shapes in both looks**, from a
  280 px folding-phone cover to a 2560 px monitor, the opened folding phones and both screens of a dual
  phone among them: nothing wider than the window, no words under 14 px outside the allowed small kinds,
  no words over each other. The nine boards above were drawn before that check; V5 finds the Overview
  board's chart labels at 11 px and one button too wide for a phone, and `Phone` is drawn at a fixed 390 px.
- **Word changes** beyond the list on `Main`: "Change" on a product, tax rate, discount or membership
  type reads **Edit**, as on `Person`; "See another day's sales" reads **View another day**; "Taken today"
  reads **Revenue today**; "Bills" reads **Billing rules**, as Payments overview names it, and keeps its
  place under the price list, where Payments overview's line opens it.
- **Easy to find one's way (Kd's question at the board review, 2026-11-19):** the open tab is orange, as the
  menu marks the open page; on Sell the sale panel is one screen tall beside the products, its lines scroll
  inside it and the payment method, total and Take payment stay at its foot (on 1366×768 Take payment is on
  the first screen); on a page of its own (`MembershipAdd`, `MembershipRaise`) the save bar stays pinned to
  the foot of the screen.
- **On a phone**, a row's buttons that do not fit go into its ⋯, which opens from the bottom with every
  one of them (`PhoneSell`); nothing is dropped.
- `kit3.css` gained, for every board: the 2026-11-19 sizes and colours (no words under 14 px, every word
  colour 7 to 1, the values `console.css` already measures); buttons, tabs and fields 44 px tall on a
  touch screen; long button words wrap on a narrow phone; Ctrl K only where there is a keyboard; the
  phone's tab names fit a 280 px cover; the open tab in orange.

## Drawn in V0-d-ii-a (2026-11-20)

- **Every button, field and message of the real Attendance, front desk, Leads and At risk pages is on these
  boards**: 361 of 361, read from the code (`Attendance.jsx`, `AttendanceCheckIn.jsx`, `CheckinDesk.jsx`,
  `DeskCamera.jsx`, `deskView.js`, `Leads.jsx`, `LeadsDelete.jsx`, `LeadSheet.jsx`, `LeadFileImport.jsx`,
  `GymPageSheet.jsx`, `AtRisk.jsx`, their views and the words in `packages/shared`). Settings' front desk
  sections (Check-in devices, Who can check in, Waiver) are drawn with Settings in V0-d-iii; the desk waiver a
  member signs is on their page (V2b).
- **Looked at in the same 24 screen shapes in both looks** as V0-d-i's boards.
- **Word changes** beyond the list on `Main`: "Who came" reads **Check-in history**; "See all 42" reads **View
  all 42**. "Check someone in" reads Check in and "Checked in today" reads Today's check-ins, as the list says.
- **Where each box opens** (`Boxes`): Remove a check-in, Add visit, Delete lead, Joined and a message to a member
  who stopped coming open under what was pressed; a lead and Your gym page from the right; Delete leads and
  Import leads in the middle, naming who changes.
- **The front desk** is a page of its own with no menu, drawn at a tablet's size and on a phone; its answers
  are said in words and colour, never colour alone.

## Drawn in V0-d-ii-b (2026-11-20)

- **Every button, field and message of the real Classes, Calendar and Personal training pages is on these
  boards**: 415 of 415, read from the code (`Classes.jsx`, `ClassFields.jsx`, `ClassOnline.jsx`, `ClassWeek.jsx`,
  `PersonalTraining.jsx`, `ClassBookingsList.jsx`, `BookingsEndBox.jsx`, `TrainerSessionsBox.jsx`, `BookingRulesLine.jsx`,
  `TimePick.jsx`, `DatePick.jsx` and their views). An icon button's spoken name counts as its words. The booking rules
  themselves (when members can book, the waitlist, the fees, overdue payments) are drawn with Settings in V0-d-iii;
  each page keeps its line and Change booking rules.
- **Looked at in the same 24 screen shapes in both looks** as V0-d-i's boards.
- **Word changes** beyond the list on `Main`: "See all" reads **View all**; "See week" reads **View week**. A gym's
  trainers follow the kind of business, as `orgWords` already does (Trainers, Add a trainer).
- **Where each box opens** (`Boxes`): Add class, Edit class, a new time slot, Edit on a time slot, Bulk edit, a
  trainer's hours and their time off from the right, Save at the foot; a class pressed on the Calendar from the right
  (today it opens under the week); Archive, Cancel time slot, Cancel class with nobody booked, Remove from class,
  Make it online, Book a session, Cancel on a session and Remove time off under what was pressed; the bookings a
  change would end in the middle, naming them (today in place), rising from the bottom on a phone.
- **The Calendar** is drawn as the real page shows it: a column for each day, each class a card, stacked by day on a
  phone. The second look's hour grid is not the page.
- **On a phone** an available time and a long button wrap on two lines rather than run off a 280 px cover; the
  week's days carry a dot for what is on them, and the day's own name says it.

## Drawn in V0-d-iii-a (2026-11-20)

- **Every button, field and message of the real Reports page and of Settings' first six sections is on these
  boards**: 407 of 407, read from the code (`Reports.jsx`, `ReportCharts.jsx`, `ReportAttendanceCharts.jsx`,
  `PaymentsDownload.jsx`, `Settings.jsx`, `GymDetailsPanel.jsx`, `PaymentsPanel.jsx`, `SquareTerminals.jsx`,
  `PlaceLink.jsx`, `OpeningHoursPanel.jsx`, `TimePick.jsx`, `MemberContactPanel.jsx`, `MessageSettingsPanel.jsx`,
  `ReferralPanel.jsx`, their views and the words in `packages/shared`). The other Settings sections (Booking rules,
  Membership agreements, Signed forms of deleted members, Check-in devices, Who can check in, Waiver, Follow-up
  emails to leads) and Your account are drawn in V0-d-iii-b; the side list already names them with their state.
- **Looked at in the same 24 screen shapes in both looks** as V0-d-i's boards. The checker now also leaves out
  words scrolled out of sight sideways inside a box (a wide table on a phone).
- **Word changes** beyond the list on `Main`: "Download CSV" reads **Export CSV**, "Download payments" reads **Export
  payments**, as Payments overview names it, and its button reads Export; "See who" and "See past members" read
  **View who** and **View past members**; "See it in Discounts" reads **View it in Discounts**; "Open staff activity"
  reads **View staff activity**; "Bills" reads **Billing rules** in Payment due's line and in Automatic messages
  ("Open Billing rules"), as V0-d-i named it.
- **Reports** keeps one long page, the figures in their order, with a side list, On this page, that jumps to each
  part and marks where you are; on a phone it is a row that scrolls under the period. A wide table scrolls inside
  its own box on a phone. Export payments opens in its own place, as today.
- **Settings** is the side list and one section at a time (today it is one page of folding sections). The side list
  says each section's state in a short line; on a phone the list is the first screen and a section is a page of its
  own with Save at the foot. Each section keeps its own Save. Where a box opens (`Boxes`): Remove a Terminal and
  Disconnect Square under what was pressed; Pair a Square Terminal and Leave this page? in the middle; Disconnect
  Square from the bottom on a phone.

## Drawn in V0-d-iii-b (2026-11-21)

- **Every button, field and message of Settings' last seven sections and of Your account is on these boards**:
  346 of 346, read from the code (`BookingSettingsPanel.jsx`, `CheckinDevicesPanel.jsx`, `CheckinRulesPanel.jsx`,
  `WaiverPanel.jsx`, `AgreementPanel.jsx`, `OtherAgreementForm.jsx`, `AgreementBookingsPart.jsx`,
  `DeletedFormsPanel.jsx`, `LeadEmailsPanel.jsx`, `Account.jsx`, their views and the words in `packages/shared`).
  Signing at the desk, a card agreed on a Terminal and a copy emailed belong to a member's page (V2a, V2b) and the
  front desk (V7), and are not drawn here. With these, every console page has a third-look board.
- **Looked at in the same 24 screen shapes in both looks** as the boards before.
- **Word changes** beyond the list on `Main`: "See all" reads **View all**, as V0-d-ii-b named it; "the Bills box on
  Memberships" reads **Billing rules on Memberships**, as V0-d-i named it.
- **Booking rules** keeps one Save for its three boxes (Classes, Personal training, Overdue payments), pinned at the
  foot as on Automatic messages. **Membership agreements** keeps two: the agreement's own, and Before they book's.
- **Where a box opens:** Turn off for a waiver or an agreement, and Switch off or Make a new link for a device, open
  under what was pressed. Add agreement and an other agreement open in place under Other agreements, and a signed
  form opens in place under its row. On a phone, Turn off comes from the bottom, and a device's New link and Switch
  off are in its ⋯, from the bottom. Open Leads with a change not saved asks Leave this page? in the middle, as on
  Payments.
- **Your account** is opened from your name at the foot of the menu, or from More on a phone. No menu line is lit.

## What a builder must know

- **Nobody has looked at these boards drawn.** The drawing terminal wrote them without opening
  them in a browser (the canvas tool's rule). Expect small faults of spacing. The builder's own
  walk at every screen shape (`rulings/2026-11-16-v1-a.md`) is the check, not the board.
- **Flat colour.** No gradient, no glow, no haze behind a page (Kd, 2026-11-18). `kit3.css`
  still holds `--o2`, `--glow` and `--wash`; nothing uses them and `console.css` does not take them.
- **The colours in `kit3.css` are a starting point.** The dark look's text and boxes are white
  at a strength (`rgba`). When they enter `console.css`, `consoleCss.test.js` measures each text
  colour on the ground it lands on, mixed, and a pair under 4.5 to 1 is fixed there.
- **Icons** are drawn by hand on the boards. The pages use the `lucide-react` icons they
  already use.
- **Figures and names are examples** (Iron House, a gym in Austin; Core Pilates, a studio). The
  page shows its own.
- **The words** on the boards are the new standard words. Each page's job changes its page's
  words to match and updates the tests that read the old ones (spec §17.11, the word list).
