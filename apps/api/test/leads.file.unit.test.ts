// Leads from a file — the pure parts (ROADMAP 20c-iii): where a lead heard of the gym
// from a file's own word, who in a file is added, and a file read as leads.
//
// The words and headings come from OUTSIDE this code: the vendors' own pages, read
// 2026-09-27 — ABC GymSales (the CSV uploader, "Contact Method" values), Glofox (the
// Lead Report), ClubReady (the bulk upload template), Wodify (its default lead
// sources), Gymdesk, TeamUp, HubSpot (traffic sources), PushPress ("Referred by") —
// and include words none of them use.
import { describe, expect, it } from "vitest";
import type { LeadFileRow, LeadFileUnderstanding, LeadSource } from "@app/shared";
import { understandLeadGrid } from "../src/modules/orgs/leads/leadFile.js";
import { leadFilePlan, planKey } from "../src/modules/orgs/leads/filePlan.js";
import { sourceOfWord } from "../src/modules/orgs/leads/sourceWords.js";
import { openTextFile } from "../src/modules/orgs/memberList/openFile.js";

describe("where a lead heard of the gym, from the file's word", () => {
  const cases: [string, LeadSource, string][] = [
    // Our own five, as the screen writes them.
    ["Walked in", "walk_in", "ours"],
    ["Website", "website", "ours"],
    ["Social media", "social", "ours"],
    ["A friend", "friend", "ours"],
    ["Other", "other", "ours"],
    // ABC GymSales' fixed Contact Method list.
    ["Referral", "friend", "GymSales"],
    ["Phone-in", "other", "GymSales"],
    ["Walk-in", "walk_in", "GymSales"],
    ["Internet", "website", "GymSales"],
    ["Guest Visit", "other", "GymSales"],
    ["Outreach", "other", "GymSales"],
    ["Corporate", "other", "GymSales"],
    ["Ex Member", "other", "GymSales"],
    ["Renewal", "other", "GymSales"],
    // Wodify's default lead sources.
    ["Friend/Family", "friend", "Wodify"],
    ["Facebook", "social", "Wodify"],
    ["Google/Search Engine", "website", "Wodify"],
    ["SMS (US only)", "other", "Wodify"],
    ["Online Sales", "website", "Wodify"],
    // TeamUp's examples, Gymdesk's prose, PushPress' values.
    ["Instagram", "social", "TeamUp"],
    ["walk-ins", "walk_in", "Gymdesk"],
    ["referrals", "friend", "Gymdesk"],
    ["social media", "social", "Gymdesk"],
    ["Google", "website", "PushPress"],
    // HubSpot's traffic sources, where a "referral" is another website.
    ["Organic search", "website", "HubSpot"],
    ["Paid search", "website", "HubSpot"],
    ["Organic social", "social", "HubSpot"],
    ["Paid social", "social", "HubSpot"],
    ["AI Referrals", "website", "HubSpot"],
    ["Direct traffic", "website", "HubSpot"],
    ["Email marketing", "other", "HubSpot"],
    ["Other campaigns", "other", "HubSpot"],
    ["Offline sources", "other", "HubSpot"],
    // Words none of the lists has: Other, never a guess.
    ["Flyer", "other", "unknown"],
    ["Radio ad", "other", "unknown"],
    ["ClassPass", "other", "unknown"],
    ["Groupon", "other", "unknown"],
    ["Yelp", "other", "unknown"],
    ["Billboard", "other", "unknown"],
    ["Instagrammer", "other", "a longer word is not the word"],
    ["Webinar", "other", "a longer word is not the word"],
    ["Figaro", "other", "holds 'ig' only inside a word"],
    // Two at once: the first in the order (friend, walk-in, social, website).
    ["Friend on Facebook", "friend", "two"],
    ["Saw it on Instagram, then walked in", "walk_in", "two"],
    // Case, accents and punctuation do not matter.
    ["INSTAGRAM", "social", "case"],
    ["  word-of-mouth ", "friend", "punctuation"],
    ["Facebook Ad", "social", "ads"],
    ["Google Ads", "website", "ads"],
    ["", "other", "empty"],
    ["   ", "other", "blank"],
  ];
  it.each(cases)("%s → %s (%s)", (word, source) => {
    expect(sourceOfWord(word)).toBe(source);
  });
});

