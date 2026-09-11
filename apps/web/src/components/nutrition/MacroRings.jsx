import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { missingText } from '../../pages/onboarding/onboardingModel';

// ── Single animated ring ──────────────────────────────────────────────────────
function Ring({ size = 90, stroke = 8, percent, color, label, value, unit, target }) {
  const radius        = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped       = Math.min(Math.max(percent, 0), 100);
  const offset        = circumference - (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {/* Background track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={stroke}
          />
          {/* Progress arc */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
            style={{ filter: `drop-shadow(0 0 6px ${color}55)` }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-base font-bold tabular-nums tracking-tight"
             style={{ color }}>
            {Math.round(value)}
          </p>
          <p className="text-2xs font-medium"
             style={{ color: 'rgba(255,255,255,0.40)' }}>
            / {target}{unit}
          </p>
        </div>
      </div>
      <p className="text-xs font-semibold mt-2 uppercase tracking-wider"
         style={{ color: 'rgba(255,255,255,0.65)' }}>
        {label}
      </p>
    </div>
  );
}

// ── Honest empty state ───────────────────────────────────────────────────────
// Kd's exact-data rule: a target we cannot compute is not shown as a number.
// It names the questions the SERVER said the plan still needs, in the
// onboarding screens' own words, and "Answer now" opens onboarding, which
// starts on the first of them and comes back here (ROADMAP 4a-iii). A target
// on the wrong side of the weight is not a question left open, since the
// person has one: the card asks for a new one, in words that fit whether the
// goal changed or the target was reached, and the link opens the target
// screen, which shows it and offers only the goal's side (RULINGS 2026-09-11).
function NoTargets({ missingInputs, targetWrongSide }) {
  const list = missingInputs.length > 0 ? missingText(missingInputs) : null;
  let text = 'Finish setting up to see your daily calories and macros.';
  if (targetWrongSide) text = 'Time to set a new target weight. Pick one to see your daily calories and macros.';
  else if (list !== null) text = `To see your daily calories and macros, answer ${list}.`;
  return (
    <div className="card-glass">
      <h3 className="text-sm font-semibold mb-3"
          style={{ color: 'rgba(255,255,255,0.80)' }}>
        Today's Macros
      </h3>
      <p className="text-xs leading-relaxed mb-4"
         style={{ color: 'rgba(255,255,255,0.55)' }}>
        {text}
      </p>
      <Link
        to="/onboarding"
        state={{ returnTo: '/nutrition' }}
        className="inline-block text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
        style={{ color: '#FF8A1F', backgroundColor: 'rgba(255,138,31,0.12)' }}
      >
        {targetWrongSide ? 'Pick a new target' : 'Answer now'}
      </Link>
    </div>
  );
}

// ── Could not load ───────────────────────────────────────────────────────────
// Distinct from NoTargets ON PURPOSE (T3 F1): this one blames the request, not
// the user. Blaming the profile for our own failure would send someone to
// Settings to fix something that is not broken.
function TargetsUnavailable() {
  return (
    <div className="card-glass">
      <h3 className="text-sm font-semibold mb-3"
          style={{ color: 'rgba(255,255,255,0.80)' }}>
        Today's Macros
      </h3>
      <p className="text-xs leading-relaxed"
         style={{ color: 'rgba(255,255,255,0.55)' }}>
        Couldn&apos;t load your targets just now. Refresh to try again — your
        logged meals are unaffected.
      </p>
    </div>
  );
}

// ── Full macro rings panel ────────────────────────────────────────────────────
export default function MacroRings({ totals, targets, missingInputs = [], targetWrongSide = false }) {
  const safeTotals = totals || {};

  // THREE states, and they must NOT collapse (T3 F1 — the first version used
  // `== null` here, which swallowed `undefined` into the null branch and so
  // told a user with a perfectly complete profile to "add your details",
  // sending them to Settings to fix nothing. That is exactly the fabricated
  // claim toDisplayTargets' contract promises never to make; the three-state
  // model survived the mapper and died at its only consumer):
  //   null      → the SERVER said this profile cannot produce a target
  //   undefined → we could not read the answer (parent renders only after the
  //               request settles, so undefined here means it failed)
  //
  // The former `|| 2000 / 150 / 250 / 65` fallbacks are DELETED (Kd ruling,
  // nutrition-targets card). They predate a real calculator, when targets were
  // dark for everyone; with one live they would fire ONLY for the
  // incomplete-profile user — precisely the person who must not be shown a
  // stranger's calorie goal rendered identically to their own.
  if (targets === null) return <NoTargets missingInputs={missingInputs} targetWrongSide={targetWrongSide} />;
  if (targets === undefined) return <TargetsUnavailable />;

  const kcalTarget    = targets.kcal;
  const proteinTarget = targets.protein_g;
  const carbsTarget   = targets.carbs_g;
  const fatTarget     = targets.fat_g;

  const kcalPct    = (safeTotals.kcal       / kcalTarget)    * 100 || 0;
  const proteinPct = (safeTotals.protein_g  / proteinTarget) * 100 || 0;
  const carbsPct   = (safeTotals.carbs_g    / carbsTarget)   * 100 || 0;
  const fatPct     = (safeTotals.fat_g      / fatTarget)     * 100 || 0;

  return (
    <div className="card-glass">
      <h3 className="text-sm font-semibold mb-5"
          style={{ color: 'rgba(255,255,255,0.80)' }}>
        Today's Macros
      </h3>

      {/* Large center kcal ring */}
      <div className="flex justify-center mb-6">
        <Ring
          size={150}
          stroke={12}
          percent={kcalPct}
          color="#FF8A1F"
          label="Calories"
          value={safeTotals.kcal || 0}
          target={kcalTarget}
          unit=""
        />
      </div>

      {/* Three smaller macro rings */}
      <div className="grid grid-cols-3 gap-2">
        <Ring
          percent={proteinPct}
          color="#4ade80"
          label="Protein"
          value={safeTotals.protein_g || 0}
          target={proteinTarget}
          unit="g"
        />
        <Ring
          percent={carbsPct}
          color="#60a5fa"
          label="Carbs"
          value={safeTotals.carbs_g || 0}
          target={carbsTarget}
          unit="g"
        />
        <Ring
          percent={fatPct}
          color="#fbbf24"
          label="Fat"
          value={safeTotals.fat_g || 0}
          target={fatTarget}
          unit="g"
        />
      </div>
    </div>
  );
}