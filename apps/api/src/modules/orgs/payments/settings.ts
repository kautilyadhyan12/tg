// Square's settings from the environment, for the api and the worker alike (ROADMAP 18d-i).
import type { AppConfig } from "../../../config.js";
import { createSquareApi, type SquareApi, type SquareEnvironment } from "./square.js";
import { createTokenBox, type TokenBox } from "./tokenBox.js";

export interface SquareSettings {
  api: SquareApi;
  environment: SquareEnvironment;
  tokens: TokenBox;
  /** Null until a webhook subscription is set up: Square's messages are then refused. */
  webhook: { signatureKey: string; url: string } | null;
}

/** Null when Square is not set up: the Payments box then says it can't be connected here.
 *  `api` replaces the real client in tests. */
export function squareSettings(
  config: Pick<AppConfig, "SQUARE_ENV" | "SQUARE_APPLICATION_ID" | "SQUARE_APPLICATION_SECRET" | "SQUARE_WEBHOOK_SIGNATURE_KEY" | "SQUARE_WEBHOOK_URL" | "PAYMENT_TOKENS_KEY">,
  api?: SquareApi,
): SquareSettings | null {
  if (config.SQUARE_APPLICATION_ID === undefined || config.SQUARE_APPLICATION_SECRET === undefined || config.PAYMENT_TOKENS_KEY === undefined) return null;
  return {
    api:
      api ??
      createSquareApi({ applicationId: config.SQUARE_APPLICATION_ID, applicationSecret: config.SQUARE_APPLICATION_SECRET, environment: config.SQUARE_ENV }),
    environment: config.SQUARE_ENV,
    tokens: createTokenBox(config.PAYMENT_TOKENS_KEY),
    webhook:
      config.SQUARE_WEBHOOK_SIGNATURE_KEY === undefined || config.SQUARE_WEBHOOK_URL === undefined
        ? null
        : { signatureKey: config.SQUARE_WEBHOOK_SIGNATURE_KEY, url: config.SQUARE_WEBHOOK_URL },
  };
}
