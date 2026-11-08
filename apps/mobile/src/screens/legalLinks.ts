import { LEGAL_PATHS } from "@app/shared";

// KWAZO's Privacy Policy and Terms of Use live on the website (ROADMAP Stage 5 21b-i); the phone opens
// them in its browser, from Get started's line and from Settings.

export type LegalPage = keyof typeof LEGAL_PATHS;

/** The page's address on this copy's website, or null when the copy was handed none. */
export function legalUrl(webUrl: string | undefined, page: LegalPage): string | null {
  return webUrl === undefined || webUrl === "" ? null : `${webUrl.replace(/\/+$/, "")}${LEGAL_PATHS[page]}`;
}
