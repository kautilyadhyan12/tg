// Paddle's settings from the environment, for the api and the worker alike.
import type { AppConfig } from "../../config.js";
import { createPaddleApi, type PaddleApi } from "./paddle.js";
import type { PaddleSettings } from "./service.js";

/** Null when Paddle is not set up: paying online then answers 503. `api` replaces the
 *  real client in tests. */
export function paddleSettings(
  config: Pick<AppConfig, "PADDLE_ENV" | "PADDLE_API_KEY" | "PADDLE_CLIENT_TOKEN">,
  api?: PaddleApi,
): PaddleSettings | null {
  if (config.PADDLE_API_KEY === undefined || config.PADDLE_CLIENT_TOKEN === undefined) return null;
  return {
    api: api ?? createPaddleApi({ apiKey: config.PADDLE_API_KEY, environment: config.PADDLE_ENV }),
    environment: config.PADDLE_ENV,
    clientToken: config.PADDLE_CLIENT_TOKEN,
  };
}
