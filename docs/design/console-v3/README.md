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
