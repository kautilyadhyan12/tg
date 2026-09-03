import { useId, useState } from 'react';
import { Loader2, AlertTriangle, ChevronDown } from 'lucide-react';

// The console's loading / failed states, in ONE place.
//
// Three of this project's review rounds found screens whose loading, failed and
// empty arms were indistinguishable — an unreadable page drawn as an empty one,
// which tells a user with a real history that they have none. On a gym console
// the same shape reads "nobody has joined your gym" at an owner whose Wi-Fi
// dropped. Sharing the components is what makes the three arms provably
// different: each carries its own text and a failure always carries a retry.

export function ConsoleLoading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-3 py-10" style={{ color: 'rgba(255,255,255,0.45)' }}>
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** A failure ALWAYS offers a way out (Part 3 §4: "every error state has a retry
 *  and never dead-ends"). `message` is the server's own sentence where there is
 *  one — see `errorText`. */
export function ConsoleFailed({ message, onRetry }) {
  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: '#ef4444' }} />
        <p className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {message}
        </p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-xl px-4 py-2 text-sm font-medium"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function ConsoleCard({ children, className = '' }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{ background: '#121110', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {children}
    </div>
  );
}

/** A SETTINGS SECTION THAT OPENS WHEN YOU TAP IT — Kd's call, 2026-08-26, made
 *  while looking at the screen: *"i think there should be like drop down when
 *  click on them there is a drop down other wise it will be a really long
 *  list"*.
 *
 *  **He is right and it gets worse, not better.** Settings carries two sections
 *  today; Part 3 §4.7 puts FIVE on it (Profile · Codes · Privacy · Notifications
 *  · Staff), and Staff alone grows a row per person with three controls each.
 *  The screen he was looking at is the shortest it will ever be.
 *
 *  **THE HEADING KEEPS SAYING SOMETHING WHILE CLOSED.** The title, the sentence
 *  under it and the `aside` (the staff count) all stay on screen — so a closed
 *  screen reads as a short menu rather than a row of mystery boxes, and the one
 *  number an owner glances at is still there without opening anything.
 *
 *  **CLOSED MEANS UNMOUNTED, NOT HIDDEN WITH CSS, AND THAT IS DELIBERATE.**
 *  Hiding it would have left every existing test passing against content no
 *  person can see — a suite that claims a user sees something while the screen
 *  does not show it is the exact class this project keeps recording. The tests
 *  changed instead, each one now opening the section the way a person does
 *  (:6008's precedent for a control gaining a tap).
 *
 *  **`forceOpen` IS THE ANTI-SILENCE RULE and it is the reason this prop
 *  exists.** A panel that fetches on mount can fail while closed — and a closed
 *  row over an error card says NOTHING, which is worse than the error. :12660
 *  is the citation: no reviewer, test or mutant flags an ABSENT sentence, a
 *  person does. A section holding something the owner needs to see opens itself
 *  and cannot be tapped shut over it. */
/** **`defaultOpen` STARTS OPEN. `forceOpen` PINS OPEN. THEY ARE NOT THE SAME
 *  PROP AND CONFLATING THEM SHIPPED A DEAD CONTROL** (Kd, 2026-09-03: *"the
 *  drop down is not working i clcik here bu it does not open close"*).
 *
 *  `isOpen` below is `open || forceOpen`, so a section rendered with
 *  `forceOpen` permanently true can NEVER be closed — the click flips `open`
 *  and the `||` puts it straight back. That is exactly what `forceOpen` is FOR
 *  (the anti-silence rule: a section holding an error the owner must see cannot
 *  be dismissed over it), and it is the wrong tool for *"this list should be
 *  open when you arrive"*. Two attendance lists shipped with it, and the
 *  comments beside them claimed they "arrive open and still fold" — **false,
 *  and Kd found it by clicking.**
 *
 *  `defaultOpen` seeds the state instead of overriding it, so the heading
 *  toggles like any other. */
export function ConsoleSection({
  title,
  summary,
  aside,
  children,
  forceOpen = false,
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const isOpen = open || forceOpen;

  // ONCE FORCED OPEN, IT STAYS OPEN — T3 round 1, Low-1, and the one line that
  // makes `forceOpen` survive the thing it exists for. Pressing **Try again**
  // clears the error, which cleared `forceOpen`, which SHUT THE SECTION UNDER
  // THE CLICK — spinner and all, since the loading arm lives in the body that
  // had just been unmounted. An owner saw the whole thing vanish and read it as
  // a broken button.
  //
  // Latching into `open` fixes it without giving up the guarantee: while the
  // error is live `forceOpen` still holds it open against a tap (so it cannot be
  // dismissed over something the owner has to see), and afterwards the section
  // is simply open, closable like any other.
  if (forceOpen && !open) setOpen(true);

  return (
    <ConsoleCard>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={isOpen}
        /* T3 round 1, Low-3. Closed means UNMOUNTED here, so pointing at the
           body's id while it does not exist is a dangling reference on every
           shut row — the attribute promises a screen reader an element it can
           move to and there is none. */
        aria-controls={isOpen ? bodyId : undefined}
        className="w-full text-left flex items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <div
            className="text-xs uppercase tracking-wider"
            style={{ color: 'rgba(255,255,255,0.35)' }}
          >
            {title}
          </div>
          {summary ? (
            <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {summary}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {aside ? (
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
              {aside}
            </span>
          ) : null}
          <ChevronDown
            className="w-4 h-4 transition-transform"
            style={{
              color: 'rgba(255,255,255,0.45)',
              transform: isOpen ? 'rotate(180deg)' : 'none',
            }}
          />
        </div>
      </button>

      {isOpen ? (
        <div id={bodyId} className="mt-4">
          {children}
        </div>
      ) : null}
    </ConsoleCard>
  );
}
