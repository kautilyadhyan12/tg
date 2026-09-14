// ── The disclaimer taps ─────────────────────────────────────────────────────
// RULINGS 2026-09-07: one explicit tap at sign-up, at the health step and on
// the plan screen, each stored with the time, the build and the words it was
// shown beside. One component, so the three ask for the tap the same way;
// `hint` names what the tick holds back on its own screen, and `large` sets the
// words at reading size where the note is the whole screen (the sign-up note)
// rather than a card beside the questions.
import { Check } from 'lucide-react';

export default function DisclaimerTick({ wording, tap, hint, large = false }) {
  return (
    <div className="card-glass space-y-3">
      <p
        className={large ? 'text-sm leading-relaxed' : 'text-xs'}
        style={{ color: large ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.70)' }}
      >
        {wording}
      </p>
      <button
        type="button"
        role="checkbox"
        aria-checked={tap.agreed}
        disabled={tap.agreed || tap.agreeing}
        onClick={tap.agree}
        className="flex items-center gap-3 text-left w-full disabled:cursor-default"
      >
        <span
          aria-hidden="true"
          className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 border-2 transition-all
                     ${tap.agreed ? 'bg-primary-500 border-primary-500' : 'border-white/25'}`}
        >
          {tap.agreed && <Check className="w-3 h-3 text-white" />}
        </span>
        <span className={`text-sm ${tap.agreed ? 'text-white' : 'text-gray-300'}`}>I have read and understood this</span>
      </button>
      {!tap.agreed && (
        <p className="text-2xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
