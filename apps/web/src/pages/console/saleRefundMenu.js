import { SALE_MENU_WORDS } from './saleRefundView';

// A SALE'S REFUND BUTTON, the same on Sell's list and a person's "Bought at the desk" (18d-iv-b-ii): a sale paid on the
// Terminal says Refund, in the word Square's own dashboard uses, with Refund to card and Note a refund; a sale paid by hand
// keeps its ⋯.

/** `basket`: the sale, or null for a row that is no sale. `pick`: told whether Refund to card was picked. */
export function saleBasketMenu(basket, title, pick) {
  const lines = basket?.lines ?? [];
  if (lines.some((line) => line.toCard === true)) {
    return {
      label: 'Refund',
      ariaLabel: `Refund the sale of ${title}`,
      items: [
        { ...SALE_MENU_WORDS.cardRefund, onPick: () => pick(true) },
        { ...SALE_MENU_WORDS.noteRefund, onPick: () => pick(false) },
      ],
    };
  }
  const items = lines.some((line) => line.canRefund === true) ? [{ ...SALE_MENU_WORDS.refund, onPick: () => pick(false) }] : [];
  return { label: null, ariaLabel: `More for the sale of ${title}`, items };
}

/** The open refund box's pick, where it is on this sale; null for any other. */
export const saleRefundPick = (refunding, saleId) => (refunding !== null && refunding.saleId === saleId ? refunding : null);
