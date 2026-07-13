// P2.6b — ORS adapter unit tests (pure; no DB, no network). A fake fetch feeds
// canned ORS geojson so the normalization port (routing_provider.py:159-200) is
// locked: [lng,lat]→[lat,lng] swap, native-metre distances, waytype/surface
// fractions, loop detection, and the fail-closed error paths.
import { describe, expect, it } from "vitest";
import { createOrsRouteProvider, OrsProviderError } from "../src/modules/geo/ors.adapter.js";
import { ORS_ROUTE_COST_MICRO } from "../src/modules/geo/cost.js";

const cannedOrs = {
  features: [
    {
      geometry: {
        // [lng, lat, elev] — a closed loop (first === last).
        coordinates: [
          [77.5, 12.9, 900],
          [77.6, 13.0, 910],
          [77.5, 12.9, 900],
        ],
      },
      properties: {
        summary: { distance: 5000 },
        ascent: 42,
        extras: {
          waytypes: {
            summary: [
              { value: 7, amount: 60 }, // footway → safe
              { value: 2, amount: 40 }, // road → busy
            ],
          },
          surface: { summary: [{ value: 4, amount: 30 }] }, // unpaved → green
        },
      },
    },
  ],
};

const okFetch =
  (payload: unknown): typeof fetch =>
  () =>
    Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }));

describe("ORS route adapter (pure normalization)", () => {
  it("normalizes a canned ORS feature: [lng,lat]→[lat,lng], metres, fractions, loop", async () => {
    const provider = createOrsRouteProvider("fake-key", okFetch(cannedOrs));
    const route = await provider.generate({ lat: 12.9, lng: 77.5, targetKm: 5, seed: 11 });
    expect(route.coords).toEqual([
      [12.9, 77.5],
      [13.0, 77.6],
      [12.9, 77.5],
    ]);
    expect(route.distanceM).toBe(5000);
    expect(route.elevationGainM).toBe(42);
    expect(route.safeFraction).toBe(0.6);
    expect(route.busyFraction).toBe(0.4);
    expect(route.greenFraction).toBe(0.3);
    expect(route.isLoop).toBe(true);
    expect(route.source).toBe("ors");
  });

  it("missing extras degrade each fraction to 0 (KeyError→0.0 guard); non-loop detected", async () => {
    const provider = createOrsRouteProvider("fake-key", okFetch({
      features: [
        {
          geometry: { coordinates: [[77.5, 12.9], [77.6, 13.0]] },
          properties: { summary: { distance: 1234 } },
        },
      ],
    }));
    const route = await provider.generate({ lat: 12.9, lng: 77.5, targetKm: 2, seed: 11 });
    expect(route.safeFraction).toBe(0);
    expect(route.busyFraction).toBe(0);
    expect(route.greenFraction).toBe(0);
    expect(route.elevationGainM).toBe(0);
    expect(route.isLoop).toBe(false);
  });

  it("network failure, non-ok status, and malformed body each throw OrsProviderError (fail-closed)", async () => {
    const netFail = createOrsRouteProvider("k", () => Promise.reject(new Error("dns")));
    await expect(netFail.generate({ lat: 1, lng: 1, targetKm: 5, seed: 11 })).rejects.toBeInstanceOf(OrsProviderError);

    const http429 = createOrsRouteProvider("k", () => Promise.resolve(new Response("rate limited", { status: 429 })));
    await expect(http429.generate({ lat: 1, lng: 1, targetKm: 5, seed: 11 })).rejects.toBeInstanceOf(OrsProviderError);

    const emptyFeatures = createOrsRouteProvider("k", okFetch({ features: [] }));
    await expect(emptyFeatures.generate({ lat: 1, lng: 1, targetKm: 5, seed: 11 })).rejects.toBeInstanceOf(OrsProviderError);
  });

  it("sends the round_trip body with metres length and the seed (routing_provider.py:204-216)", async () => {
    let seen: unknown;
    const provider = createOrsRouteProvider("secret-key", (_url, init) => {
      seen = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      return Promise.resolve(new Response(JSON.stringify(cannedOrs), { status: 200 }));
    });
    await provider.generate({ lat: 12.9, lng: 77.5, targetKm: 5, seed: 85 });
    expect(seen).toMatchObject({
      coordinates: [[77.5, 12.9]],
      options: { round_trip: { length: 5000, points: 4, seed: 85 } },
      elevation: true,
      instructions: false,
    });
  });

  it("ORS cost constant is BigInt 0 (free/OSM tier; ledger = call count, not dollars)", () => {
    expect(ORS_ROUTE_COST_MICRO).toBe(0n);
  });
});
