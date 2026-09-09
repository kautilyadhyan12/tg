// P1.1 — schema contract tests (Part 2 §2, v1 §5.3).
import { describe, expect, it } from "vitest";
import {
  DPDP_EXPORT_SCHEMA_VERSION,
  ORG_PRIVILEGES,
  KEYPOINT_COUNT,
  KP,
  VISIBILITY_THRESHOLD,
  dpdpExportSchema,
  frameResultSchema,
  holdEventSchema,
  instantSchema,
  myOrgsResponseSchema,
  orgStaffResponseSchema,
  poseFrameSchema,
  repEventSchema,
  sessionInputSchema,
  setSummarySchema,
  updateOrgStaffPrivilegesRequestSchema,
  workoutListQuerySchema,
  workoutSyncPayloadSchema,
} from "../src/index.js";

const kp33 = Array.from({ length: 33 }, () => [0.5, 0.5, 0, 0.9]);

const validSetSummary = {
  exercise: "squat",
  setIndex: 1,
  reps: 12,
  durationMs: 48000,
  avgFormScore: 84,
  repScores: [90, 88, 76],
  faultCounts: { shallow_depth: 2, knee_valgus: 1 },
  tempoMsAvg: 3900,
  romStats: { metricMinAvg: 96 },
  view: "side",
  holdMs: null,
  calibration: { usedStandingBaseline: true, chairDepthTarget: null },
  engineVersion: "1.0.0",
  definitionVersion: 5,
};

describe("PoseFrame (§2.1)", () => {
  it("accepts a valid 33-keypoint frame", () => {
    expect(poseFrameSchema.parse({ t: 123456.7, kp: kp33 })).toBeDefined();
  });
  it("rejects wrong keypoint count", () => {
    expect(poseFrameSchema.safeParse({ t: 0, kp: kp33.slice(0, 32) }).success).toBe(false);
  });
  it("rejects vis outside [0,1] and negative t", () => {
    const bad = [...kp33.slice(0, 32), [0.5, 0.5, 0, 1.5]];
    expect(poseFrameSchema.safeParse({ t: 0, kp: bad }).success).toBe(false);
    expect(poseFrameSchema.safeParse({ t: -1, kp: kp33 }).success).toBe(false);
  });
  it("rejects unknown keys (strict)", () => {
    expect(poseFrameSchema.safeParse({ t: 0, kp: kp33, extra: 1 }).success).toBe(false);
  });
  it("index map matches the §2.1 table and vis threshold is 0.3", () => {
    expect(KP.nose).toBe(0);
    expect(KP.left_shoulder).toBe(11);
    expect(KP.right_shoulder).toBe(12);
    expect(KP.left_hip).toBe(23);
    expect(KP.right_knee).toBe(26);
    expect(KP.right_foot_index).toBe(32);
    expect(Object.keys(KP)).toHaveLength(KEYPOINT_COUNT);
    expect(VISIBILITY_THRESHOLD).toBe(0.3);
  });
});

