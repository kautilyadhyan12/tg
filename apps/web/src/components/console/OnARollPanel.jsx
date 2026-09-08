import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConsoleSection } from './ConsoleStates';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { CHEER_CHOICES, cheerLine } from '../../utils/cheerPresets';
import {
  cheerState,
  emptyRegularsSentence,
  previewRegulars,
  regularsState,
  streakText,
} from '../../pages/console/onARollView';

// THE MEMBERS WHO KEEP TURNING UP, AND THE ONE TAP THAT SAYS SO — Kd's :29961
// ruling 4, his own addition at the overview-numbers gate: *"if some mebers
// comes to gym reguraly and maintains a continous streak the gym can send
// inpiring things like emojy short message etc"*.
//
// MARKUP ONLY. Every sentence, every "is this drawn at all" question and the
// button's four states live in `onARollView.js`, which is tested without a
// browser. The split is `OverviewNumbers` / `overviewView` one pane up.
//
// **IT RIDES ON THE OVERVIEW PAYLOAD AND TAKES NO READ OF ITS OWN.**
// `Overview.jsx` already issues four reads in one `Promise.allSettled` and
// :30399's own trigger warns before adding a fourth; `onARoll` was put on
// `GET /v1/orgs/:gymId/overview` for exactly that reason, and this component
// receives it as a prop.
//
// ── FOUR EMOJI, AND THE CONFIRM STEP KD ADDED AT THE SCREEN ──────────────────
// Kd ruled ONE TAP and NO FREE TEXT (:29961 ruling 4, agreeing with his own PACT
// design at :18128), and the card shipped with four emoji that each SENT on
// sight. **He looked at it and reversed the "on sight" half, 2026-09-05**:
// *"whenever a emojy is click a small window just beside the emojy should be
// shown and in the window show the emojy and the writing and a small send
// button not writing send symbol … it is not like a big pop up"*.
//
// **THE RULING HE DID NOT CHANGE IS THE ONE THAT SHAPES THIS: still four
// choices, still no typing.** What the panel adds is the moment between the
// choice and the send — and it is not politeness. **The cheer is CAPPED and
// IRREVERSIBLE**: one stray finger spends that member's whole day (:35762; it
// was a seven-day window when this was written),
// tells the wrong person the gym noticed them, and there is no undo anywhere in
// the product. `:34809` §2 is the recorded shape of that damage (C220, ALIVE on
// its first run, sending to the wrong member with no error on screen).
//
// **IT REPLACES NOTHING — IT MAKES THE HOVER REAL.** The `title` on each emoji
// already showed an owner the sentence before they committed to it, and **a
// hover does not exist on a phone**, where `:17765` puts every console feature.
// The panel is that same promise, reachable by a finger.
//
// **THE DEPARTURE IS FROM `CARD-gym-overview-people.md` §1's WORDING — *"one
// button"* — AND IT IS DECLARED RATHER THAN MADE QUIETLY (R0.3).** That
// sentence and §6.2.3's four approved lines cannot both be built: one button
// sends one preset, which would leave three of the four lines Kd approved
// unreachable in the product. He approved the four messages at this card's own
// gate, so the design that can send all four wins.
//
// ── FOUR WAYS OUT, PLUS THE SWAP — AND KD NAMED NONE OF THEM ─────────────────
// **A CONTROL WHOSE CANCEL IS UNTESTED IS `:14840`'s RECORDED DEFECT**, so the
// dismiss paths are a build requirement rather than polish, and its own
// `OWED.md` line says so. FOUR paths CLOSE the panel and each has its own case:
// **Send** · **Escape** · a click anywhere else · **the same emoji again**.
// **The SWAP is not a way out, and this heading said FIVE until T3 round 2** —
// a DIFFERENT emoji replaces the panel rather than needing a dismiss first, so
// the cost of pressing 🔥 when you meant 💪 is one more tap and never a sent
// cheer. It is the path a real mis-tap uses, which is why it is named here and
// not why it is counted.
//
// **ONE PANEL EXISTS AT A TIME, ACROSS THE WHOLE LIST**, which is why `pending`
// is a single value here and not a second per-row `Map`. `:34992`'s C/H was
// per-row state in this component that nothing ever cleared; a lone value that
// every path sets back to `null` cannot accumulate that way.
//
// ── WHAT THIS PANEL MUST NEVER GROW ──────────────────────────────────────────
// **NO TOTAL.** `:27992` §3 is Kd's ruling that counts come from the server, and
// the overview payload deliberately carries nothing a screen could add up into
// "your gym has N regulars" — that figure would be this list's own length
// wearing a total's clothes. So there is no "and 12 more".
//
// **NO CHEER CONTROL WHEREVER THE MEMBERS ROSTER IS DRAWN**, which is a build
// constraint the server half's T3 round 2 wrote for this file (`:34666` §4).
// This panel and the write door agree on their population — both exclude
// complimentary members — and the ROSTER does not: it draws a comped member with
// an orange *Complimentary* badge (`:15093`). A Cheer button there would answer
// *"That person isn't a member of this gym"* about somebody the owner is looking
// at, badge and all. The one-sentence 404 is `:34240` §6's deliberate choice, so
// a control on the roster needs that refusal RE-RULED first — it is not an
// oversight to route around. `console.render.test.jsx` asserts the absence.

