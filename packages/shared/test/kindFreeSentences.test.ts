// SENTENCES EVERY KIND OF BUSINESS READS THE SAME (ROADMAP 5f-iii). These are written once,
// for a gym, a box and three kinds of studio alike, so none may call the place a gym: a
// Pilates studio's client told "Ask the gym's owner" reads a sentence about somebody else.
// The app's own name, AI Home Gym, and "gym or studio" (said where no business is known yet)
// are the only "gym" allowed.
import { describe, expect, it } from "vitest";
import * as shared from "../src/index.js";
import {
  CHECK_FIRST_OPTIONS,
  leadFileWarningSchema,
  leadFileWarningWords,
  memberListReviewProblemSchema,
  memberListReviewShortWords,
  memberListReviewWords,
  memberListWarningSchema,
  memberListWarningWords,
  orgTypeSchema,
  ptNotOnListWords,
  type LeadFileWarning,
  type MemberListWarning,
} from "../src/index.js";

/** Every string an exported word set holds, a sentence-making function's answer included
 *  (called with a name and a Pilates studio's kind, which is what they take). */
function sentencesOf(value: unknown, where: string, out: [string, string][]): void {
  if (typeof value === "string") out.push([where, value]);
  else if (typeof value === "function") {
    let said: unknown;
    try {
      said = (value as (...args: unknown[]) => unknown)("Sam Lee", "pilates_studio");
    } catch {
      return;
    }
    if (typeof said === "string") out.push([where, said]);
  } else if (value !== null && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) sentencesOf(inner, `${where}.${key}`, out);
  }
}

/** The word sets that are a gym's on purpose, each with its reason. */
const A_GYMS_OWN = new Set([
  // Personal training's words with a gym's kind, kept for the phone app; every screen and the
  // server call ptWords(orgType) / ptMemberWords(orgType), which this file reads below.
  "PT_WORDS",
  "PT_MEMBER_WORDS",
  "PT_NOT_ON_LIST_WORDS",
  // Not sentences: the cell values an import reads as "nothing here".
  "NO_VALUE_WORDS",
]);

/** Every field a warning of any code may read, so each code's sentence is drawn whole. */
const filled = { rows: 2, columns: 3, sheets: ["Old members"], values: ["frontdesk@example.com"] };

/** A union member's codes: one for a literal, several for an enum of codes. */
const codesOf = (code: { options: readonly string[] } | { value: string }): readonly string[] =>
  "options" in code ? code.options : [code.value];

const sentences: [string, string][] = [];
for (const [name, value] of Object.entries(shared)) {
  if (name.endsWith("_WORDS") && !A_GYMS_OWN.has(name)) sentencesOf(value, name, sentences);
}
sentences.push(["safe mode", CHECK_FIRST_OPTIONS.not_yet.detail]);
for (const kind of orgTypeSchema.options) sentences.push([`personal training, ${kind}`, ptNotOnListWords(kind)]);
for (const p of memberListReviewProblemSchema.options) {
  sentences.push([`review ${p}`, memberListReviewWords(p, "email")], [`review ${p}`, memberListReviewWords(p, "phone")], [`review ${p}`, memberListReviewShortWords(p)]);
}
for (const code of memberListWarningSchema.options.flatMap((o) => codesOf(o.shape.code))) {
  sentences.push([`member file ${code}`, memberListWarningWords({ code, ...filled } as unknown as MemberListWarning)]);
}
for (const code of leadFileWarningSchema.options.flatMap((o) => codesOf(o.shape.code))) {
  sentences.push([`lead file ${code}`, leadFileWarningWords({ code, ...filled } as unknown as LeadFileWarning)]);
}

describe("sentences every kind of business reads", () => {
  it("reads every exported word set, among them the ones this job changed", () => {
    const sets = new Set(sentences.map(([where]) => where.split(".")[0]));
    for (const name of ["CHECKIN_WORDS", "CLASS_ONLINE_WORDS", "INVITATION_WORDS", "LEAD_EMAIL_SETTINGS_WORDS", "LEAD_WORDS", "MEMBER_LIST_UPLOAD_GONE_WORDS", "MEMBER_TAGS_WORDS", "MEMBER_NOTES_WORDS", "GYM_POST_WORDS", "PT_RECORD_SHARED_WORDS"]) {
      expect(sets.has(name), name).toBe(true);
    }
    expect(sentences.length).toBeGreaterThan(300);
  });

  it.each(sentences)("%s: never calls the place a gym, and is whole: %s", (_where, sentence) => {
    // "{gym}" is filled with the business's own name before it is shown.
    expect(sentence.replaceAll("AI Home Gym", "").replaceAll("gym or studio", "").replaceAll("{gym}", "")).not.toMatch(/\bgyms?\b|gym['’]s/i);
    expect(sentence).not.toMatch(/undefined|null|\[object|NaN/);
    expect(sentence.trim()).not.toBe("");
  });

  it("tells the front desk's own details apart from a person's, without the gym", () => {
    expect(memberListReviewWords("front_desk", "email")).toBe("The file had the front desk's email here, so it was left out. Add their own email.");
    expect(memberListReviewShortWords("front_desk")).toBe("the front desk's, left out");
  });

  it("names a Pilates studio's people on Personal training's list line", () => {
    expect(ptNotOnListWords("pilates_studio")).toBe("You haven't been added to the client list here yet. Ask at the front desk.");
    expect(ptNotOnListWords("gym")).toBe("You haven't been added to the member list here yet. Ask at the front desk.");
  });
});
