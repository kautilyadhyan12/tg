// The app's ONE health question (ROADMAP Stage 1 item 4b-i; RULINGS 2026-09-09
// and Kd's decision C, 2026-09-10). Screen 8 of the wizard asks it, and
// Settings asks the same thing so the answer can be changed later — ONE
// component, so the two can never ask it differently or explain it differently.
// The words themselves live in `@app/shared`, beside the contract.
//
// Nothing specific is ever asked or stored: the answer is a yes or a no, and on
// a yes, which of the two "Check first" answers. A yes stops the calorie cut
// whichever of the two it is — the app cannot know what the yes is — and "not
// yet" turns Safe mode on as well.
//
// A YES IS NOT SAVED UNTIL "CHECK FIRST" IS ANSWERED: the contract refuses a
// yes with no choice, so tapping Yes opens the pair and stores nothing yet.
// Until one is picked the screen still holds the answer the server has, and
// says the question is not finished.
import { useState } from 'react';
import { Check, HeartPulse, ShieldCheck } from 'lucide-react';
import { CHECK_FIRST_HEADING, CHECK_FIRST_OPTIONS, HEALTH_QUESTION, HEALTH_QUESTION_NOTE } from '@app/shared';

const YES_NO = [
  { value: false, label: 'No' },
  { value: true, label: 'Yes' },
];

const CHECK_FIRST = ['cleared', 'not_yet'];

/** `screening` is the server's own shape (null while it loads); `onAnswer` is
 *  given the whole body to store. `busy` disables every tap while one is on
 *  its way, so two answers can never be in flight at once. */
export default function HealthQuestion({ screening, onAnswer, busy = false }) {
  // The yes the person has tapped but not yet finished. Null means "whatever
  // the server holds" — so a failed save falls back to the stored answer
  // rather than to a tap that never landed.
  const [pendingYes, setPendingYes] = useState(null);

  const stored = screening?.answered === true ? screening.hasCondition : null;
  const yes = pendingYes ?? stored;
  // Only a STORED yes has a "Check first" answer to show; a yes just tapped
  // over a no has none yet, which is exactly why nothing is saved for it.
  const checkFirst = stored === true ? screening.checkFirst : null;

  const tapNo = () => {
    setPendingYes(null);
    if (stored !== false) onAnswer({ hasCondition: false });
  };

  const tapYes = () => {
    // Opens the pair. A person already on a yes keeps the choice they made.
    setPendingYes(true);
  };

  const tapCheckFirst = (value) => {
    if (stored === true && screening.checkFirst === value) {
      setPendingYes(null);
      return;
    }
    onAnswer({ hasCondition: true, checkFirst: value });
    setPendingYes(null);
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-white mb-2">{HEALTH_QUESTION}</p>
        <p className="text-gray-400 text-xs mb-3">{HEALTH_QUESTION_NOTE}</p>
        <div role="group" aria-label="Health question" className="grid grid-cols-2 gap-3">
          {YES_NO.map((option) => {
            const selected = yes === option.value;
            return (
              <button
                key={`health-${String(option.value)}`}
                type="button"
                aria-pressed={selected}
                disabled={busy}
                onClick={option.value ? tapYes : tapNo}
                className={`flex items-center justify-center gap-2 py-4 rounded-2xl border-2 font-semibold text-sm transition-all disabled:opacity-60
                           ${selected ? 'border-primary-500 bg-primary-500/10 text-white' : 'border-white/10 bg-dark-100 text-gray-300 hover:border-white/20'}`}
              >
                <HeartPulse className="w-4 h-4" strokeWidth={1.75} aria-hidden="true" />
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {yes === true && (
        <div>
          <p className="text-sm font-semibold text-white mb-3">{CHECK_FIRST_HEADING}</p>
          <div role="group" aria-label={CHECK_FIRST_HEADING} className="space-y-3">
            {CHECK_FIRST.map((value) => {
              const option = CHECK_FIRST_OPTIONS[value];
              const selected = checkFirst === value;
              return (
                <button
                  key={`check-first-${value}`}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => tapCheckFirst(value)}
                  className={`flex items-start gap-3 p-4 rounded-2xl border-2 transition-all text-left w-full disabled:opacity-60
                             ${selected ? 'border-primary-500 bg-primary-500/10' : 'border-white/10 bg-dark-100 hover:border-white/20'}`}
                >
                  <span
                    aria-hidden="true"
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={
                      selected
                        ? { background: 'linear-gradient(135deg, #FF8A1F, #FFB347)' }
                        : { background: 'rgba(255,138,31,0.08)', border: '1px solid rgba(255,138,31,0.25)' }
                    }
                  >
                    <ShieldCheck className="w-4 h-4" strokeWidth={1.75} style={{ color: selected ? '#FFFFFF' : '#FFB347' }} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block font-medium text-sm ${selected ? 'text-white' : 'text-gray-300'}`}>{option.label}</span>
                    <span className="block text-gray-500 text-xs mt-1">{option.detail}</span>
                  </span>
                  {selected && (
                    <span className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-white" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {stored !== true && (
            <p role="status" className="text-2xs mt-3" style={{ color: 'rgba(255,255,255,0.55)' }}>
              Pick one of the two to save your answer.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
