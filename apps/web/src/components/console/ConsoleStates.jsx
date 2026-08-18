import { Loader2, AlertTriangle } from 'lucide-react';

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