const row = (over: Partial<LeadFileRow> & { row: number; fullName: string }): LeadFileRow => ({
  email: null,
  phone: null,
  source: "other",
  sourceWord: null,
  notes: "",
  ...over,
});

describe("who in a file is added", () => {
  const leads = [{ email: "Kept@Example.com", phone: null }, { email: null, phone: "+447700900001" }];
  const members = [
    { fullName: "Kate Moss", email: "family@example.com", phone: null },
    { fullName: "Zoë Adams", email: null, phone: "+447700900002" },
    { fullName: "", email: "noname@example.com", phone: null },
  ];
  const cases: { name: string; row: LeadFileRow; to: "add" | "alreadyLead" | "alreadyMember" }[] = [
    { name: "a lead's email, another case", row: row({ row: 2, fullName: "Anyone", email: "kept@example.com" }), to: "alreadyLead" },
    { name: "a lead's phone", row: row({ row: 2, fullName: "Anyone", phone: "+447700900001" }), to: "alreadyLead" },
    { name: "a lead's phone and a new email", row: row({ row: 2, fullName: "Anyone", email: "new@example.com", phone: "+447700900001" }), to: "alreadyLead" },
    { name: "a member's email and name", row: row({ row: 2, fullName: "kate moss", email: "family@example.com" }), to: "alreadyMember" },
    { name: "a member's phone and name, accent folded", row: row({ row: 2, fullName: "Zoe Adams", phone: "+447700900002" }), to: "alreadyMember" },
    { name: "a member's email, ANOTHER name (her son)", row: row({ row: 2, fullName: "Max Moss", email: "family@example.com" }), to: "add" },
    { name: "a member's name, another email", row: row({ row: 2, fullName: "Kate Moss", email: "kate@example.com" }), to: "add" },
    { name: "a nameless member's email", row: row({ row: 2, fullName: "Nora Lee", email: "noname@example.com" }), to: "add" },
    { name: "nobody's details", row: row({ row: 2, fullName: "New Person", email: "new.person@example.com" }), to: "add" },
  ];
  it.each(cases)("$name → $to", ({ row: one, to }) => {
    const plan = leadFilePlan([one], leads, members);
    expect(plan[to]).toEqual([one]);
    expect(plan.add.length + plan.alreadyLead.length + plan.alreadyMember.length + plan.twiceInFile.length).toBe(1);
  });

  it("one lead per email and per phone: a later row that repeats one added is twice in the file", () => {
    const a = row({ row: 2, fullName: "Ann Bell", email: "ann@example.com", phone: "+447700900010" });
    const sameEmail = row({ row: 3, fullName: "Ann B", email: "ANN@example.com" });
    const samePhone = row({ row: 4, fullName: "Other Ann", phone: "+447700900010" });
    const plan = leadFilePlan([a, sameEmail, samePhone], [], []);
    expect(plan.add).toEqual([a]);
    expect(plan.twiceInFile).toEqual([
      { row: sameEmail, sameAs: "Ann Bell" },
      { row: samePhone, sameAs: "Ann Bell" },
    ]);
  });

  it("a row not added does not claim its address: the son after his member mother is added", () => {
    const mother = row({ row: 2, fullName: "Kate Moss", email: "family@example.com" });
    const son = row({ row: 3, fullName: "Max Moss", email: "family@example.com" });
    const plan = leadFilePlan([mother, son], [], members);
    expect(plan.alreadyMember).toEqual([mother]);
    expect(plan.add).toEqual([son]);
  });

  it("the key names exactly what is added: any written field changed gives another", () => {
    const base = [row({ row: 2, fullName: "Ann Bell", email: "ann@example.com", source: "social", notes: "hi" })];
    const key = planKey(base);
    expect(planKey([...base])).toBe(key);
    for (const changed of [
      { fullName: "Ann Bel" },
      { email: "ann2@example.com" },
      { phone: "+447700900011" },
      { source: "friend" as const },
      { notes: "hi!" },
    ]) {
      expect(planKey([{ ...base[0], ...changed } as LeadFileRow])).not.toBe(key);
    }
    expect(planKey([])).not.toBe(key);
    // The row number is not written, so it is not in the key.
    expect(planKey([{ ...(base[0] as LeadFileRow), row: 9 }])).toBe(key);
  });
});

