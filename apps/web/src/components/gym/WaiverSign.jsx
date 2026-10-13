import { useId } from 'react';
import { WAIVER_AGREE_LABEL, WAIVER_NAME_MAX_CHARS } from '@app/shared';

// A gym's waiver as a person reads and signs it (ROADMAP 3e-i): the gym's own words in
// full, a box for the person's name, and a tick. The Join screen and My Gyms both draw
// this, and each keeps the name and the tick it is given.

export default function WaiverSign({ gymName, waiver, name, onName, agreed, onAgreed, disabled = false }) {
  const nameId = useId();
  const agreeId = useId();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold m-0" style={{ color: '#fff' }}>
        {gymName}&apos;s waiver
      </p>
      <div
        role="region"
        aria-label={`${gymName}'s waiver`}
        tabIndex={0}
        className="rounded-xl px-4 py-3 text-sm leading-relaxed max-h-72 overflow-y-auto"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.85)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
      >
        {waiver.text}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="text-sm font-medium" style={{ color: 'rgba(255,255,255,0.85)' }}>
          Your full name
        </label>
        <input
          id={nameId}
          type="text"
          autoComplete="name"
          value={name}
          onChange={(event) => onName(event.target.value)}
          disabled={disabled}
          maxLength={WAIVER_NAME_MAX_CHARS}
          className="rounded-xl px-4 py-3 text-sm"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', minHeight: 44 }}
        />
      </div>
      <label htmlFor={agreeId} className="flex items-start gap-3 py-2 cursor-pointer" style={{ minHeight: 44 }}>
        <input
          id={agreeId}
          type="checkbox"
          checked={agreed}
          onChange={(event) => onAgreed(event.target.checked)}
          disabled={disabled}
          className="mt-0.5 w-5 h-5 flex-shrink-0"
          style={{ accentColor: '#FF8A1F' }}
        />
        <span className="text-sm" style={{ color: 'rgba(255,255,255,0.85)' }}>
          {WAIVER_AGREE_LABEL}
        </span>
      </label>
    </div>
  );
}
