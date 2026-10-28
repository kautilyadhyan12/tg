import { apiRefusalSchema } from "@app/shared";

export interface AskInit {
  signal: AbortSignal;
  method?: "GET" | "POST" | "PATCH" | "PUT";
  headers?: Record<string, string>;
  body?: string;
}

/** How the app asks its server: `fetch`, or a test's stand-in. */
export type Ask = (
  url: string,
  init: AskInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface Shape<T> {
  safeParse: (raw: unknown) => { success: true; data: T } | { success: false };
}

/** `no_answer`: no reply, a late one, or one that is not this api's. It never signs anybody out. */
export type Answer<T> =
  | { kind: "ok"; data: T }
  | { kind: "refused"; status: number; error: string; message: string; retryAfterSeconds: number | null; robotCheckKey: string | null }
  | { kind: "no_answer" };

export interface Server {
  apiUrl: string;
  ask: Ask;
}

const LATE = Symbol("late");

/** One POST, its reply read through its shape. A reply that comes after `waitMs` is dropped. */
export function post<T>(server: Server, path: string, body: unknown, shape: Shape<T>, waitMs = 15_000): Promise<Answer<T>> {
  return call(server, { method: "POST", path, body }, shape, waitMs);
}

export interface Request {
  method: "GET" | "POST" | "PATCH" | "PUT";
  path: string;
  body?: unknown;
  /** A signed-in request's access token. */
  token?: string;
}

/** One request, its reply read through its shape. A reply that comes after `waitMs` is dropped. */
export async function call<T>(server: Server, request: Request, shape: Shape<T>, waitMs = 15_000): Promise<Answer<T>> {
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => {
      stop.abort();
      resolve(LATE);
    }, waitMs);
  });
  try {
    const reply = await Promise.race([
      server.ask(`${server.apiUrl}${request.path}`, {
        signal: stop.signal,
        method: request.method,
        headers: {
          ...(request.method === "GET" ? {} : { "content-type": "application/json" }),
          ...(request.token === undefined ? {} : { authorization: `Bearer ${request.token}` }),
        },
        ...(request.method === "GET" ? {} : { body: JSON.stringify(request.body ?? {}) }),
      }),
      late,
    ]);
    if (reply === LATE) return { kind: "no_answer" };
    const raw = await Promise.race([reply.json(), late]);
    if (raw === LATE) return { kind: "no_answer" };
    if (reply.ok) {
      const parsed = shape.safeParse(raw);
      return parsed.success ? { kind: "ok", data: parsed.data } : { kind: "no_answer" };
    }
    const refusal = apiRefusalSchema.safeParse(raw);
    if (!refusal.success) return { kind: "no_answer" };
    const { error, message, retryAfterSeconds, robotCheckKey } = refusal.data;
    return { kind: "refused", status: reply.status, error, message, retryAfterSeconds: retryAfterSeconds ?? null, robotCheckKey: robotCheckKey ?? null };
  } catch {
    return { kind: "no_answer" };
  } finally {
    clearTimeout(timer);
  }
}