const read = (lines: string[], mapping: LeadFileUnderstanding["mapping"] | null = null): LeadFileUnderstanding => {
  const grid = openTextFile(Buffer.from(lines.join("\r\n") + "\r\n", "utf8"));
  if (!grid.ok) throw new Error(`file refused: ${grid.refusal.code}`);
  const result = understandLeadGrid(grid, { country: "GB", mapping });
  if (!result.ok) throw new Error(`leads refused: ${result.refusal.code}`);
  return result;
};

describe("a leads file read as leads", () => {
  it("Glofox's Lead Report: names, contact and Lead Source; its status and opt-in column are not read", () => {
    const file = read([
      "First Name,Last Name,Email,Phone,Gender,Date of Birth,Zip Code,Lead Source,Last Contacted,Total Bookings,Total Attendances,Lead Status,Membership Name,Membership Plan,Membership Expiry Date,Credits Remaining,Opted to Receive Marketing,Studio Waiver",
      "Asha,Rao,asha@example.com,07700900101,Female,1990-04-02,LS1 4AP,Instagram,,0,0,Cold,,,,0,Yes,",
    ]);
    const guessed: Record<string, string | null> = Object.fromEntries(file.columns.filter((c) => c.guess !== null).map((c) => [c.header ?? "", c.guess]));
    expect(guessed).toEqual({ "First Name": "firstName", "Last Name": "lastName", Email: "email", Phone: "phone", "Lead Source": "source" });
    expect(file.rows).toEqual([
      { row: 2, fullName: "Asha Rao", email: "asha@example.com", phone: "+447700900101", source: "social", sourceWord: "Instagram", notes: "Heard of you from: Instagram" },
    ]);
  });

  it("ABC GymSales' uploader: Marketing Source before Contact Method, and its Notes", () => {
    const file = read([
      "First Name,Last Name,Mobile Phone,Home Phone,Work Phone,Email,Address,City,State/Prov,Zip/Postal,Tags,Notes,Marketing Source,Contact Method,Created Date,Status,Salesperson,Trial Start Date,Trial End Date,Sale At,External ID,SMS Opted Out,Email Opted Out,WhatsApp Opted Out",
      "Dev,Iyer,07700900104,,,dev@example.com,1 High St,Leeds,,LS1,vip,Wants mornings,Facebook,Walk-in,2026-09-01,Enquiry,Sam,,,,X1,false,false,false",
    ]);
    const at = (header: string) => file.columns.find((c) => c.header === header)?.guess ?? null;
    expect(at("Marketing Source")).toBe("source");
    expect(at("Contact Method")).toBeNull();
    expect(at("Notes")).toBe("notes");
    expect(at("External ID")).toBeNull();
    expect(file.rows[0]).toMatchObject({ fullName: "Dev Iyer", source: "social", notes: "Wants mornings\nHeard of you from: Facebook" });
  });

  it("ClubReady's template: Key Note is the notes and Lead Source the source", () => {
    const file = read([
      "Converted ID,Last Name,First Name,Gender,Email,Barcode,DOB,Emergency Contact,Emergency Phone,Prospect Added Date,Key Note,Lead Source,Assigned To",
      "C1,Bell,Ann,F,ann@example.com,123,,Bob Bell,07700900999,2026-09-01,Tour booked,Referral,Sam",
    ]);
    const at = (header: string) => file.columns.find((c) => c.header === header)?.guess ?? null;
    expect(at("Key Note")).toBe("notes");
    expect(at("Lead Source")).toBe("source");
    // The emergency contact's number is never the lead's.
    expect(at("Emergency Phone")).toBeNull();
    expect(file.rows[0]).toMatchObject({ fullName: "Ann Bell", phone: null, source: "friend", notes: "Tour booked\nHeard of you from: Referral" });
  });

  it("a card number inside a note is taken out; a column of cards is never the source", () => {
    const file = read(["Name,Email,Source,Notes", "Ann Bell,ann@example.com,4111 1111 1111 1111,Paid with 4111 1111 1111 1111 today"]);
    expect(file.columns.find((c) => c.header === "Source")).toMatchObject({ guess: null, neverKept: "payment_card", samples: [] });
    expect(file.rows[0]).toMatchObject({ source: "other", sourceWord: null, notes: "Paid with [card number removed] today" });
    expect(file.warnings).toContainEqual({ code: "card_cells_dropped", rows: 1 });
  });

  it("a card on its own in the source cell of an ordinary source column is dropped, the rest kept", () => {
    const file = read(["Name,Email,Lead Source", "Ann Bell,ann@example.com,4111 1111 1111 1111", "Bo Cox,bo@example.com,Instagram", "Cy Dent,cy@example.com,Walk in"]);
    expect(file.mapping.source).toBe(2);
    expect(file.rows.map((r) => [r.fullName, r.source, r.notes])).toEqual([
      ["Ann Bell", "other", ""],
      ["Bo Cox", "social", "Heard of you from: Instagram"],
      ["Cy Dent", "walk_in", "Heard of you from: Walk in"],
    ]);
    expect(file.warnings).toContainEqual({ code: "card_cells_dropped", rows: 1 });
  });

  it("a note longer than a lead keeps is cut and said so, the source line included", () => {
    const long = read(["Name,Email,Notes", `Ann Bell,ann@example.com,${"x".repeat(2100)}`]);
    expect(long.rows[0]?.notes).toHaveLength(2000);
    expect(long.warnings).toContainEqual({ code: "notes_cut", rows: 1 });
    const withSource = read(["Name,Email,Notes,Source", `Ann Bell,ann@example.com,${"x".repeat(1990)},Instagram`]);
    expect(withSource.rows[0]?.notes).toHaveLength(2000);
    expect(withSource.warnings).toContainEqual({ code: "notes_cut", rows: 1 });
    const fits = read(["Name,Email,Notes", `Ann Bell,ann@example.com,${"x".repeat(1999)}`]);
    expect(fits.warnings).toEqual([]);
  });

  it("no name, no contact and the same person twice are not added, and each is named with its row", () => {
    const file = read(["Name,Email", "Ann Bell,ann@example.com", "Ann Bell,ann@example.com", ",nobody@example.com", "Cy Dent,"]);
    expect(file.rows.map((r) => r.fullName)).toEqual(["Ann Bell"]);
    expect(file.counts).toEqual({ dataRows: 4, noContact: 1, noName: 1, twiceInFile: 1 });
    expect(file.skipped).toEqual([
      { row: 3, fullName: "Ann Bell", reason: "same_person" },
      { row: 4, fullName: "", reason: "no_name" },
      { row: 5, fullName: "Cy Dent", reason: "no_contact" },
    ]);
  });

  it("a file with no email or phone column asks staff to choose, and reads nothing until they do", () => {
    const file = read(["Nom,Origine", "Ann Bell,Instagram"]);
    expect(file.needsMapping).toBe(true);
    expect(file.rows).toEqual([]);
  });

  it("staff's own mapping is used as sent; a column past the sheet is dropped", () => {
    const file = read(["A,B,C", "Ann Bell,ann@example.com,Walk in"], {
      sheet: null,
      headerRow: 0,
      fullName: 0,
      firstName: null,
      lastName: null,
      email: [1],
      phone: [],
      source: 2,
      notes: 40,
    });
    expect(file.mapping.notes).toBeNull();
    expect(file.rows[0]).toMatchObject({ fullName: "Ann Bell", source: "walk_in", notes: "Heard of you from: Walk in" });
  });
});
