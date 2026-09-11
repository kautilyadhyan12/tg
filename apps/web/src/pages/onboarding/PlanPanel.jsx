// The live plan number, on every screen from the moment the server has one
// (RULINGS 2026-09-07: every answer changes the number on screen). Until then
// the box is not drawn at all (Kd, 2026-09-10): the screens themselves ask the
// questions, and no number is ever built from a default (RULINGS 2026-07-15).
// Under the number, "How is this worked out?" opens the server's own steps.
import { useState } from 'react';
import { ChevronDown, Flame } from 'lucide-react';
import {
  METRIC_NOTE,
  PLAN_NOTE,
  WORKING_NOTE,
  changeLine,
  flagLines,
  kcalText,
  targetLine,
  workingSteps,
} from './onboardingModel';

export default function PlanPanel({ plan, direction, units }) {
  const [open, setOpen] = useState(false);
  if (plan === null) return null;
  const target = targetLine(plan, units);
  const flags = flagLines(plan, direction, units);
  return (
    <section aria-label="Your plan" className="card-glass mb-6">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#FF8A1F' }}>
        <Flame className="w-3.5 h-3.5" />
        Your daily number
      </p>
      <p className="mt-1">
        <span className="text-3xl font-bold tabular-nums text-white">{kcalText(plan.targetKcal)}</span>
        <span className="text-sm ml-1.5">kcal a day</span>
      </p>
      <p className="text-xs mt-1">{changeLine(plan)}.</p>
      {target && <p className="text-sm mt-2 text-white">{target}</p>}
      <p className="text-xs mt-2">
        Protein {plan.proteinG} g · Carbs {plan.carbsG} g · Fat {plan.fatG} g
      </p>
      {flags.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {flags.map((line, i) => (
            <li key={`flag-${i}`} className="text-xs" style={{ color: '#FFB347' }}>
              {line}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="plan-working"
        onClick={() => setOpen((o) => !o)}
        className="mt-3 flex items-center gap-1 text-xs font-semibold"
        style={{ color: '#FF8A1F' }}
      >
        How is this worked out?
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol id="plan-working" aria-label="How your number is worked out" className="mt-2 space-y-2.5">
          {workingSteps(plan).map((s) => (
            <li key={`working-${s.title}`} className="text-xs">
              <span className="block font-semibold text-white">{s.title}</span>
              <span className="block tabular-nums">{s.sum}</span>
              {s.note && (
                <span className="block text-2xs mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  {s.note}
                </span>
              )}
            </li>
          ))}
          <li className="text-2xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {WORKING_NOTE}
            {units === 'imperial' ? ` ${METRIC_NOTE}` : ''}
          </li>
        </ol>
      )}
      <p className="text-2xs mt-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {PLAN_NOTE}
      </p>
    </section>
  );
}
