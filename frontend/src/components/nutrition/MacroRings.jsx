import { motion } from 'framer-motion';

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

// ── Full macro rings panel ────────────────────────────────────────────────────
export default function MacroRings({ totals, targets }) {
  const safeTargets = targets || {};
  const safeTotals  = totals  || {};

  const kcalTarget    = safeTargets.kcal      || 2000;
  const proteinTarget = safeTargets.protein_g || 150;
  const carbsTarget   = safeTargets.carbs_g   || 250;
  const fatTarget     = safeTargets.fat_g     || 65;

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