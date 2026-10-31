import { upcEToUpcA, type BarcodeReply } from "@app/shared";

// A pack's barcode on the phone (ROADMAP Stage 5 33b-iii-b): the code as the server should be asked
// for it, when a read from the camera is trusted, and what a person is told about the reply.

export type FoundProduct = Extract<BarcodeReply, { status: "found" }>;

/** The codes on food packs. The camera looks for nothing else. */
export const PACK_CODES = ["ean13", "ean8", "upc_a", "upc_e"] as const;

/** What the camera read, as the server should be asked: a UPC-E written out, since looked up as printed
 *  it lands on an EAN-8 of the same digits. Null where it is not a whole code. */
export function codeFromCamera(type: string, data: string): string | null {
  if (type === "upc_e") {
    if (/^\d{12}$/.test(data)) return data;
    return upcEToUpcA(data);
  }
  return /^\d{8,14}$/.test(data) ? data : null;
}

/** What a person typed. Eight digits beginning 0 are a UPC-E: an EAN-8 never begins 0 on a product. */
export function codeFromTyped(typed: string): string | null {
  const digits = typed.replace(/\D/g, "");
  if (!/^\d{8,14}$/.test(digits)) return null;
  if (digits.length === 8 && digits.startsWith("0")) return upcEToUpcA(digits) ?? digits;
  return digits;
}

/** A read seen this long ago or less is still the pack in front of the camera. */
export const SAME_PACK_MS = 3000;

export interface ReadMemory {
  /** The last code read, and when: two reads alike in a row are needed, so a misread is not looked up. */
  last: string | null;
  /** The code last looked up, and when it was last seen: it is not looked up again while still in view. */
  looked: string | null;
  lookedSeen: number;
}
export const NO_READS: ReadMemory = { last: null, looked: null, lookedSeen: 0 };

/** One read of the camera: whether to look it up now, and what to remember. */
export function afterRead(memory: ReadMemory, code: string, now: number): { look: boolean; memory: ReadMemory } {
  if (code === memory.looked && now - memory.lookedSeen <= SAME_PACK_MS) return { look: false, memory: { ...memory, last: code, lookedSeen: now } };
  if (code !== memory.last) return { look: false, memory: { ...memory, last: code } };
  return { look: true, memory: { last: code, looked: code, lookedSeen: now } };
}

/** What a code with no product says, and what can be done next. */
export function troubleWords(reply: Exclude<BarcodeReply, FoundProduct>): string {
  switch (reply.status) {
    case "not_found":
      return "This product isn’t on our list.";
    case "store_only":
      return "This is the shop’s own code. Search for the food instead.";
    case "not_a_food":
      return "This barcode isn’t a food. Try another one.";
    case "bad_code":
      return "That barcode isn’t right. Scan it again, or check the number.";
  }
}

const capital = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

export interface AllergenWords {
  contains: string | null;
  mayContain: string | null;
  /** Somebody's own words: real warnings live only here ("lait", "weizenmehl"), so they are never dropped. */
  typed: string | null;
  /** Nothing listed. That says nothing about the food: it must never read as safe. */
  noneListed: boolean;
}

const listed = (words: readonly string[]): string | null => (words.length === 0 ? null : words.map(capital).join(", "));

export function allergenWords(product: Pick<FoundProduct, "allergens" | "mayContain" | "listedAsTyped">): AllergenWords {
  const contains = listed(product.allergens);
  const mayContain = listed(product.mayContain);
  const typed = product.listedAsTyped.length === 0 ? null : product.listedAsTyped.join(", ");
  return { contains, mayContain, typed, noneListed: contains === null && mayContain === null && typed === null };
}

/** Why the numbers should be checked against the pack, or null. A 0 kcal is never taken as certain:
 *  a blank panel reads the same. */
export function checkWords(product: Pick<FoundProduct, "check"> & { food: { kcal: number } }): string | null {
  switch (product.check) {
    case "lists_differ":
      return "Our food lists disagree on the calories. Check the pack.";
    case "doesnt_add_up":
      return "These numbers don’t add up. Check the pack.";
    case "part_missing":
      return "Some numbers are missing. Check the pack.";
    case "fine":
      return product.food.kcal === 0 ? "Listed as 0 kcal. Check the pack." : null;
  }
}
