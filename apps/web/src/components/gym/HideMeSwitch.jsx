// HIDE ME (spec Part 3 §15.5): the person's own switch for every gym's board, on the board
// and in Settings → Gym. Switching it off is also an under-18's Show me.
const MUTED = 'rgba(255,255,255,0.45)';

export default function HideMeSwitch({ hidden, under18, onChange, busy, divided = true }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${divided ? 'pt-3 mt-1' : ''}`} style={divided ? { borderTop: '1px solid rgba(255,255,255,0.06)' } : undefined}>
      <div>
        <p className="text-sm font-semibold text-white">Hide me on leaderboards</p>
        <p className="text-xs" style={{ color: MUTED }}>
          {under18 && hidden
            ? "You're under 18, so you're hidden until you switch this off."
            : 'Other members won’t see you on any gym’s board. You still see the board.'}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={hidden}
        aria-label="Hide me on leaderboards"
        disabled={busy}
        onClick={() => onChange(!hidden)}
        className="w-12 h-6 rounded-full relative flex-shrink-0 transition-all"
        style={{ background: hidden ? 'linear-gradient(135deg, #FF8A1F, #FFB347)' : 'rgba(255,255,255,0.08)', opacity: busy ? 0.6 : 1 }}
      >
        <span
          className="absolute top-1 w-4 h-4 rounded-full bg-white transition-all"
          style={{ left: hidden ? 28 : 4, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }}
        />
      </button>
    </div>
  );
}
