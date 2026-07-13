// P2.6b — OpenRouteService route provider. Ports routing_provider.py's ORS
// path (_call_ors / _parse_ors_feature / _normalize_route / _ors_extras_fraction)
// as plain fetch + Zod (R2.12; vision.adapter.ts precedent — NO SDK). The MOCK
// generator is DELIBERATELY NOT PORTED: fabricated geodata violates the trust
// doctrine, and route_gen is fail-closed (DECISIONS 2026-07-13). Every external
// response is a boundary crossed through safeParse (R2.3); a bad reply throws
// OrsProviderError and the service degrades to a typed 503.
import { z } from "zod";
import type { RouteCandidate } from "@app/shared";

const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking/geojson";

// ORS waytype codes grouped by runnability (routing_provider.py:73-74, ported
// verbatim). Higher = nicer/safer to run on.
const SAFE_WAYTYPES = new Set([3, 4, 5, 6, 7]); // street, path, track, cycleway, footway
const BUSY_WAYTYPES = new Set([1, 2]); // state road, road (vehicle-heavy)
// Unpaved/ground/grass surface codes — a park/trail proxy (routing_provider.py:173).
const GREEN_SURFACES = new Set([3, 4, 5, 6, 7, 8]);

export interface RouteProvider {
  generate(input: { lat: number; lng: number; targetKm: number; seed: number }): Promise<RouteCandidate>;
}

export class OrsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrsProviderError";
  }
}

// Defensive schema for the one feature we consume. Extras are optional (ORS
// omits them when a route has none); missing → fraction 0 (matches the Python
// KeyError → 0.0 guard).
const extraSummaryEntrySchema = z.object({ value: z.number(), amount: z.number() }).passthrough();
const extraSchema = z.object({ summary: z.array(extraSummaryEntrySchema).default([]) }).passthrough();
const featureSchema = z.object({
  geometry: z.object({ coordinates: z.array(z.array(z.number())) }),
  properties: z
    .object({
      summary: z.object({ distance: z.number().default(0) }).partial().default({}),
      ascent: z.number().nullable().default(0),
      extras: z
        .object({ waytypes: extraSchema.optional(), surface: extraSchema.optional() })
        .partial()
        .default({}),
    })
    .partial()
    .default({}),
});
const responseSchema = z.object({ features: z.array(featureSchema).min(1) });

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Sum the `amount` (percent-of-route) for extra codes in `codes`, as a 0..1
 *  fraction (routing_provider.py:142-156). */
function extrasFraction(extra: z.infer<typeof extraSchema> | undefined, codes: Set<number>): number {
  if (extra === undefined) return 0;
  let total = 0;
  for (const entry of extra.summary) {
    if (codes.has(entry.value)) total += entry.amount;
  }
  return Math.min(1, Math.max(0, round3(total / 100)));
}

function normalize(feature: z.infer<typeof featureSchema>): RouteCandidate {
  // ORS returns [lng, lat, (elev)] — convert to [lat, lng] (routing_provider.py:161-162).
  const coords: [number, number][] = feature.geometry.coordinates
    .filter((c) => c.length >= 2)
    .map((c) => [round6(c[1] ?? 0), round6(c[0] ?? 0)]);
  const props = feature.properties; // defaulted to {} by the schema
  const distanceM = Math.round(props.summary?.distance ?? 0);
  const elevationGainM = Math.round(props.ascent ?? 0);
  const first = coords[0];
  const last = coords[coords.length - 1];
  return {
    coords,
    distanceM: Math.max(0, distanceM),
    elevationGainM: Math.max(0, elevationGainM),
    safeFraction: extrasFraction(props.extras?.waytypes, SAFE_WAYTYPES),
    busyFraction: extrasFraction(props.extras?.waytypes, BUSY_WAYTYPES),
    greenFraction: extrasFraction(props.extras?.surface, GREEN_SURFACES),
    isLoop: coords.length > 0 && first !== undefined && last !== undefined && first[0] === last[0] && first[1] === last[1],
    source: "ors",
  };
}

export function createOrsRouteProvider(apiKey: string, fetchImpl: typeof fetch = fetch): RouteProvider {
  return {
    async generate({ lat, lng, targetKm, seed }) {
      // Request body ported from _call_ors (routing_provider.py:204-216).
      const body = {
        coordinates: [[lng, lat]],
        options: { round_trip: { length: Math.round(targetKm * 1000), points: 4, seed } },
        elevation: true,
        instructions: false,
        extra_info: ["waytype", "steepness", "surface"],
      };
      let response: Response;
      try {
        response = await fetchImpl(ORS_DIRECTIONS_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: apiKey },
          body: JSON.stringify(body),
        });
      } catch {
        throw new OrsProviderError("ors network failure");
      }
      if (!response.ok) throw new OrsProviderError(`ors HTTP ${String(response.status)}`);
      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new OrsProviderError("ors non-JSON response");
      }
      const parsed = responseSchema.safeParse(raw);
      if (!parsed.success) throw new OrsProviderError("ors malformed response");
      const feature = parsed.data.features[0];
      if (feature === undefined) throw new OrsProviderError("ors empty feature collection");
      return normalize(feature);
    },
  };
}
