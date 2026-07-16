// P2.8 web repoint (Card 3) — progressService rides the Card-1 authApi client
// (cookie session; the interceptor behavior itself is covered by
// authApi.test.js). These tests pin the REPOINT: every chart read hits its
// /v1/progress/* path with the period param, measurements hit the nutrition
// module's body-measurements routes (Part 4 §3.6), and getPredictions
// DELIBERATELY still rides mlApi (no new-API surface; DECISIONS 2026-07-11
// P2.3 carve) — a regression here means someone "finished" the repoint by
// deleting the feature, which the NO-REMOVAL rule forbids.
import { afterEach, describe, expect, it, vi } from 'vitest';
import authApi from './authApi';
import mlApi from './mlApi';
import { progressService } from './progressApi';

function recordRequests(api) {
  const seen = [];
  api.defaults.adapter = async (config) => {
    seen.push({ url: config.url, method: config.method, params: config.params, data: config.data });
    return { data: {}, status: 200, statusText: '', headers: {}, config, request: {} };
  };
  return seen;
}

afterEach(() => {
  authApi.defaults.adapter = undefined;
  mlApi.defaults.adapter = undefined;
  vi.unstubAllGlobals();
});

describe('progressService repoint (Card 3)', () => {
  it('sends every chart read to the new /v1/progress surface with its period', async () => {
    const seen = recordRequests(authApi);
    await progressService.getOverview('7d');
    await progressService.getCaloriesTrend('90d');
    await progressService.getWeeklyWorkouts('1y');
    await progressService.getActivityHeatmap();
    await progressService.getCategoryDistribution('all');
    await progressService.getPersonalRecords();
    expect(seen.map((s) => s.url)).toEqual([
      '/v1/progress/overview',
      '/v1/progress/trend',
      '/v1/progress/weekly',
      '/v1/progress/heatmap',
      '/v1/progress/distribution',
      '/v1/progress/records',
    ]);
    expect(seen[0].params).toEqual({ period: '7d' });
    expect(seen[1].params).toEqual({ period: '90d' });
    expect(seen[2].params).toEqual({ period: '1y' });
    // heatmap/records take no query — a stray param would 400 on .strict()
    expect(seen[3].params).toBeUndefined();
    expect(seen[4].params).toEqual({ period: 'all' });
    expect(seen[5].params).toBeUndefined();
  });

  it('measurements CRUD hits /v1/nutrition/body-measurements (Part 4 §3.6 home)', async () => {
    const seen = recordRequests(authApi);
    await progressService.getMeasurements(60);
    await progressService.logMeasurement({ measuredAt: '2026-07-16T00:00:00.000Z', weightKg: 75, metrics: { waist_cm: 85 } });
    await progressService.deleteMeasurement('m-1');
    expect(seen[0]).toMatchObject({ url: '/v1/nutrition/body-measurements', method: 'get', params: { limit: 60 } });
    expect(seen[1].url).toBe('/v1/nutrition/body-measurements');
    expect(seen[1].method).toBe('post');
    expect(JSON.parse(seen[1].data)).toEqual({
      measuredAt: '2026-07-16T00:00:00.000Z',
      weightKg: 75,
      metrics: { waist_cm: 85 },
    });
    expect(seen[2]).toMatchObject({ url: '/v1/nutrition/body-measurements/m-1', method: 'delete' });
  });

  it('getPredictions still rides the OLD client — repointing it without a new-API surface is forbidden', async () => {
    // mlApi's request interceptor reads localStorage (browser-only client;
    // it dies at P2.8) — stub it for the node test env.
    vi.stubGlobal('localStorage', { getItem: () => null });
    const oldSeen = recordRequests(mlApi);
    const newSeen = recordRequests(authApi);
    await progressService.getPredictions();
    expect(oldSeen.map((s) => s.url)).toEqual(['/progress/predictions']);
    expect(newSeen).toEqual([]);
  });
});
