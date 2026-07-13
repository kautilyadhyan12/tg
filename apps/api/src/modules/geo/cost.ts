// P2.6b — ORS cost constant (Part 0 rule 4: cited, one-line updatable).
// DECISIONS 2026-07-13: OpenRouteService's free/OSM tier has no per-call price
// (billing is request-count against a daily allowance, openrouteservice.org).
// The api_cost_events row exists to satisfy v1 §9.3 "every external API call
// writes a row" as a CALL COUNT, not a dollar charge — hence cost_micro=0.
// Raise this the day a paid ORS plan is adopted (integer micro-USD, BigInt, no
// float near money — R6.1).
export const ORS_ROUTE_COST_MICRO = 0n;