describe("engine events (§2.4)", () => {
  it("FrameResult round-trips with nullable liveCue", () => {
    const fr = {
      phase: "descent",
      repCount: 3,
      isActive: true,
      view: "side",
      visibilityOk: true,
      liveCue: null,
      signals: { knee_angle: 92.4 },
      calibrationState: "ready",
    };
    expect(frameResultSchema.parse(fr)).toEqual(fr);
  });
  it("RepEvent rejects out-of-range score", () => {
    const re = {
      repIndex: 1,
      score: 101,
      faults: [],
      durationMs: 4000,
      phaseTimings: { descent: 1500, bottom: 500, ascent: 2000 },
      romExtreme: 96,
      view: "side",
    };
    expect(repEventSchema.safeParse(re).success).toBe(false);
    expect(repEventSchema.safeParse({ ...re, score: 100 }).success).toBe(true);
  });
  it("HoldEvent accepts an ended-hold summary", () => {
    expect(
      holdEventSchema.parse({ totalQualifyingMs: 30000, longestContiguousMs: 21000, endedAtMs: 61000 }),
    ).toBeDefined();
  });
  it("SetSummary parses the §2.4 document verbatim", () => {
    expect(setSummarySchema.parse(validSetSummary)).toEqual(validSetSummary);
  });
  it("SetSummary rejects fractional reps and unknown keys", () => {
    expect(setSummarySchema.safeParse({ ...validSetSummary, reps: 1.5 }).success).toBe(false);
    expect(setSummarySchema.safeParse({ ...validSetSummary, bonus: 1 }).success).toBe(false);
  });

  // ── watchedMs, the Kd-ruled §2.4 addition of 2026-08-14 ──────────────────
  //
  // THE GATE IS THE TEST ABOVE, and it is why this field is OPTIONAL: Part 2
  // §10 requires the sync payload to byte-match the §2.4 document, and
  // `validSetSummary` IS that document, copied from the spec. It still parses
  // and still round-trips with the field added to the schema — so the gate
  // holds by construction rather than by argument. If a later card makes this
  // field required, that test goes red first, which is the intended alarm.
  it("SetSummary accepts an engine set reporting watched time", () => {
    const parsed = setSummarySchema.parse({ ...validSetSummary, watchedMs: 41000 });
    expect(parsed).toEqual({ ...validSetSummary, watchedMs: 41000 });
  });
  it("SetSummary rejects a watched time that would overflow the column", () => {
    expect(setSummarySchema.safeParse({ ...validSetSummary, watchedMs: 2_147_483_648 }).success).toBe(
      false,
    );
    expect(setSummarySchema.safeParse({ ...validSetSummary, watchedMs: -1 }).success).toBe(false);
    expect(setSummarySchema.safeParse({ ...validSetSummary, watchedMs: 1.5 }).success).toBe(false);
  });
  it("a log-only set cannot claim the camera watched it", () => {
    // Nothing watched a hand-counted set, so the only honest value is null.
    // A number here would let a client hand the server a watched time it can
    // bill from — on a set no camera ever ran on.
    const logOnly = {
      exercise: "squat",
      setIndex: 1,
      reps: 10,
      durationMs: 40000,
      tempoMsAvg: null,
      romStats: null,
      view: "unknown",
      holdMs: null,
      calibration: null,
      mode: "log_only",
      avgFormScore: null,
      repScores: null,
      faultCounts: {},
      engineVersion: null,
      definitionVersion: null,
    };
    expect(setSummarySchema.safeParse(logOnly).success).toBe(true);
    expect(setSummarySchema.safeParse({ ...logOnly, watchedMs: null }).success).toBe(true);
    expect(setSummarySchema.safeParse({ ...logOnly, watchedMs: 40000 }).success).toBe(false);
    expect(setSummarySchema.safeParse({ ...logOnly, watchedMs: 0 }).success).toBe(false);
  });
});

describe("session input (§2.3)", () => {
  it("accepts a schema-valid definition + optional calibration carry-over", () => {
    expect(
      sessionInputSchema.parse({
        definition: {
          key: "brisk_walking",
          version: 1,
          minEngineVersion: "1.0.0",
          family: "cardio",
          tracking: "timer",
          status: "beta",
        },
        carryOverCalibration: { standingBaseline: 0.42 },
      }),
    ).toBeDefined();
  });
  it("rejects a malformed definition (P1.7 tightening of the P1.1 unknown)", () => {
    expect(
      sessionInputSchema.safeParse({ definition: { anything: "no longer accepted" } }).success,
    ).toBe(false);
  });
});

describe("instantSchema — a shape that parses is not an instant", () => {
  // Measured 2026-08-04: zod's `datetime({ offset: true })` admits an offset
  // whose HOUR component is above 23, and `Date` rejects exactly those. Every
  // schema carrying a caller-supplied offset instant goes through this, so the
  // hole is closed once rather than per field (the T3 on b80bd3c, F1).
  const syncPayload = {
    workoutId: "7d9f8e1c-3b2a-4c5d-9e8f-1a2b3c4d5e6f",
    startedAt: "2026-07-07T10:00:00+05:30",
    platform: "web",
    engineVersion: "1.0.0",
    defsVersion: 1,
    sets: [validSetSummary],
    traceSample: null,
  };

  it("rejects an offset no clock has, on the two sites that take one", () => {
    for (const bad of ["2026-07-01T00:00:00+25:30", "2026-07-01T00:00:00+99:00"]) {
      expect(instantSchema.safeParse(bad).success).toBe(false);
      // The two live users of it, asserted through the SCHEMAS rather than
      // trusted to share an import: an edit that inlines `datetime()` back into
      // either one fails here.
      expect(workoutListQuerySchema.safeParse({ from: bad }).success).toBe(false);
      expect(workoutSyncPayloadSchema.safeParse({ ...syncPayload, startedAt: bad }).success).toBe(false);
    }
  });

  it("still accepts the real ones — Z and a genuine offset", () => {
    // THE CONTROL. Without it the assertion above is satisfied by a schema that
    // rejects every date, which would break every client instead of one input.
    for (const good of ["2026-07-01T00:00:00Z", "2026-07-01T00:00:00.123Z", "2026-07-01T00:00:00+05:30"]) {
      expect(instantSchema.safeParse(good).success).toBe(true);
      expect(workoutListQuerySchema.safeParse({ from: good }).success).toBe(true);
    }
  });
});

