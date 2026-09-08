import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { codeState, orgWords } from '../../pages/console/consoleView';
import { ConsoleCard } from './ConsoleStates';

// The join code, big enough to read across a front desk — Part 3 §4.0 step 4
// ("show code big") and §4.3's invite sheet, minus the QR and the poster PDF,
// neither of which has a server side yet.
//
// THE STATE LINE IS NOT DECORATION. A paused, expired or used-up code is
// refused by the join path, so printing one under "share this with your
// members" would be the app promising something it will not honour. When a code
// is not live the screen says which of the three it is, and the invitation
// sentence is withheld rather than reworded.

// SINCE THE MANAGEMENT PANEL LANDED, THIS CARD IS ONE OF TWO PLACES THE CODE
// APPEARS, and the duplication is deliberate: this is "the code to hand out"
// (§4.0 step 4's "show code big", readable across a front desk, with Copy),
// while the panel below is "every code and what you can do to it". A test that
// asks whether a code is on screen at all can no longer tell the two apart, so
// this card carries a `data-testid` and the hero assertions are scoped to it —
// weakening them to `getAllByText` would have quietly dropped the claim that
// this card shows the first LIVE code rather than merely the oldest.

/** `orgType` picks the invitation's words: a trainer hands the code to CLIENTS
 *  (Kd 2026-09-07), a gym to members. Absent, the gym's words. */
export default function JoinCodeCard({ code, orgType }) {
  const [copied, setCopied] = useState(false);
  const state = codeState(code);
  const words = orgWords(orgType);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission (or an insecure context): the code is on screen
      // to be read and typed, so this is a missing convenience and not a
      // failure worth interrupting anybody with.
    }
  };

  return (
    <ConsoleCard>
      <div data-testid="join-code-card" className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-wider" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Join code · {code.label}
          </div>
          <div
            className="font-mono font-bold tracking-[0.3em] mt-2"
            style={{ fontSize: '2rem', color: state.live ? '#FF8A1F' : 'rgba(255,255,255,0.45)' }}
          >
            {code.code}
          </div>
        </div>

        <button
          type="button"
          onClick={copy}
          className="rounded-xl px-4 py-2 text-sm font-medium flex items-center gap-2"
          style={{ background: 'rgba(255,138,31,0.15)', color: '#FF8A1F' }}
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {state.live ? (
        <p className="text-sm mt-4" style={{ color: 'rgba(255,255,255,0.55)' }}>
          Give this code to your {words.people}. They enter it in the app to join your {words.it}.
        </p>
      ) : (
        <p className="text-sm mt-4" style={{ color: '#ef4444' }}>
          {state.reason === 'paused'
            ? 'This code is paused — nobody can join with it right now.'
            : state.reason === 'expired'
              ? 'This code has expired — nobody can join with it.'
              : 'This code has been used the maximum number of times — nobody else can join with it.'}
        </p>
      )}
    </ConsoleCard>
  );
}
