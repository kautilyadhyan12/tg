// SENTENCES EVERY KIND OF BUSINESS READS THE SAME (ROADMAP 5f-iii). These are written once,
// for a gym, a box and three kinds of studio alike, so none may call the place a gym: a
// Pilates studio's client told "Ask the gym's owner" reads a sentence about somebody else.
// The app's own name, AI Home Gym, is the one "Gym" allowed.
import { describe, expect, it } from "vitest";
import {
  CHECKIN_WORDS,
  CHECK_FIRST_OPTIONS,
  CLASS_ONLINE_WORDS,
  GYM_POST_WORDS,
  INVITATION_WORDS,
  LEAD_EMAIL_SETTINGS_WORDS,
  LEAD_WORDS,
  MEMBER_LIST_UPLOAD_GONE_WORDS,
  MEMBER_TAGS_WORDS,
  PT_NOT_ON_LIST_WORDS,
  PT_RECORD_SHARED_WORDS,
  leadFileWarningSchema,
  leadFileWarningWords,
  memberListReviewProblemSchema,
  memberListReviewShortWords,
  memberListReviewWords,
  memberListWarningSchema,
  memberListWarningWords,
  type LeadFileWarning,
  type MemberListWarning,
} from "../src/index.js";

const strings = (words: Readonly<Record<string, unknown>>): string[] =>
  Object.values(words).filter((w): w is string => typeof w === "string");

/** Every field a warning of any code may read, so each code's sentence is drawn whole. */
const filled = { rows: 2, columns: 3, sheets: ["Old members"], values: ["frontdesk@example.com"] };

/** A union member's codes: one for a literal, several for an enum of codes. */
const codesOf = (code: { options: readonly string[] } | { value: string }): readonly string[] =>
  "options" in code ? code.options : [code.value];

const sentences: [string, string][] = [
  ...strings(CHECKIN_WORDS).map((s): [string, string] => ["check-in", s]),
  ...strings(CLASS_ONLINE_WORDS).map((s): [string, string] => ["online class", s]),
  ["invitation", INVITATION_WORDS.no_invitation("sam@example.com")],
  ["safe mode", CHECK_FIRST_OPTIONS.not_yet.detail],
  ...strings(LEAD_EMAIL_SETTINGS_WORDS).map((s): [string, string] => ["lead emails", s]),
  ...strings(LEAD_WORDS).map((s): [string, string] => ["leads", s]),
  ...strings(MEMBER_LIST_UPLOAD_GONE_WORDS).map((s): [string, string] => ["upload", s]),
  ...strings(MEMBER_TAGS_WORDS).map((s): [string, string] => ["tags", s]),
  ...strings(GYM_POST_WORDS).map((s): [string, string] => ["posts", s]),
  ["personal training", PT_NOT_ON_LIST_WORDS],
  ["personal training", PT_RECORD_SHARED_WORDS],
  ...memberListReviewProblemSchema.options.flatMap((p): [string, string][] => [
    [`review ${p}`, memberListReviewWords(p, "email")],
    [`review ${p}`, memberListReviewWords(p, "phone")],
    [`review ${p}`, memberListReviewShortWords(p)],
  ]),
  ...memberListWarningSchema.options.flatMap((o) => codesOf(o.shape.code)).map((code): [string, string] => [
    `member file ${code}`,
    memberListWarningWords({ code, ...filled } as unknown as MemberListWarning),
  ]),
  ...leadFileWarningSchema.options.flatMap((o) => codesOf(o.shape.code)).map((code): [string, string] => [
    `lead file ${code}`,
    leadFileWarningWords({ code, ...filled } as unknown as LeadFileWarning),
  ]),
];

describe("sentences every kind of business reads", () => {
  it("reads a sentence from every place it covers", () => {
    expect(sentences.length).toBeGreaterThan(60);
  });

  it.each(sentences)("%s: never calls the place a gym, and is whole: %s", (_where, sentence) => {
    expect(sentence.replaceAll("AI Home Gym", "")).not.toMatch(/\bgyms?\b|gym['’]s/i);
    expect(sentence).not.toMatch(/undefined|null|NaN|\[object/);
    expect(sentence.trim()).not.toBe("");
  });

  it("tells the front desk's own details apart from a person's, without the gym", () => {
    expect(memberListReviewWords("front_desk", "email")).toBe("The file had the front desk's email here, so it was left out. Add their own email.");
    expect(memberListReviewShortWords("front_desk")).toBe("the front desk's, left out");
  });
});