describe("workout sync payload (v1 §5.3)", () => {
  const payload = {
    workoutId: "7d9f8e1c-3b2a-4c5d-9e8f-1a2b3c4d5e6f",
    startedAt: "2026-07-07T10:00:00+05:30",
    platform: "web",
    engineVersion: "1.0.0",
    defsVersion: 1,
    sets: [validSetSummary],
    traceSample: null,
  };
  it("accepts a full payload with §2.4 sets", () => {
    expect(workoutSyncPayloadSchema.parse(payload)).toBeDefined();
  });
  it("rejects a non-uuid workoutId (idempotency key integrity)", () => {
    expect(workoutSyncPayloadSchema.safeParse({ ...payload, workoutId: "wk-1" }).success).toBe(false);
  });
  it("rejects unknown platform and unknown keys", () => {
    expect(workoutSyncPayloadSchema.safeParse({ ...payload, platform: "tv" }).success).toBe(false);
    expect(workoutSyncPayloadSchema.safeParse({ ...payload, extra: true }).success).toBe(false);
  });
  // Part 4 §3.5 column-type bounds + upsert-key integrity (P1.10d T3): values
  // that would overflow PG smallint/int4, duplicate the (workout_id, set_index)
  // key, or create an empty engine workout must fail at the schema, not as a
  // server 500 (which the client's retry policy would treat as transient).
  it("rejects DDL overflows: setIndex/reps > smallint, durationMs > int4", () => {
    const withSet = (over: Record<string, number>) => ({
      ...payload,
      sets: [{ ...validSetSummary, ...over }],
    });
    expect(workoutSyncPayloadSchema.safeParse(withSet({ setIndex: 32768 })).success).toBe(false);
    expect(workoutSyncPayloadSchema.safeParse(withSet({ reps: 32768 })).success).toBe(false);
    expect(
      workoutSyncPayloadSchema.safeParse(withSet({ durationMs: 2_147_483_648 })).success,
    ).toBe(false);
  });
  it("rejects duplicate setIndex (would silently drop rows in the §3.5 upsert)", () => {
    const dup = { ...payload, sets: [validSetSummary, { ...validSetSummary }] };
    expect(workoutSyncPayloadSchema.safeParse(dup).success).toBe(false);
  });
  // The 2026-08-07 Kd-ruled fields: the on-screen timer and the rest-break
  // counter. OPTIONAL (queued pre-card payloads must keep parsing), bounded at
  // floor(INT4_MAX/1000) because the ms form lands in an int4 column.
  it("accepts durationSeconds/restSeconds, together, alone, or absent", () => {
    expect(
      workoutSyncPayloadSchema.parse({ ...payload, durationSeconds: 300, restSeconds: 60 }),
    ).toBeDefined();
    expect(workoutSyncPayloadSchema.parse({ ...payload, restSeconds: 0 })).toBeDefined();
    expect(workoutSyncPayloadSchema.parse(payload)).toBeDefined(); // the pre-card shape
  });
  it("rejects duration/rest values the columns or the formula cannot hold", () => {
    const parses = (extra: Record<string, number>) =>
      workoutSyncPayloadSchema.safeParse({ ...payload, ...extra }).success;
    expect(parses({ durationSeconds: 0 })).toBe(false); // positive: 0 means "omit"
    expect(parses({ durationSeconds: -5 })).toBe(false);
    expect(parses({ durationSeconds: 90.5 })).toBe(false);
    expect(parses({ durationSeconds: 2_147_484 })).toBe(false); // ms form > int4
    expect(parses({ restSeconds: -1 })).toBe(false);
    expect(parses({ restSeconds: 2_147_484 })).toBe(false);
    // The boundary itself is legal on both fields.
    expect(parses({ durationSeconds: 2_147_483, restSeconds: 2_147_483 })).toBe(true);
  });
  // R2-F4: the old title said "all-log-only workouts are never synced", citing
  // DECISIONS 2026-07-10. That bar was REINTERPRETED on 2026-08-01 — log-only
  // sets are expressible now, so an all-log-only workout satisfies this with
  // real sets. What it still forbids is a workout with no sets at all. The
  // source comment was rewritten in the same commit "so the next reader does
  // not restore the old meaning", while the assertion enforcing it kept that
  // meaning — the sweep stopped at the file being edited.
  it("rejects a workout with NO sets at all (DECISIONS 2026-08-01 reinterprets the 07-10 bar)", () => {
    expect(workoutSyncPayloadSchema.safeParse({ ...payload, sets: [] }).success).toBe(false);
  });

  // R2-F5: `packages/shared` OWNS this union and had zero cases for the
  // log-only branch — every assertion lived in api suites gated behind
  // `describe.skipIf(DATABASE_URL)`. Deleting `logOnlySetSummarySchema` left
  // this package's suite green. These run with no database.
  describe("the log-only branch (Part 6 §3.6; Kd-ruled 2026-08-01)", () => {
    const logOnlySet = {
      exercise: "squat",
      setIndex: 1,
      reps: 10,
      durationMs: 30_000,
      mode: "log_only",
      avgFormScore: null,
      repScores: null,
      faultCounts: {},
      tempoMsAvg: null,
      romStats: null,
      view: "unknown",
      holdMs: null,
      calibration: null,
      engineVersion: null,
      definitionVersion: null,
    };
    const withLogOnly = (extra: Record<string, unknown> = {}) => ({
      ...payload,
      sets: [{ ...logOnlySet, ...extra }],
    });

    it("accepts a hand-logged set", () => {
      expect(workoutSyncPayloadSchema.safeParse(withLogOnly()).success).toBe(true);
    });

    it("rejects repScores [] — the contract says NULL, exactly as the column does", () => {
      expect(workoutSyncPayloadSchema.safeParse(withLogOnly({ repScores: [] })).success).toBe(false);
    });

    it("rejects every form claim on a set nothing analysed", () => {
      for (const claim of [
        { avgFormScore: 90 },
        { repScores: [90, 91] },
        { faultCounts: { shallow_depth: 1 } },
        { engineVersion: "1.0.0" },
        { definitionVersion: 1 },
      ]) {
        expect(
          workoutSyncPayloadSchema.safeParse(withLogOnly(claim)).success,
          `${JSON.stringify(claim)} must not be storable on a log-only set`,
        ).toBe(false);
      }
    });

    it("still requires an ENGINE set to carry its provenance", () => {
      for (const missing of [{ engineVersion: null }, { definitionVersion: null }]) {
        const sets = [{ ...validSetSummary, ...missing }];
        expect(workoutSyncPayloadSchema.safeParse({ ...payload, sets }).success).toBe(false);
      }
    });

    it("accepts defsVersion null — a client with no bundle loaded has none to report", () => {
      expect(
        workoutSyncPayloadSchema.safeParse({ ...withLogOnly(), defsVersion: null }).success,
      ).toBe(true);
    });

    it("rejects an empty engineVersion at BOTH levels (an empty string is not a version)", () => {
      expect(
        workoutSyncPayloadSchema.safeParse({ ...payload, engineVersion: "" }).success,
      ).toBe(false);
      const sets = [{ ...validSetSummary, engineVersion: "" }];
      expect(workoutSyncPayloadSchema.safeParse({ ...payload, sets }).success).toBe(false);
    });
  });
});