const ORANGE = '#FF8A1F';
const INK = 'rgba(255,255,255,0.92)';
const MUTED = 'rgba(255,255,255,0.45)';
const HAIRLINE = 'rgba(255,255,255,0.07)';

/** No tap has been made on this row yet. A module-level constant so every
 *  untouched row shares one object rather than allocating per render.
 *
 *  `outcome` is null, `'sent'` or `'already'` — see `cheerState`, which turns
 *  the last two into two DIFFERENT true sentences. */
const IDLE = { busy: false, outcome: null, error: null };

export default function OnARollPanel({
  gymId,
  orgType,
  overview,
  privileges,
  readOnly = false,
  onCheered = () => {},
}) {
  // A `Map` AND NOT AN OBJECT, because the key is a uuid off the wire. An
  // ordinary object keyed by a value somebody else chose answers `constructor`
  // and `toString` from its prototype, and a row whose state came back as a
  // function is a defect nobody would look for.
  const [taps, setTaps] = useState(() => new Map());

  /** WHICH EMOJI IS WAITING FOR ITS **Send**, or `null` — `{ userId, preset }`.
   *
   *  **ONE VALUE FOR THE WHOLE LIST**, so opening a panel on Asha closes the one
   *  on Priya without a line of code saying so. A per-row `Map` would be the
   *  shape `:34992`'s Critical/High came in: state this component holds per row
   *  and never clears, which went on claiming a tap had just happened for the
   *  whole life of the tab. */
  const [pending, setPending] = useState(null);

  /** THE OPEN PANEL'S OWN BOX, and the click-away test is `contains` against it.
   *
   *  It is assigned only to the row that HAS the panel, and it wraps the emoji
   *  as well as the panel — so a click on this row's own buttons is INSIDE and
   *  does not race the close against the open. A click on any other row's emoji
   *  is outside: `mousedown` closes, then that button's `click` opens its own,
   *  which is the swap arriving for free rather than as a second rule. */
  const openBoxRef = useRef(null);

  useEffect(() => {
    if (pending === null) return undefined;
    // **ESCAPE AND CLICK-AWAY ARE BOUND ONLY WHILE SOMETHING IS OPEN.** A
    // listener that outlives its condition is `:7298` in the event layer, and
    // an Escape handler that runs all the time would swallow the key from
    // whatever else on this console wants it later.
    const onKey = (event) => {
      if (event.key === 'Escape') setPending(null);
    };
    // **`contains` IS WHAT LETS **Send** BE PRESSED AT ALL, AND THAT IS NOT
    // OBVIOUS FROM READING IT.** A real press is `mousedown` → `mouseup` →
    // `click`. Without this test the `mousedown` half closes the panel, React
    // flushes it as a discrete update, and the button is GONE before the click
    // lands — so no cheer could ever be sent, and the same-row swap would
    // become a dismiss. **T3 round 1's Critical/High: every case in the render
    // suite used `fireEvent.click`, which dispatches NO `mousedown`, so all 25
    // stayed green with this line deleted.** `sends when Send is pressed the
    // way a browser presses it` and **C227** are what hold it now.
    //
    // **A DETACHED REF CLOSES RATHER THAN NO-OPS** (`box === null`, not
    // `box !== null &&`). **THIS IS DEFENCE IN DEPTH, NOT A LIVE FIX, AND THE
    // COMMENT USED TO CLAIM OTHERWISE** — T3 round 2 went looking for the
    // re-armed **Send** it described and could not reach it: this panel is
    // REMOUNTED rather than re-rendered whenever the gym changes
    // (`OverviewNumbers.jsx`'s `key={gymId}`, inside `ConsoleLayout`'s own
    // per-screen key), and the only refresh that keeps it mounted runs through
    // `confirm`, which nulls `pending` first. So a detached ref with `pending`
    // still set has no path back to a drawn row TODAY. What it guards is the
    // SHAPE `:34992`'s Critical/High arrived in — state this component holds
    // and nothing clears — against a future mount site that does not key.
    // **`C229` is what holds the ref's SCOPE**, which is the half a refactor
    // moves.
    const onDown = (event) => {
      const box = openBoxRef.current;
      if (box === null || !box.contains(event.target)) setPending(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pending]);

  const state = regularsState(overview);
  if (state === 'none') return null;

  const setRow = (userId, next) =>
    setTaps((held) => {
      const copy = new Map(held);
      copy.set(userId, next);
      return copy;
    });

  /** AN EMOJI WAS PRESSED. **THIS SENDS NOTHING** — it opens the panel that
   *  does, or closes it again if the same emoji was pressed twice.
   *
   *  **BOTH FIELDS ARE COMPARED, NOT JUST THE MEMBER.** Pressing 🔥 while 💪 is
   *  open must SWAP the panel and not close it: the swap is what makes a mis-tap
   *  cost one tap instead of a sent cheer, and a `userId`-only test would turn
   *  the commonest correction into a dismiss. */
  const choose = (userId, preset) =>
    setPending((held) =>
      held !== null && held.userId === userId && held.preset === preset
        ? null
        : { userId, preset });

  /** THE SEND ITSELF. The catch RETURNS, so the refresh below runs only on a send that
   *  actually landed — a failed re-read must never be reported as a failed
   *  cheer, which is the sentence this ordering exists to prevent. */
  const send = async (userId, preset) => {
    setRow(userId, { busy: true, outcome: null, error: null });
    try {
      await orgService.sendCheer(gymId, userId, preset);
    } catch (err) {
      // **A 409 `cheer_already_sent` IS A FACT, NOT A FAILED ATTEMPT.** The
      // server has just told us this member HAS been cheered TODAY (:35762);
      // this page was simply stale. Leaving four live buttons under that
      // sentence would be a control the console knows will be refused again —
      // :12518 C/H-2's shape — so the row takes the state the server described.
      //
      // **`'already'` AND NOT `'sent'`, WHICH IS THE WHOLE REASON THERE ARE TWO
      // OUTCOMES.** The cap is per GYM, so the cheer may have been a
      // colleague's, days ago. `:34443` §4 is what one wrong pronoun cost here
      // already.
      const already = errorCode(err) === 'cheer_already_sent';
      setRow(userId, {
        busy: false,
        outcome: already ? 'already' : null,
        // **AND A 409 IS DRAWN ONCE.** T3 round 1 L-3: this used to set the
        // error text as well, so the row said the fact twice — *"Cheered
        // today."* in grey beside *"This member has already been
        // cheered today."* in red. Both sentences were true, so
        // it stayed Low, but the red one contradicts the comment three lines
        // above it: the failure channel is what this arm exists NOT to use.
        //
        // The outcome carries the whole of what the server said, in
        // `cheerState`'s words, and nothing is lost — a genuine failure still
        // gets the server's own sentence, which is the case below.
        error: already ? null : errorText(err, "We couldn't send that just now. Please try again."),
      });
      // The refreshed payload carries the real `cheerableAt`, which turns the
      // sentence above into one that names the day. Nothing else about a
      // genuine failure is worth a re-read.
      if (already) await onCheered();
      return;
    }
    setRow(userId, { busy: false, outcome: 'sent', error: null });
    // THE SERVER OWNS `cheerableAt` AND THIS IS HOW THE SCREEN GETS IT. The
    // local `sent` flag above covers the seconds in between so a second tap
    // cannot go out; this is what makes the button's sentence survive a reload
    // and agree with a second browser looking at the same gym.
    await onCheered();
  };

  /** **Send** WAS PRESSED. The panel closes FIRST, so the row draws its spinner
   *  rather than leaving a live Send button sitting over an in-flight request —
   *  a second press there would be a second cheer, and the cap makes the second
   *  one a 409 the owner never asked for. */
  const confirm = async (userId, preset) => {
    setPending(null); // the panel closes BEFORE the send goes out, C228
    await send(userId, preset);
  };

  return (
    <div className="mt-5">
      <ConsoleSection title="On a roll" defaultOpen>
        {state === 'empty' ? (
          <p className="text-sm" style={{ color: MUTED }}>
            {emptyRegularsSentence()}
          </p>
        ) : (
          <div className="flex flex-col">
            {previewRegulars(overview.onARoll).map((regular) => {
              const tap = taps.get(regular.userId) ?? IDLE;
              const button = cheerState(regular, {
                privileges,
                readOnly,
                outcome: tap.outcome,
                orgType,
              });
              /** THIS ROW'S OPEN PANEL, or `null`. **The member is compared as
               *  well as the preset**, so the one open panel draws on the row it
               *  was opened from — a `preset`-only test would put an identical
               *  panel on every member sharing that emoji, which is `:34809`
               *  §2's wrong-row defect wearing a different hat.
               *
               *  `cheerLine` is the same lookup the member's own card uses, so
               *  the words an owner is shown before sending and the words that
               *  arrive cannot drift apart. It returns `null` for a code this
               *  bundle has no sentence for, and a panel with no words is drawn
               *  as no panel rather than as an empty box. */
              const chosen =
                pending !== null && pending.userId === regular.userId
                  ? cheerLine(pending.preset)
                  : null;
              return (
                <div
                  key={regular.userId}
                  className="flex items-start justify-between gap-3 py-2.5"
                  style={{ borderTop: `1px solid ${HAIRLINE}` }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: INK }}>
                      {regular.displayName}
                    </div>
                    {/* BOTH FIGURES AND THE VISITS, IN ONE SENTENCE BUILT ONE
                        PLACE. Kd ruled both units — *"both weeks and days
                        run"* — and `streakText` is where the rule that hides a
                        one-day streak lives, so this row cannot arrange two
                        true numbers into a false one on its own. */}
                    <div className="text-xs mt-0.5" style={{ color: MUTED }}>
                      {streakText(regular)}
                    </div>
                    {tap.error !== null ? (
                      <div className="text-xs mt-1" style={{ color: '#ef4444' }}>
                        {tap.error}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex-shrink-0 text-right">
                    {button.disabled ? (
                      /* SAID, NEVER SILENTLY INERT (`:24141`): every dead
                         control on this console carries the sentence for why.
                         The three reasons are different facts — a role that
                         cannot, a gym with no plan, and a cheer already sent —
                         and `cheerState` asks them in the SERVER's order. */
                      <div className="text-xs max-w-[13rem]" style={{ color: MUTED }}>
                        {button.text}
                      </div>
                    ) : (
                      /* `relative` IS LOAD-BEARING: the panel below is
                         positioned against this box, so it floats over the row
                         beneath instead of pushing every other member down the
                         screen each time somebody looks at a line. The ref is
                         attached ONLY on the row holding the open panel — see
                         `openBoxRef`, where the click-away rule is written. */
                      <div className="relative" ref={chosen === null ? null : openBoxRef}>
                        <div className="flex items-center justify-end gap-1">
                          {tap.busy ? (
                            <Loader2 className="w-4 h-4 animate-spin" style={{ color: ORANGE }} />
                          ) : (
                            CHEER_CHOICES.map((choice) => (
                              <button
                                key={choice.preset}
                                type="button"
                                /* **THIS OPENS; IT DOES NOT SEND.** Kd's
                                   2026-09-05 change — see the header. */
                                onClick={() => choose(regular.userId, choice.preset)}
                                /* **`aria-expanded` ALONE, AND DELIBERATELY NO
                                   `aria-haspopup`** (T3 round 2). The house
                                   pattern is a PAIR: `Select.jsx` announces
                                   `haspopup="listbox"` on its trigger AND
                                   carries `role="listbox"` on the list it
                                   opens. Only the trigger half was copied
                                   here, so `haspopup="dialog"` promised a
                                   dialog this panel deliberately is not — no
                                   backdrop, no focus trap, `:23578`'s
                                   territory not entered — and announced to a
                                   screen reader something the markup never
                                   delivers. This is a DISCLOSURE, and
                                   `aria-expanded` is the whole of what it owes.
                                   Adding `haspopup` back means adding the role
                                   and the dialog behaviour with it. */
                                aria-expanded={chosen?.preset === choice.preset}
                                /* The line itself is the label a mouse and a
                                   screen reader both get, so an owner knows what
                                   they are about to send before they send it —
                                   an emoji alone is not a promise anybody can
                                   read (`:32395`, an icon carrying meaning). */
                                title={choice.text}
                                aria-label={`Cheer ${regular.displayName}: ${choice.text}`}
                                className="rounded-lg px-2 py-1 text-base leading-none"
                                style={{
                                  background:
                                    chosen?.preset === choice.preset
                                      ? 'rgba(255,138,31,0.32)'
                                      : 'rgba(255,138,31,0.12)',
                                }}
                              >
                                {choice.emoji}
                              </button>
                            ))
                          )}
                        </div>

                        {/* THE PANEL KD ASKED FOR: the emoji, the words it will
                            send, and a **Send** BUTTON — his own three items, in
                            his own order. It sits BESIDE the row it belongs to
                            and covers nothing else: *"it is not like a big pop
                            up"*, so there is no backdrop, no dimming and no
                            focus trap (`:23578`'s territory, deliberately not
                            entered). */}
                        {chosen === null ? null : (
                          <div
                            className="absolute right-0 top-full z-10 mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left"
                            style={{
                              background: '#1B1917',
                              border: '1px solid rgba(255,255,255,0.12)',
                              boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
                            }}
                          >
                            <span className="text-base leading-none">{chosen.emoji}</span>
                            <span className="text-xs" style={{ color: INK }}>
                              {chosen.text}
                            </span>
                            <button
                              type="button"
                              onClick={() => confirm(regular.userId, chosen.preset)}
                              /* **THE MEMBER AND THE LINE ARE BOTH IN THE
                                 ACCESSIBLE NAME.** Five rows can each have a
                                 button reading "Send", and a test — or a screen
                                 reader — that could not tell them apart is the
                                 one-row fixture that left C220 alive
                                 (`:34809` §2), arriving through the label. */
                              aria-label={`Send to ${regular.displayName}: ${chosen.text}`}
                              className="rounded-md px-2.5 py-1 text-xs font-semibold leading-none"
                              style={{ background: ORANGE, color: '#0A0908' }}
                            >
                              Send
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ConsoleSection>
    </div>
  );
}
