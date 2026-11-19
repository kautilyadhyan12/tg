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