/** T3 round 1 Low-1 (a LATENT HIGH). The Staff screen was built to carry a
 *  privilege it has no words for straight through a save, and to say so on
 *  screen — the api and the web deploy separately and a billing tick is already
 *  scheduled. **None of it could ever run**, because the READ schema validated
 *  the whole list against this build's enum, so a response mentioning a newer
 *  privilege failed to parse before any component saw it. `readThrough` turns
 *  that into a hard contract failure, which means the day a seventh privilege
 *  ships api-first, every owner's Staff screen shows an error instead of their
 *  staff — the precise outcome `.optional()` was chosen to prevent, arriving
 *  through the parser rather than the network.
 *
 *  Lenient IN, strict OUT: the write body below stays the enum, because the
 *  server is the authority on its own vocabulary and the database CHECK agrees
 *  with it. */
describe("privileges a newer server knows and this build does not", () => {
  /** THE FIXTURE HAD TO STOP BEING A REAL-LOOKING NAME, and the reason is that
   *  it stopped being unreal. This block used `billing.manage` as its stand-in
   *  for "a privilege a newer server knows" — and on 2026-08-27 the trial card
   *  added exactly that privilege, so the write test below started FAILING for
   *  the best possible reason: the future it was imagining arrived.
   *
   *  A synthetic token that no vocabulary can ever mint fixes the CLASS rather
   *  than this instance (:1239). The next plausible name — `reports.read`,
   *  `announcements.write` — would put the same trap back one card later, and
   *  the failure would again look like a bug in the parser rather than a stale
   *  fixture. Named once and used in all three tests so a future privilege
   *  cannot half-update it. */
  const UNKNOWN_PRIVILEGE = "zz.privilege.from.a.newer.server";

  const staffRow = {
    userId: "11111111-1111-4111-8111-111111111111",
    displayName: "Rita",
    email: "rita@example.com",
    role: "trainer" as const,
    since: "2026-01-01T00:00:00.000Z",
    isYou: false,
  };

  it("does not destroy the staff list", () => {
    const known = orgStaffResponseSchema.safeParse({
      staff: [{ ...staffRow, privileges: ["members.read"] }],
    });
    expect(known.success).toBe(true);

    const newer = orgStaffResponseSchema.safeParse({
      staff: [{ ...staffRow, privileges: ["members.read", UNKNOWN_PRIVILEGE] }],
    });
    expect(newer.success).toBe(true);
    // Carried through UNCHANGED — the screen filters to what it has words for
    // and puts the rest back on save. Dropping it here would silently strip a
    // permission from the next person who pressed Save.
    if (newer.success) {
      expect(newer.data.staff[0]?.privileges).toEqual(["members.read", UNKNOWN_PRIVILEGE]);
    }
  });

  /** THIS TEST WAS A LIAR IN ITS FIRST DRAFT AND ITS OWN MUTANT CAUGHT IT
   *  (rule 4, in the round convened to fix that class). It asserted only that
   *  the response PARSED — and Zod strips keys it does not know rather than
   *  refusing them, so deleting `privileges` from `myOrgSchema` entirely left it
   *  green. It has to assert the value SURVIVES.
   *
   *  That is not pedantry: the console's render tests mock `orgService`, so they
   *  never run this parser. A silently stripped field would reach no screen, the
   *  whole C/H-1 fix would be dead, and nothing else in the repo would notice. */
  it("does not destroy the caller's own gym list, and the set SURVIVES the parse", () => {
    const parsed = myOrgsResponseSchema.safeParse({
      orgs: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "iron-house",
          name: "Iron House",
          city: null,
          orgType: "gym",
          timezone: "Asia/Kolkata",
          locale: "en",
          currencyDisplay: "INR",
          status: "active",
          staffRole: "manager",
          privileges: ["members.read", UNKNOWN_PRIVILEGE],
          isMember: true,
          joinedAt: null,
        },
      ],
      formerOrgs: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.orgs[0]?.privileges).toEqual(["members.read", UNKNOWN_PRIVILEGE]);
    }
  });

  /** **THE ATTENDANCE SWITCH'S DEFAULT IS DECLARED HERE AND NOWHERE ELSE** (T3
   *  round 1, L-5). `AttendanceSettingsPanel` used to read
   *  `manualAttendanceEnabled !== false`, which is a SECOND spelling of this
   *  `.default(true)` — correct on the day it was written and free to disagree
   *  with the contract afterwards, since flipping the default here would leave
   *  the panel still drawing the switch ON. The panel now reads the boolean, so
   *  this default is the only declaration and needs its own observer.
   *
   *  The fixture omits the key deliberately: an api older than this bundle sends
   *  nothing, and the console must not conclude a gym switched attendance off. */
  it("supplies the attendance switch's default when an older api omits it", () => {
    const parsed = myOrgsResponseSchema.safeParse({
      orgs: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          slug: "iron-house",
          name: "Iron House",
          city: null,
          orgType: "gym",
          timezone: "Asia/Kolkata",
          locale: "en",
          currencyDisplay: "INR",
          status: "active",
          staffRole: "manager",
          privileges: ["members.read"],
          isMember: true,
          joinedAt: null,
        },
      ],
      formerOrgs: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.orgs[0]?.manualAttendanceEnabled).toBe(true);
    }
  });

  it("STILL REFUSES an unknown privilege on the way IN — the server's own vocabulary", () => {
    // The positive control for the pair above: leniency is scoped to READS.
    // Without this, "accept anything" would pass both tests and would let a
    // client write a value the database CHECK then rejects with a 500.
    const ok = updateOrgStaffPrivilegesRequestSchema.safeParse({
      privileges: ["members.read"],
    });
    expect(ok.success).toBe(true);

    const bad = updateOrgStaffPrivilegesRequestSchema.safeParse({
      privileges: ["members.read", UNKNOWN_PRIVILEGE],
    });
    expect(bad.success).toBe(false);

    // AND the real newest privilege IS accepted, which is what stops this test
    // passing against a schema frozen at whatever the vocabulary was the day it
    // was written — the failure mode the fixture rename above was a symptom of.
    //
    // **DERIVED FROM THE VOCABULARY RATHER THAN NAMED, and the ninth privilege
    // is why (:28107).** This line said `"billing.manage"` and went on passing
    // when `attendance.read` was minted — still true, no longer testing what it
    // claims, which is :5348 rule 4's definition of a liar. Naming the new one
    // would put the same trap back one card later, exactly as the comment above
    // says of `UNKNOWN_PRIVILEGE`. New privileges are APPENDED to
    // `ORG_PRIVILEGES`, so the last entry is the newest by construction.
    const newestPrivilege = ORG_PRIVILEGES[ORG_PRIVILEGES.length - 1];
    expect(newestPrivilege).toBeDefined();
    const newest = updateOrgStaffPrivilegesRequestSchema.safeParse({
      privileges: ["members.read", newestPrivilege],
    });
    expect(newest.success).toBe(true);
  });
});

