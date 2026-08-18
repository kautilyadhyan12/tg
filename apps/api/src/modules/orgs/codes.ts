// Pure helpers for the org module: join-code minting, code normalisation, and
// slug derivation. Kept out of repo/service so they are node-testable without
// a database — the alphabet rule (Part 3 §4.0 step 4) is the kind of thing a
// later edit breaks silently, so it gets its own assertions.
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "@app/shared";

/** Map raw bytes onto the ambiguity-free alphabet.
 *
 *  UNBIASED BY ARITHMETIC, not by luck: the alphabet is exactly 32 symbols and
 *  256 % 32 === 0, so every symbol is reachable from exactly 8 of the 256 byte
 *  values. Change the alphabet's LENGTH and this becomes a modulo-biased
 *  generator that still passes every test — which is why the invariant is
 *  asserted here rather than assumed.
 *
 *  Throws on short input: silently padding would produce a shorter, weaker
 *  code with no signal that it happened. */
export function codeFromBytes(bytes: Uint8Array, length = JOIN_CODE_LENGTH): string {
  if (256 % JOIN_CODE_ALPHABET.length !== 0) {
    throw new Error(
      `JOIN_CODE_ALPHABET length ${String(JOIN_CODE_ALPHABET.length)} does not divide 256 — the byte mapping would be biased`,
    );
  }
  if (bytes.length < length) {
    throw new Error(
      `codeFromBytes needs ${String(length)} bytes, got ${String(bytes.length)}`,
    );
  }
  let out = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i] ?? 0;
    out += JOIN_CODE_ALPHABET.charAt(byte % JOIN_CODE_ALPHABET.length);
  }
  return out;
}

/** What a human typed off a poster → what is stored.
 *
 *  Case, spaces and dashes only. There is deliberately NO look-alike
 *  substitution (0→O, 1→I): those characters are not IN the alphabet, so
 *  "correcting" them would be guessing at an intent the code cannot confirm,
 *  and a wrong guess joins somebody to the wrong gym. An unrecognised code
 *  gets an honest "no such code" instead. */
export function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[\s-]/g, "");
}

const SLUG_MAX = 48;

/** Derive the `/console/:orgSlug` segment (Part 3 §3.1) from the org name.
 *
 *  A name written in a script this strips entirely — Assamese, Devanagari,
 *  emoji — yields an EMPTY string, which would be a broken URL rather than an
 *  ugly one. Part 3 §6.3 targets worldwide, so that case is ordinary, not
 *  exotic: it falls back to `org` and the uniqueness suffix does the rest. */
export function slugifyName(name: string): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return base === "" ? "org" : base;
}

/** Candidate slugs in the order they should be tried: the bare name first,
 *  then the name plus a short token from the same alphabet. The token is
 *  lowercased so the URL stays lowercase throughout. */
export function slugCandidate(base: string, suffix: string | null): string {
  if (suffix === null) return base;
  const trimmed = base.slice(0, SLUG_MAX - suffix.length - 1).replace(/-+$/g, "");
  return `${trimmed === "" ? "org" : trimmed}-${suffix.toLowerCase()}`;
}
