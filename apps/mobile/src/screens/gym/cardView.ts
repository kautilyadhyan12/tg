import { MEMBER_CARD_WORDS, cardEarlierLine, cardName, myCardStaysLine, type MyCardView } from "@app/shared";

// Card on file on My membership (ROADMAP Stage 5 item 20d; the server's `/my-card`, built in 18d-ii). The member adds or
// updates their own card on Square's own boxes, and removes it while nothing can be charged to it (20e).

export const CARD_TITLE = MEMBER_CARD_WORDS.title;
export const ADD_CARD = "Add card";
export const UPDATE_CARD = "Update card";
export const SAVE_CARD = "Save card";
export const CARD_NOT_READY = "Type your card and tick the box to save it.";
export const CARD_NOT_LOADED = "Square’s card boxes didn’t load. Check your internet and try again.";
export const CARD_NOT_TAKEN = "Check the card details in the boxes above, then try again.";
export const CARD_NOT_SAVED = MEMBER_CARD_WORDS.not_saved;
/** A refusal the server words for the front desk (the owner, Settings, Edit), said to the member instead. A refusal about
 *  the card itself, or already in a member's words, keeps the server's. */
export function cardRefusalLine(code: string, serverWords: string, gymName: string): string {
  switch (code) {
    case "card_not_ready":
    case "card_connection_refused":
    case "card_processing_off":
    case "card_not_taken":
      return `${gymName} can’t save cards in the app right now. Ask at the front desk.`;
    case "card_contact_refused":
      return "Square didn’t accept the email address or phone number the gym has for you. Ask at the front desk to check them.";
    case "card_customer_gone":
    case "card_merged_away":
      return "Square didn’t save this card. Type the card again.";
    case "card_paid_by_payer":
      return "Somebody else pays for you now, so their card is used.";
    default:
      return serverWords;
  }
}

/** Said where the server gives no reason a card stays (an older server). */
export const CARD_REMOVE_AT_DESK = "To remove this card, ask the front desk.";

export const myCardPath = (gymId: string): string => `/v1/orgs/${gymId}/my-card`;
export const myCardRemovePath = (gymId: string): string => `/v1/orgs/${gymId}/my-card/remove`;

/** "Card saved: Visa ending 1111." */
export const cardSavedLine = (card: { brand: string; last4: string }): string => `Card saved: ${cardName(card)}.`;

// Remove card (Stage 5 item 20e): the member's own card, while nothing can be charged to it; the server says when.
export const REMOVE_CARD = "Remove card";
/** "Remove Visa ending 1111?" */
export const removeCardTitle = (card: { brand: string; last4: string }): string => `Remove ${cardName(card)}?`;
/** "Iron House won't be able to charge it. You can add a card again at any time." */
export const removeCardLine = (gymName: string): string => `${gymName} won’t be able to charge it. You can add a card again at any time.`;
/** "Card removed: Visa ending 1111." */
export const cardRemovedLine = (card: { brand: string; last4: string }): string => `Card removed: ${cardName(card)}.`;
/** What a refused Remove card says in its box, in a member's words; `final`: pressing again cannot change it. */
export function removeRefusalLine(code: string, serverWords: string, gymName: string): { line: string; final: boolean } {
  if (code === "card_stays" || code === "card_changed" || code === "card_not_connected") return { line: serverWords, final: true };
  if (code === "card_paid_by_payer" || code === "card_not_your_record") return { line: cardRefusalLine(code, serverWords, gymName), final: true };
  return { line: serverWords, final: false };
}

/** "Expires 12/2028", or "Expired 12/2025". */
export function cardExpiryLine(card: { expMonth: number; expYear: number; expired: boolean }): string {
  return `${card.expired ? "Expired" : "Expires"} ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear)}`;
}

/** "Priya Sharma pays for you, so Priya Sharma's card is used." */
export const cardPaidByYouLine = (payer: string): string => `${payer} pays for you, so ${payer}’s card is used.`;

export type CardBox =
  /** `remove`: Remove card is offered; otherwise `line` says why the card stays and who can remove it. */
  | { kind: "card"; name: string; expiry: string; expired: boolean; button: string | null; remove: boolean; line: string | null }
  /** `button` null: No card on file kept on screen only to say what was just done there (a card removed). */
  | { kind: "none"; line: string | null; button: string | null }
  | { kind: "paid_by"; line: string };

/** What the box shows, or null for no box: Square not here, the gym not taking cards in the app, or a record that is not
 *  the member's alone (My membership already says so). Add or Update only where the server says a card can be saved. */
export function cardBox(view: MyCardView, said = false): CardBox | null {
  if (view.record !== "own" || view.state === "not_offered") return null;
  if (view.paidBy !== null) return { kind: "paid_by", line: cardPaidByYouLine(view.paidBy) };
  const canAdd = view.canSave && view.form !== null;
  if (view.card !== null) {
    const remove = view.canRemove && view.stays === null;
    const line = remove ? null : view.stays === null ? CARD_REMOVE_AT_DESK : myCardStaysLine(view.stays, view.paysFor, canAdd);
    return { kind: "card", name: cardName(view.card), expiry: cardExpiryLine(view.card), expired: view.card.expired, button: canAdd ? UPDATE_CARD : null, remove, line };
  }
  if (!canAdd) return said ? { kind: "none", line: null, button: null } : null;
  return { kind: "none", line: view.earlierCard === null ? null : cardEarlierLine(view.earlierCard, view.gymName), button: ADD_CARD };
}

/** The page may save: Square's boxes drawn, the agreement ticked, nothing on its way. */
export const cardReadyToSave = (drawn: boolean, agreed: boolean, busy: boolean): boolean => drawn && agreed && !busy;