// The export envelope's `truncated` block (Part 4 §5.2, schemaVersion 2). Its
// guards were fed nothing but valid server output — the api suite parses whole
// exports the server just built — so deleting the `.strict()` or the refine
// left everything green. This is the only place they are pushed on.
describe("DPDP export envelope: the truncation block", () => {
  const envelope = (truncated: unknown) => ({
    exportedAt: "2026-09-09T10:00:00.000Z",
    schemaVersion: DPDP_EXPORT_SCHEMA_VERSION,
    user: { id: "u1" },
    data: { consent_log: [] },
    truncated,
  });

  it("accepts no truncation and a real one", () => {
    // `{}` is the ordinary case and must stay legal: the key is ALWAYS present,
    // so "nothing was cut" is said out loud rather than by an absent key.
    expect(dpdpExportSchema.safeParse(envelope({})).success).toBe(true);
    expect(
      dpdpExportSchema.safeParse(envelope({ consent_log: { returned: 1000, total: 1001 } })).success,
    ).toBe(true);
  });

  it("refuses an entry that is not a truncation, or one carrying extra keys", () => {
    // returned === total is the false statement the whole block exists to
    // prevent — an envelope announcing a cut that never happened.
    expect(
      dpdpExportSchema.safeParse(envelope({ consent_log: { returned: 3, total: 3 } })).success,
    ).toBe(false);
    // ...and returned > total is the same lie pointed the other way.
    expect(
      dpdpExportSchema.safeParse(envelope({ consent_log: { returned: 4, total: 3 } })).success,
    ).toBe(false);
    // A stray key means the producer and this contract disagree about the
    // shape; a downloadable file is the wrong place to find that out.
    expect(
      dpdpExportSchema.safeParse(
        envelope({ consent_log: { returned: 1, total: 2, cut: "oldest" } }),
      ).success,
    ).toBe(false);
    // Negative counts, and a missing half, are not counts at all.
    expect(
      dpdpExportSchema.safeParse(envelope({ consent_log: { returned: -1, total: 3 } })).success,
    ).toBe(false);
    expect(dpdpExportSchema.safeParse(envelope({ consent_log: { total: 3 } })).success).toBe(false);
  });

  it("requires the block itself — a file that cannot say it is whole is not the contract", () => {
    const withoutBlock: Record<string, unknown> = { ...envelope({}) };
    delete withoutBlock["truncated"];
    expect(dpdpExportSchema.safeParse(withoutBlock).success).toBe(false);
  });
});
