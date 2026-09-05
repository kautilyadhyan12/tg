import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConsoleSection } from './ConsoleStates';
import { orgService, errorCode, errorText } from '../../api/orgsApi';
import { CHEER_CHOICES } from '../../utils/cheerPresets';
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
// ── FOUR BUTTONS, AND WHY THAT IS STILL "ONE TAP" ────────────────────────────
// Kd ruled ONE TAP and NO FREE TEXT (:29961 ruling 4, agreeing with his own PACT
// design at :18128). Four emoji sitting on the row honour that literally: any
// one of them SENDS, with nothing to open first and nothing to type. A picker
// that opened and then sent would be the two-tap version of the same feature.
//
// **THE DEPARTURE IS FROM `CARD-gym-overview-people.md` §1's WORDING — *"one
// button"* — AND IT IS DECLARED RATHER THAN MADE QUIETLY (R0.3).** That
// sentence and §6.2.3's four approved lines cannot both be built: one button
// sends one preset, which would leave three of the four lines Kd approved
// unreachable in the product. He approved the four messages at this card's own
// gate, so the design that can send all four wins, and it is still one tap.
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

  const state = regularsState(overview);
  if (state === 'none') return null;

  const setRow = (userId, next) =>
    setTaps((held) => {
      const copy = new Map(held);
      copy.set(userId, next);
      return copy;
    });

  /** ONE TAP. The catch RETURNS, so the refresh below runs only on a send that
   *  actually landed — a failed re-read must never be reported as a failed
   *  cheer, which is the sentence this ordering exists to prevent. */
  const send = async (userId, preset) => {
    setRow(userId, { busy: true, outcome: null, error: null });
    try {
      await orgService.sendCheer(gymId, userId, preset);
    } catch (err) {
      // **A 409 `cheer_already_sent` IS A FACT, NOT A FAILED ATTEMPT.** The
      // server has just told us this member HAS been cheered inside the seven
      // days; this page was simply stale. Leaving four live buttons under that
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
        // The server's own words where it has any — the screen and the door
        // must not come to say different things about one refusal.
        error: errorText(err, "We couldn't send that just now. Please try again."),
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
              });
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
                      <div className="flex items-center gap-1">
                        {tap.busy ? (
                          <Loader2 className="w-4 h-4 animate-spin" style={{ color: ORANGE }} />
                        ) : (
                          CHEER_CHOICES.map((choice) => (
                            <button
                              key={choice.preset}
                              type="button"
                              onClick={() => send(regular.userId, choice.preset)}
                              /* The line itself is the label a mouse and a
                                 screen reader both get, so an owner knows what
                                 they are about to send before they send it —
                                 an emoji alone is not a promise anybody can
                                 read (`:32395`, an icon carrying meaning). */
                              title={choice.text}
                              aria-label={`Cheer ${regular.displayName}: ${choice.text}`}
                              className="rounded-lg px-2 py-1 text-base leading-none"
                              style={{ background: 'rgba(255,138,31,0.12)' }}
                            >
                              {choice.emoji}
                            </button>
                          ))
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
