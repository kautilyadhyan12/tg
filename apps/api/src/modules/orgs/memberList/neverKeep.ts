// What is NEVER kept from a gym's file, whatever the gym wants (spec Part 3
// §11.2): payment card numbers, bank account details, government ID numbers,
// passwords, PINs and door codes, and medical notes.
//
// **THE ORDER OF THE TWO KINDS OF RULE IS THE WHOLE POINT** (CLAUDE.md §4, "the
// worst thing"). Wherever a number carries a CHECK of its own — a payment card,
// an IBAN, an Aadhaar, a Canadian SIN — that check is what decides, in a column
// called anything at all, because a heading is the one thing a gym's own export
// is free to write however it likes. The word lists below are the backstop for
// what has no check (a password, a doctor's note), never the mechanism.
//
// And a check is only trusted where it MEANS something. Measured here on
// 2026-09-22: 7,269 of 100,000 made-up twelve-digit runs pass Aadhaar's
// Verhoeff check. One such cell proves nothing, and a gym's twelve-digit member
// numbers would be thrown away for it: every
// shape here but the payment card is asked of a COLUMN — most of its cells, or
// its heading — never of one cell alone. A payment card is the exception the
// spec names, and is dropped cell by cell wherever it sits.
//
// Nothing here runs on the request's own thread. It runs inside the file worker
// (`understand.ts`), so a dropped cell never reaches the API process at all,
// let alone a log line, an error reply or Sentry.
import {
  MEMBER_LIST_NEVER_KEEP_SHARE,
  type MemberListNeverKeptReason,
} from "@app/shared";
import { digitCount } from "./cells.js";
import { holdsWord, holdsWordExactly, isWord, normaliseHeader } from "./headerWords.js";

/** The longest word below that is an ABBREVIATION rather than a word: PAN, TIN,
 *  FIN, SSN, SIN, GST, TFN, IRD, PPS, SSS, BIC, ABA, BSB, ACH, UPI, VPA, OTP,
 *  CVV, ZIP, GP. */
const LONGEST_ABBREVIATION = 3;

/** Whether a heading holds a never-keep word, counting the plural — except for
 *  the abbreviations, where a trailing "s" makes a different word entirely
 *  (re-check of PR #90): "Fins" is not Singapore's FIN, "GPS Watch" is not a
 *  doctor, "Pans" is not India's PAN and "Tins" is not a tax number. The plural
 *  still counts for every real word ("Passports", "Bank Accounts", "Medical
 *  Conditions"), which is what Critical 2 was about. */
const holdsTerm = (header: string, word: string): boolean =>
  word.length <= LONGEST_ABBREVIATION ? holdsWordExactly(header, word) : holdsWord(header, word);

// ---------------------------------------------------------------------------
// Numbers that check themselves
// ---------------------------------------------------------------------------

/** Whether a run of digits is shaped like a payment card: the length of one and
 *  the check digit of one (Luhn's). Gym software calls a member's door fob a
 *  "card number", so that heading is read as a member number — but an export
 *  whose "Card Number" really is a bank card must not leave its digits in our
 *  list. A member number is shown on a screen and matched on; it is never worth
 *  holding somebody's card for. A number that only LOOKS like a card is dropped
 *  too: the person keeps their name, email and phone, and nothing is lost that
 *  a gym cannot type again. */
