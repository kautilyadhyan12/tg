import { X } from 'lucide-react';

// The box that opens over a gym's page in the member app, and the round mark beside a name.

const ORANGE = '#FF8A1F';
const MUTED = 'rgba(255,255,255,0.45)';

export function Initials({ text, greyed }) {
  return (
    <span
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
      style={{ background: greyed ? 'rgba(255,255,255,0.06)' : 'rgba(255,138,31,0.15)', color: greyed ? MUTED : ORANGE }}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

export default function Sheet({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl p-5"
        style={{ background: '#161412', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-base font-bold text-white">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg" style={{ color: MUTED }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
