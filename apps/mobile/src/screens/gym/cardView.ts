import { MEMBER_CARD_WORDS, cardEarlierLine, cardName, type MyCardView } from "@app/shared";

// Card on file on My membership (ROADMAP Stage 5 item 20d; the server's `/my-card`, built in 18d-ii). The member adds or
// updates their own card on Square's own boxes; only the front desk removes one.

export const CARD_TITLE = MEMBER_CARD_WORDS.title;
export const ADD_CARD = "Add card";
export const UPDATE_CARD = "Update card";
export const SAVE_CARD = "Save card";
export const CARD_NOT_READY = "Type your card and tick the box to save it.";
export const CARD_NOT_LOADED = "Square’s card boxes didn’t load. Check your internet and try again.";
export const CARD_NOT_TAKEN = "Check the card details in the boxes above, then try again.";
export const CARD_NOT_SAVED = MEMBER_CARD_WORDS.not_saved;

export const myCardPath = (gymId: string): string => `/v1/orgs/${gymId}/my-card`;

/** "Card saved: Visa ending 1111." */
export const cardSavedLine = (card: { brand: string; last4: string }): string => `Card saved: ${cardName(card)}.`;

/** "Expires 12/2028", or "Expired 12/2025". */
export function cardExpiryLine(card: { expMonth: number; expYear: number; expired: boolean }): string {
  return `${card.expired ? "Expired" : "Expires"} ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear)}`;
}

/** "Priya Sharma pays for you, so Priya Sharma's card is used." */
export const cardPaidByYouLine = (payer: string): string => `${payer} pays for you, so ${payer}’s card is used.`;

export type CardBox =
  | { kind: "card"; name: string; expiry: string; expired: boolean; button: string | null }
  | { kind: "none"; line: string | null; button: string }
  | { kind: "paid_by"; line: string };

/** What the box shows, or null for no box: Square not here, the gym not taking cards in the app, or a record that is not
 *  the member's alone (My membership already says so). Add or Update only where the server says a card can be saved. */
export function cardBox(view: MyCardView): CardBox | null {
  if (view.record !== "own" || view.state === "not_offered") return null;
  if (view.paidBy !== null) return { kind: "paid_by", line: cardPaidByYouLine(view.paidBy) };
  const canAdd = view.canSave && view.form !== null;
  if (view.card !== null) {
    return { kind: "card", name: cardName(view.card), expiry: cardExpiryLine(view.card), expired: view.card.expired, button: canAdd ? UPDATE_CARD : null };
  }
  if (!canAdd) return null;
  return { kind: "none", line: view.earlierCard === null ? null : cardEarlierLine(view.earlierCard, view.gymName), button: ADD_CARD };
}

/** The page may save: Square's boxes drawn, the agreement ticked, nothing on its way. */
export const cardReadyToSave = (drawn: boolean, agreed: boolean, busy: boolean): boolean => drawn && agreed && !busy;