export function looksLikeAPaymentCard(text: string): boolean {
  if (!/^[0-9]{13,19}$/.test(text)) return false;
  let sum = 0;
  for (let i = 0; i < text.length; i++) {
    const digit = Number(text[text.length - 1 - i]);
    const doubled = i % 2 === 1 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

/** The longest cell worth looking at for a card number: nineteen digits, and
 *  room for the spaces or dashes a person types between them. Anything longer
 *  is a sentence, and is never scanned — this rule is asked of every cell of
 *  every column of ten thousand rows. */
const MOST_CARD_CELL_CHARS = 24;
/** Digits, spaces and dashes only: what a card number is ever written with. */
const CARD_CELL = /^[0-9 \u2010-\u2015-]+$/;

/** Whether one cell, wherever it sits, is a payment card number (§11.2). The
 *  spaces and dashes a person writes between the groups are taken out first;
 *  nothing else is, so `4111-1111-1111-1111 (Visa)` is a note and not a card —
 *  it is caught, if at all, by the column around it. */
export function cardShapedCell(text: string): boolean {
  if (text.length < 13 || text.length > MOST_CARD_CELL_CHARS) return false;
  if (!CARD_CELL.test(text)) return false;
  return looksLikeAPaymentCard(text.replace(/[^0-9]/g, ""));
}

/** WHAT A CARD NUMBER LEAVES BEHIND when one is found inside other text. A marker and
 *  not an empty string, so a gym reading its own note can see that something was taken
 *  out rather than wondering what it once said. */
export const CARD_REDACTED = "[card number removed]";

/** A RUN OF DIGITS WITH THE SEPARATORS A PERSON WRITES BETWEEN THEM — spaces and the
 *  several kinds of dash — anywhere in a cell. A run may not begin or end on one. */
const CARD_RUN = /[0-9](?:[0-9 \u2010-\u2015-]*[0-9])?/g;
/** The separators, for splitting a run into the GROUPS a card is written in. */
const CARD_SEPARATORS = /[ \u2010-\u2015-]+/;

/** A CELL WITH THE PAYMENT CARD NUMBERS INSIDE IT TAKEN OUT, and how many went (§11.2).
 *
 *  **`cardShapedCell` ASKS WHETHER A CELL *IS* A CARD; THIS ASKS WHETHER ONE IS IN IT**,
 *  which is how a gym actually writes one down (round one, High-4). A free-text "Notes"
 *  column reading `Card on file 4111 1111 1111 1111 (Visa)` is not a column of card
 *  numbers, so the column rule leaves it; it is not a card-shaped cell, so the cell rule
 *  left it too — and a live Visa number sat in the database under a member's name.
 *  §11.2's sentence is "13 to 19 digits … that pass the card check digit — in ANY
 *  column", and a cell that CONTAINS one is the common shape.
 *
 *  **JUST THE RUN IS TAKEN OUT, NEVER THE WHOLE CELL**, and that is what makes this
 *  affordable. The recorded objection to widening the rule was that Luhn passes about
 *  one made-up digit run in ten, so a gym's long invoice number would blank a note it
 *  had written. Redacting the run alone leaves the note; what is lost in the rare false
 *  positive is a number, and what is gained in the true one is a card number never
 *  reaching our database. A lost invoice number is the smaller harm.
 *
 *  **THE SPANS TRIED ARE ALIGNED TO THE GROUPS A CARD IS WRITTEN IN**, which is what
 *  keeps this from being either too narrow or too greedy. Checking each whole run and
 *  nothing else misses `4111 1111 1111 1111 2024` — a card with a year after it is one
 *  run of twenty digits, and twenty is not a card. Checking EVERY window of 13 to 19
 *  digits instead would run about a hundred Luhn checks over a thirty-digit run and, at
 *  one in ten, shred almost any long number a gym keeps. A card is written in groups, so
 *  only spans of WHOLE groups are tried: `[4111][1111][1111][1111]` is found beside the
 *  year, while `07911 100001` offers spans of 5, 6 and 11 digits and none is a card. */
export function withoutCardNumbers(text: string): { text: string; removed: number } {
  if (text.length < 13) return { text, removed: 0 };
  let removed = 0;
  const out = text.replace(CARD_RUN, (run) => {
    const groups = run.split(CARD_SEPARATORS).filter((group) => group !== "");
    // Longest span first, so a card is taken out whole rather than a shorter span
    // inside it being redacted and the rest of its digits left in the cell.
    for (let width = groups.length; width >= 1; width--) {
      for (let at = 0; at + width <= groups.length; at++) {
        const digits = groups.slice(at, at + width).join("");
        if (digits.length < 13 || digits.length > 19) continue;
        if (!looksLikeAPaymentCard(digits)) continue;
        removed += 1;
        // What is around the span is the gym's own note and stays.
        const before = groups.slice(0, at).join(" ");
        const after = groups.slice(at + width).join(" ");
        return [before, CARD_REDACTED, after].filter((part) => part !== "").join(" ");
      }
    }
    return run;
  });
  return { text: out, removed };
}

/** An IBAN by its own check digits (ISO 13616): the country and check digits
 *  moved to the end, every letter written as two digits, the whole read as a
 *  number modulo 97, which must be 1. Nothing else is shaped like one. */
export function ibanShaped(text: string): boolean {
  const squashed = text.replace(/[\s\u2010-\u2015-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(squashed)) return false;
  const moved = squashed.slice(4) + squashed.slice(0, 4);
  // Taken a few characters at a time: the whole is far past a safe integer.
  let remainder = 0;
  for (const character of moved) {
    const value = character >= "A" && character <= "Z" ? String(character.charCodeAt(0) - 55) : character;
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Verhoeff's tables, which India's Aadhaar carries its check digit in. */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;

/** Whether a run of digits carries a valid Verhoeff check digit on its end. */
export function verhoeffValid(digits: string): boolean {
  let check = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    if (!Number.isInteger(digit)) return false;
    const permuted = VERHOEFF_P[i % 8]?.[digit];
    const next = permuted === undefined ? undefined : VERHOEFF_D[check]?.[permuted];
    if (next === undefined) return false;
    check = next;
  }
  return check === 0;
}

/** India's Aadhaar: twelve digits, never starting 0 or 1, with Verhoeff's check
 *  digit. About seven runs of twelve digits in a hundred pass by chance
 *  (measured 2026-09-22), which is why this is asked of a whole column and never
 *  of one cell on its own (see the file header). */
export function aadhaarShaped(text: string): boolean {
  const squashed = text.replace(/[\s\u2010-\u2015-]/g, "");
  if (!/^[2-9][0-9]{11}$/.test(squashed)) return false;
  return verhoeffValid(squashed);
}

/** India's PAN: five letters, four digits, one letter. */
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** The UK's National Insurance number. The two leading letters leave out the
 *  ones HMRC never issues (D, F, I, Q, U, V first; O second), which is what
 *  keeps an ordinary reference code from reading as one. */
const UK_NI = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z][0-9]{6}[A-D]$/;
/** A US Social Security number, written the one way it is written: three, two
 *  and four digits with dashes. Nine bare digits is a member number in half the
 *  world's gyms, so those are never read as one. The area, group and serial
 *  ranges the SSA has never issued are left out. */
const US_SSN = /^(?!000|666|9)([0-9]{3})-(?!00)([0-9]{2})-(?!0000)([0-9]{4})$/;
/** Canada's Social Insurance Number, in its written groups, with Luhn's check. */
const CANADA_SIN = /^([0-9]{3})[\s-]([0-9]{3})[\s-]([0-9]{3})$/;

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = Number(digits[digits.length - 1 - i]);
    const doubled = i % 2 === 1 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

/** Whether a cell carries a government ID number that says so by its own shape
 *  or check digit. Asked of a COLUMN's cells, never of one on its own. */
export function governmentIdShaped(text: string): boolean {
  const upper = text.toUpperCase().trim();
  const squashed = upper.replace(/\s/g, "");
  if (PAN.test(squashed) || UK_NI.test(squashed)) return true;
  if (US_SSN.test(upper)) return true;
  const sin = CANADA_SIN.exec(upper);
  if (sin !== null && luhnValid(upper.replace(/[^0-9]/g, ""))) return true;
  return aadhaarShaped(upper);
}

// ---------------------------------------------------------------------------
// Headings, the backstop
// ---------------------------------------------------------------------------
//
// Every word below was read on a real product's own help page or export
// template, not invented: Gymdesk's supported import fields (2026-09-22 —
// "Zip/Postal Code", "Medical Conditions", "Emergency Contacts (Name, Phone and
// Relationship)", "Check-in Code"), Gymdesk's payment-migration page (a token
// column and the "card or bank account holder name"), GymMaster's data-transfer
// page ("Tokenized billing details (e.g. credit card and bank details)", BSB),
// and the products already cited in `headerWords.ts`.

/** A postal code, in every word the English-speaking world writes it with
 *  (Wikipedia, "Postal code", read 2026-09-22: postcode, post code, PIN and ZIP
 *  Code; Ireland's is an Eircode; "postal code" is the usual Canadian term).
 *  Kd, 2026-09-22: this must hold for the United States, the United Kingdom,
 *  Australia, Canada, New Zealand and anywhere else, not India alone.
 *
 *  It is here because an ADDRESS must never be mistaken for a door code. Every
 *  one of these is kept, as one of the gym's own extra fields. */
const POSTCODE_WORDS = [
  "postcode",
  "post code",
  "postal code",
  "postal",
  "post zip",
  "zip",
  "zip code",
  "zipcode",
  "zip postal code",
  "postal zip code",
  "zip 4",
  "zip4",
  "pin code",
  "pincode",
  "pin codes",
  "eircode",
  "postal index",
  "postal index number",
];

/** A bare "PIN" is a postcode in India and a door code everywhere else, and no
 *  list of words can tell them apart — so the SHEET does. */
const BARE_PIN_WORDS = ["pin", "pin no", "pin number", "pin nos"];

/** The PLACE an address names. A heading that qualifies "PIN" with one of these
 *  — "Address PIN", "City PIN", "Area PIN" — is writing a postcode. */
const PLACE_WORDS = [
  "address",
  "address line",
  "street",
  "city",
  "town",
  "village",
  "suburb",
  "state",
  "province",
  "county",
  "country",
  "district",
  "area",
  "locality",
  "landmark",
  "road",
  "lane",
  "region",
];

/** The DWELLING an address ends at, which is a different thing and must not
 *  qualify a PIN (re-check of PR #90, Low B): nobody writes a postcode as
 *  "Flat PIN", while a flat's or a building's entry code is exactly that. They
 *  still count towards whether the SHEET carries an address, which is the
 *  question `ADDRESS_WORDS` was written for. */
const DWELLING_WORDS = ["house", "flat", "apartment", "building", "unit", "block", "door no", "house no", "flat no"];

/** Columns that say this sheet carries addresses, which is half of what makes a
 *  bare "PIN" a postcode (Gymdesk's own address fields: Street, City, State,
 *  Zip/Postal Code, Country). */
const ADDRESS_WORDS = [...PLACE_WORDS, ...DWELLING_WORDS];

/** Words that make a column a credential whatever else it says. A gym's door
 *  code is not a member's secret, but it is still a key, and §11.2 keeps keys
 *  out. `check in code`, `barcode`, `key tag` and `fob` are NOT here: they are
 *  the gym's own number for a member and `headerWords.ts` reads them as one. */
const PASSWORD_WORDS = [
  "password",
  "passwords",
  "passwd",
  "pass word",
  "passcode",
  "pass code",
  "secret",
  "security code",
  "security question",
  "security answer",
  "otp",
  "one time password",
  "cvv",
  "cvc",
  "door code",
  "door pin",
  "gate code",
  "gate pin",
  "keypad code",
  "lock code",
  "locker code",
  "locker pin",
  "key code",
  "alarm code",
  "access code",
  "access pin",
  "access card pin",
  "card pin",
  "entry code",
  "entry pin",
  "login",
  "credential",
  "credentials",
  "api key",
];

/** Bank details by heading, where the wording can mean nothing else. Every
 *  market the app is for has its own word for the same thing, and a list that
 *  held only one country's would keep the others' (Kd, 2026-09-22): the UK's
 *  sort code and BACS, the United States' routing/ABA and ACH, Australia's BSB
 *  and PayID, New Zealand's bank account, Canada's transit and institution
 *  numbers and Interac, Ireland and the rest of Europe's IBAN, BIC and SEPA,
 *  and India's IFSC and UPI. */
const BANK_WORDS = [
  "bank",
  "bank name",
  "bank account",
  "bank account number",
  "bank details",
  "iban",
  "swift",
  "bic",
  "sepa",
  "sort code",
  "sortcode",
  "bacs",
  "routing",
  "routing number",
  "aba",
  "bsb",
  "payid",
  "transit number",
  "transit no",
  "institution number",
  "institution no",
  "beneficiary account",
  "beneficiary name",
  "interac",
  "ifsc",
  "upi",
  "upi id",
  "vpa",
  "ach",
  "direct debit",
  "debit order",
  "mandate",
  "mandate id",
  "card holder",
  "cardholder",
  // A CARD's expiry only. A membership's "Expiry Date" is the end-or-renewal
  // date this same card reads (§11.1), and must never be thrown away as a bank
  // column — which is exactly what a bare "expiry date" here would do.
  "card expiry",
  "card expiry date",
  "card expires",
  "payment method id",
  "payment token",
  "cheque",
  "check number",
];

/** …and the wording that can ALSO be a gym's own number for a member, which is
 *  settled by whether the sheet carries bank columns at all. */
const BARE_ACCOUNT_WORDS = ["account number", "account no", "account nos", "a c no", "acct no", "acct number"];

/** Government ID by heading, for the ones whose numbers carry no check of
 *  their own. Again one line per market, not one country's (Kd, 2026-09-22):
 *  the United States' SSN and ITIN, Canada's SIN, the UK's National Insurance,
 *  Ireland's PPS number, Australia's Tax File Number and Medicare number, New
 *  Zealand's IRD number, Singapore's NRIC and FIN, the UAE's Emirates ID, the
 *  Philippines' SSS, and India's Aadhaar, PAN and voter ID — beside the passport
 *  and driving licence everybody has. A business's number (an ABN, a company
 *  registration) is deliberately NOT here: §11.2 is about a member's own ID,
 *  and a gym's corporate account may honestly need one. */
const GOVERNMENT_WORDS = [
  "aadhaar",
  "aadhar",
  "uidai",
  "pan",
  "pan card",
  "pan no",
  "pan number",
  "ssn",
  "social security",
  "social security number",
  "itin",
  "sin",
  "social insurance",
  "pps",
  "pps number",
  "pps no",
  "ppsn",
  "tfn",
  "tax file number",
  "tax file no",
  "ird",
  "ird number",
  "ird no",
  "sss",
  "sss number",
  "nric",
  "fin",
  "national id",
  "national identity",
  "national insurance",
  "ni number",
  "ni no",
  "nino",
  "passport",
  "passport no",
  "passport number",
  "driving licence",
  "driving license",
  "drivers licence",
  "drivers license",
  "driver licence",
  "driver license",
  // `normaliseHeader` turns the apostrophe of "Driver's License" into a space.
  "driver s licence",
  "driver s license",
  "licence no",
  "license no",
  "licence number",
  "license number",
  "tax id",
  "tax number",
  "tin",
  "gst",
  "gstin",
  "voter id",
  "ration card",
  "identity card",
  "identity number",
  "identity no",
  "identity proof",
  "id proof",
  "govt id",
  "government id",
  "emirates id",
  "medicare",
  "medicare number",
];

/** Medical and health notes by heading (§11.2, and Kd's health rules: the app
 *  holds no medical detail at all). Gymdesk's import DOES take "Medical
 *  Conditions"; ours never will. */
const MEDICAL_WORDS = [
  "medical",
  "medical condition",
  "medical conditions",
  "medical notes",
  "medical history",
  "health",
  "health condition",
  "health conditions",
  "health notes",
  "condition",
  "conditions",
  "injury",
  "injuries",
  "allergy",
  "allergies",
  "allergen",
  "allergens",
  "medication",
  "medications",
  "medicine",
  "prescription",
  "par q",
  "parq",
  "disability",
  "disabilities",
  "doctor",
  "gp",
  "physician",
  "diagnosis",
  "illness",
  "disease",
  "surgery",
  "blood group",
  "blood type",
  "blood pressure",
  "pregnant",
  "pregnancy",
  "diabetes",
  "diabetic",
  "asthma",
  "heart condition",
  "therapy",
  "physiotherapy",
  "treatment",
  "symptom",
  "symptoms",
  "vaccination",
  "immunisation",
  "immunization",
  "nhs number",
];

/** "Terms and Conditions" is not a medical condition, and a gym's waiver is a
 *  signature, not a diagnosis. Without this, the commonest column in a gym's
 *  own export would be thrown away as health data. */
const NOT_MEDICAL_WORDS = [
  "terms",
  "t c",
  "waiver",
  "agreement",
  "policy",
  "contract",
  "air conditioning",
  // A gym is a HEALTH CLUB, and a form's "Conditions Accepted" is a signature
  // (review of PR #90, Low 6): both were being thrown away with the words
  // "this looks like medical or health notes", which was false of each.
  "club",
  "accepted",
  "signed",
  "branch",
];

/** What the SHEET as a whole says, worked out once and handed to every column:
 *  the two facts that settle a heading no list of words can settle on its own. */
export interface SheetHints {
  /** Any column that is part of an address, which is half of what makes a bare
   *  "PIN" a postcode. */
  hasAddress: boolean;
  /** A column that already says in its own heading that it is the postcode —
   *  which is the OTHER half, and the one that was missing (review of PR #90,
   *  Critical 3). A US gym's sheet has "Zip Code" for the postcode, so a column
   *  headed "PIN" beside it is the door code and not a second postcode; without
   *  this, every such gym's door code was kept on every member. */
  hasPostcode: boolean;
  /** Any unmistakable bank column, which makes a bare "Account Number" a bank
   *  account rather than the gym's own number for a member. */
  hasBank: boolean;
}

/** The sheet's two facts, from its headings alone. */
export function sheetHints(headers: readonly (string | null)[]): SheetHints {
  let hasAddress = false;
  let hasPostcode = false;
  let hasBank = false;
  for (const raw of headers) {
    if (raw === null || raw === "") continue;
    const header = normaliseHeader(raw);
    // A bare "PIN" is not a postcode word, so a sheet whose postcode is a bare
    // PIN does not count as already having one — which is what lets an Indian
    // gym's "Address / City / PIN" keep its PIN while a US gym's
    // "Address / City / Zip Code / PIN" drops one.
    if (POSTCODE_WORDS.some((word) => holdsTerm(header, word))) {
      hasPostcode = true;
      hasAddress = true;
    } else if (ADDRESS_WORDS.some((word) => holdsTerm(header, word))) hasAddress = true;
    if (BANK_WORDS.some((word) => holdsTerm(header, word))) hasBank = true;
  }
  return { hasAddress, hasPostcode, hasBank };
}

/** What a heading alone says a column must never be, or null where it says
 *  nothing. A postcode is settled FIRST, so no address column can be read as a
 *  door code however it is written. */
export function neverKeptByHeader(raw: string | null, hints: SheetHints): MemberListNeverKeptReason | null {
  if (raw === null || raw === "") return null;
  const header = normaliseHeader(raw);
  // An address, in any of the words the English-speaking world uses for one.
  // Nothing below may take it (Kd, 2026-09-22).
  if (POSTCODE_WORDS.some((word) => holdsTerm(header, word))) return null;
  if (BANK_WORDS.some((word) => holdsTerm(header, word))) return "bank_details";
  if (hints.hasBank && BARE_ACCOUNT_WORDS.some((word) => holdsTerm(header, word))) return "bank_details";
  if (GOVERNMENT_WORDS.some((word) => holdsTerm(header, word))) return "government_id";
  if (PASSWORD_WORDS.some((word) => holdsTerm(header, word))) return "password_or_pin";
  // THE ONE HEADING A WORD LIST CANNOT SETTLE, and the only rule here with
  // three branches. Round one found "Locker PIN" kept because the rule asked
  // whether the heading HELD the word; the fix asked whether it IS the word,
  // and the re-check found that "Member PIN", "Gym PIN" and "Check-in PIN" then
  // fell through both rules and were kept on every sheet — the same door-code
  // hole on different headings. So the qualifier itself decides, and a list of
  // key words is not what holds:
  //
  //   1. a qualifier that is part of an ADDRESS — "Address PIN", "City PIN" —
  //      is a postcode, wherever the sheet stands;
  //   2. the bare word, and only the bare word, is settled by the SHEET;
  //   3. ANY other qualifier — "Member PIN", "Gym PIN", "Check-in PIN", "App
  //      PIN", and whatever wording no list here has heard of — is a key.
  if (BARE_PIN_WORDS.some((word) => holdsTerm(header, word))) {
    // PLACE words, not every address word: "Flat PIN" and "Building PIN" are a
    // dwelling's entry code, and `ADDRESS_WORDS` holds the dwelling words for
    // the SHEET-level question, which is a different one (Low B).
    if (PLACE_WORDS.some((word) => holdsTerm(header, word))) return null;
    if (BARE_PIN_WORDS.some((word) => isWord(header, word))) return hints.hasAddress && !hints.hasPostcode ? null : "password_or_pin";
    return "password_or_pin";
  }
  if (MEDICAL_WORDS.some((word) => holdsTerm(header, word)) && !NOT_MEDICAL_WORDS.some((word) => holdsTerm(header, word))) return "medical";
  return null;
}

/** How many of a column's looked-at cells carried each self-checking shape. */
export interface ColumnShapes {
  written: number;
  cards: number;
  ibans: number;
  governmentIds: number;
}

/** What a whole column is, from its cells and then its heading. The cells come
 *  first wherever they can answer: a column of card numbers is dropped whatever
 *  it is called, which is the rule a gym's own wording cannot get around. */
export function neverKeptColumn(header: string | null, shapes: ColumnShapes, hints: SheetHints): MemberListNeverKeptReason | null {
  const mostly = (count: number): boolean => shapes.written > 0 && count / shapes.written >= MEMBER_LIST_NEVER_KEEP_SHARE;
  if (mostly(shapes.cards)) return "payment_card";
  if (mostly(shapes.ibans)) return "bank_details";
  if (mostly(shapes.governmentIds)) return "government_id";
  return neverKeptByHeader(header, hints);
}

/** Whether a cell is worth any of the checks above at all. It is asked of every
 *  sampled cell of every column, so it is a length and a digit count and
 *  nothing else. The floor is India's PAN, the shortest of the shapes: ten
 *  characters with four digits in it. */
export const worthChecking = (text: string): boolean => text.length >= 9 && text.length <= 40 && digitCount(text) >= 4;
