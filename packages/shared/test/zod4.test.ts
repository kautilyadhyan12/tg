// The move to zod 4 (ROADMAP 21a-iii-b): an address that signs in today still signs in, an id
// the app makes is still read, and a change to a body measurement does not fill in the rest.
// The addresses come from outside this code: the valid and invalid examples of Wikipedia's
// "Email address" article (read 2026-11-09), the shapes of everyday providers in the US, Canada
// and India, and what people mistype. Each is read by the sign-in rule as zod 3 wrote it too.
import { describe, expect, it } from "vitest";
import { z as z3 } from "zod/v3";
import { bodyMeasurementInputSchema, patchBodyMeasurementSchema, sendCodeRequestSchema, verifyCodeRequestSchema } from "../src/index.js";

const zod3SignIn = z3.string().trim().toLowerCase().max(254).email();

const EVERYDAY = [
  "kd@gmail.com",
  "Kd.Darshan@Gmail.com",
  "  someone@yahoo.co.in ",
  "first.last+gym@outlook.com",
  "o'connor@icloud.com",
  "member_2026@rediffmail.com",
  "a-b@shaw.ca",
  "coach@my-gym.fitness",
  "owner@sub.domain.photography",
  "123@456.com",
  "very.common@example.com",
  "FirstName.LastName@EasierReading.org",
  "x@example.com",
  "long.email-address-with-hyphens@and.subdomains.example.com",
  "user.name+tag+sorting@example.com",
  "example@s.example",
  "user-@example.org",
];

// Wikipedia's other valid examples and common mistakes: whatever zod 3 said, zod 4 says.
const ODD = [
  "name/surname@example.com",
  "admin@example",
  '" "@example.org',
  '"john..doe"@example.org',
  "mailhost!username@example.org",
  "user%example.com@example.org",
  "postmaster@[123.123.123.123]",
  "postmaster@[IPv6:2001:0db8:85a3:0000:0000:8a2e:0370:7334]",
  "_test@[IPv6:2001:0db8:85a3:0000:0000:8a2e:0370:7334]",
  "abc.example.com",
  "a@b@c@example.com",
  'a"b(c)d,e:f;g<h>i[j\\k]l@example.com',
  'just"not"right@example.com',
  'this is"not\\allowed@example.com',
  "i.like.underscores@but_they_are_not_allowed_in_this_part",
  "QA[icon]CHOCOLATE[icon]@test.com",
  "kd@gmail",
  "kd@gmail..com",
  ".kd@gmail.com",
  "kd.@gmail.com",
  "kd..d@gmail.com",
  "kd@-gmail.com",
  "kd@gmail.c",
  "kd @gmail.com",
  "kd@gmaïl.com",
  "dörte@example.de",
  "kd@xn--bcher-kva.example",
  "",
  "@gmail.com",
  "kd@",
  `${"a".repeat(64)}@${"b".repeat(185)}.com`,
  `${"a".repeat(64)}@${"b".repeat(186)}.com`,
];

describe("a sign-in address on zod 4", () => {
  it.each(EVERYDAY)("%s still signs in", (address) => {
    const send = sendCodeRequestSchema.safeParse({ email: address });
    const verify = verifyCodeRequestSchema.safeParse({ email: address, code: "123456" });
    expect(send.success && verify.success).toBe(true);
    expect(send.data?.email).toBe(address.trim().toLowerCase());
  });

  it.each([...EVERYDAY, ...ODD])("%s reads as it did on zod 3", (address) => {
    const before = zod3SignIn.safeParse(address);
    const now = sendCodeRequestSchema.safeParse({ email: address });
    expect(now.success).toBe(before.success);
    if (before.success) expect(now.data?.email).toBe(before.data);
  });
});

describe("ids on zod 4", () => {
  const entryId = bodyMeasurementInputSchema.shape.id;
  // Postgres's gen_random_uuid() and crypto.randomUUID() (version 4), a migrated row's uuidv5,
  // and an id in capitals, which the entry keeps in small letters.
  const APP_IDS = [
    "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c",
    "886313e1-3b8a-5372-9b90-0c9aee199e5d",
    "0f8fad5b-d9cb-469f-a165-70867728950e",
    "7C9E6679-7425-40DE-944B-E07FC1F90AE7",
  ];

  it.each(APP_IDS)("%s is read, in small letters", (id) => {
    expect(entryId.parse(id)).toBe(id.toLowerCase());
  });

  // The one change zod 4 makes to ids: a made-up one that names no uuid version is refused.
  it.each(["11111111-1111-1111-1111-111111111111", "3f2b8c1e-9a4d-4e7b-cc2a-1d5e6f7a8b9c"])("%s is refused", (id) => {
    expect(entryId.safeParse(id).success).toBe(false);
  });
});

describe("a change to a body measurement on zod 4", () => {
  it("a change to the weight alone leaves the other measurements out", () => {
    const parsed = patchBodyMeasurementSchema.parse({ weightKg: 70.5 });
    expect(parsed).toEqual({ weightKg: 70.5 });
    expect("metrics" in parsed).toBe(false);
  });

  it("an empty change is still refused", () => {
    expect(patchBodyMeasurementSchema.safeParse({}).success).toBe(false);
  });
});
