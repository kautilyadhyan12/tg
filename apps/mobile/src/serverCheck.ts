import { serverHealthSchema } from "@app/shared";

export type ServerState = "connected" | "unreachable";

type Ask = (
  url: string,
  init: { signal: AbortSignal },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Asks this copy's api whether it is up. Any failure at all is "unreachable". */
export async function checkServer(apiUrl: string, ask: Ask, waitMs = 5000): Promise<ServerState> {
  const stop = new AbortController();
  const timer = setTimeout(() => {
    stop.abort();
  }, waitMs);
  try {
    const reply = await ask(`${apiUrl}/health`, { signal: stop.signal });
    if (!reply.ok) return "unreachable";
    return serverHealthSchema.safeParse(await reply.json()).success ? "connected" : "unreachable";
  } catch {
    return "unreachable";
  } finally {
    clearTimeout(timer);
  }
}
