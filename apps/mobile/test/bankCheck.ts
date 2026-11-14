import { act, waitFor } from "@testing-library/react-native";
import { CHECK_SCRIPT } from "../src/screens/gym/cardPage";
import { PASS } from "./forSaleLines";

export { CARD_FORM, CARD_ID, PASS, listCard } from "./forSaleLines";

// The bank's check before Pay on a repeating membership (20i-ii), in a screen test: Square's page is a plain box
// (`screens/setup.js`), and a test says back what Square's page would, in the words Square's test area used on 2026-11-14.

export type BankBox = {
  props: { testID?: string; source: { html: string; baseUrl: string }; onMessage: (event: { nativeEvent: { data: string; url: string } }) => void };
  gone: boolean;
  injected: string[];
};
const { boxes } = jest.requireMock<{ boxes: BankBox[] }>("react-native-webview");

/** Forgets the pages earlier tests opened: called before each test. */
export function forgetBankPages(): void {
  boxes.length = 0;
}

/** Square's pages the bank's check opened that are still open. */
export const bankPages = (): BankBox[] => boxes.filter((b) => !b.gone && b.props.testID === "bank-check-page");
/** Every page the bank's check opened, closed or not. */
export const everyBankPage = (): BankBox[] => boxes.filter((b) => b.props.testID === "bank-check-page");

/** The open page, once Pay has opened it. */
export async function bankPage(): Promise<BankBox> {
  await waitFor(() => {
    expect(bankPages()).toHaveLength(1);
  });
  const box = bankPages()[0];
  if (box === undefined) throw new Error("no bank's check open");
  return box;
}

/** Square's page says these, in order, from its own address. */
export async function bankSays(...messages: unknown[]): Promise<BankBox> {
  const box = await bankPage();
  for (const message of messages) {
    await act(async () => {
      box.props.onMessage({ nativeEvent: { data: JSON.stringify(message), url: box.props.source.baseUrl } });
      await Promise.resolve();
    });
  }
  return box;
}

/** Square's page is ready, the app starts the check, and Square hands back its pass. */
export async function passTheBank(pass = PASS): Promise<BankBox> {
  const box = await bankSays({ kind: "ready" });
  expect(box.injected).toEqual([CHECK_SCRIPT]);
  await bankSays({ kind: "pass", token: pass });
  return box;
}
