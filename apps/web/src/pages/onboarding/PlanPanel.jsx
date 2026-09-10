// The live plan number, on every screen from the moment the server has one
// (RULINGS 2026-09-07: every answer changes the number on screen). Before
// that, the panel says which answers it is still waiting for — never a number
// built from a default (RULINGS 2026-07-15).
import { Flame } from 'lucide-react';
import { PLAN_DISCLAIMER, changeLine, flagLines, kcalText, missingText, targetLine } from './onboardingModel';

function PlanNumbers({ plan, direction, units }) {
  const target = targetLine(plan, units);
  const flags = flagLines(plan, direction, units);
  return (
    <>
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
      <p className="text-2xs mt-3" style={{ color: 'rgba(255,255,255,0.45)' }}>
        {PLAN_DISCLAIMER}
      </p>
    </>
  );
}

export default function PlanPanel({ plan, missing, direction, units }) {
  return (
    <section aria-label="Your plan" className="card-glass mb-6">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider" style={{ color: '#FF8A1F' }}>
        <Flame className="w-3.5 h-3.5" />
        Your daily number
      </p>
      {plan === null ? (
        <p className="text-sm mt-2">It appears once you have answered {missingText(missing)}.</p>
      ) : (
        <PlanNumbers plan={plan} direction={direction} units={units} />
      )}
    </section>
  );
}
