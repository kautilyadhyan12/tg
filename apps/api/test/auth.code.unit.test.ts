// Sign-in code primitives and the Resend transport, with no database and no
// network: the code's shape, the keyed hash, and the ONE HTTPS call — its
// request shape, and that a failure never carries the key or the address.
import { describe, expect, it, vi } from "vitest";
import type { FastifyBaseLogger } from "fastify";
import { createResendTransport, EmailTransportError, type EmailMessage } from "../src/email/resend.js";
import { accountDeletionEmail, deleteAccountCodeEmail, signInCodeEmail } from "../src/email/templates.js";
import { mintSixDigitCode, signInCodeHash } from "../src/modules/auth/tokens.js";
import { createLogOnlyEmailSender } from "../src/modules/auth/email.js";
import { createLogOnlyUsersEmailSender, createResendUsersEmailSender } from "../src/modules/users/email.js";
import { DPDP_RETENTION_DAYS } from "../src/retention.js";
import { loadConfig } from "../src/config.js";

/** Structural stand-in for the pino logger — no `as` (R2.2). */
const quietLog: Pick<FastifyBaseLogger, "info" | "warn" | "error"> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
// The senders take the full FastifyBaseLogger type; the three methods above
// are the only ones they call. Widened through `unknown` is the one cast this
// file needs, and it is in a test, not in src.
const log = quietLog as unknown as FastifyBaseLogger;

describe("mintSixDigitCode", () => {
  it("is always exactly six digits, leading zeros kept", () => {
    for (let i = 0; i < 2000; i++) expect(mintSixDigitCode()).toMatch(/^\d{6}$/);
  });
});

describe("signInCodeHash", () => {
  const secret = "unit-test-secret-0123456789abcdef-32"; // gitleaks:allow
  it("is deterministic, hex, and never contains the code", () => {
    const a = signInCodeHash(secret, { purpose: "sign_in", email: "a@example.com", code: "123456" });
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("123456");
    expect(signInCodeHash(secret, { purpose: "sign_in", email: "a@example.com", code: "123456" })).toBe(a);
  });
  it("changes with the code, the address, the purpose AND the secret", () => {
    const base = { purpose: "sign_in", email: "a@example.com", code: "123456" };
    const a = signInCodeHash(secret, base);
    expect(signInCodeHash(secret, { ...base, code: "123457" })).not.toBe(a);
    expect(signInCodeHash(secret, { ...base, email: "b@example.com" })).not.toBe(a);
    expect(signInCodeHash(secret, { ...base, purpose: "delete_account" })).not.toBe(a);
    expect(signInCodeHash("another-secret-0123456789abcdef-32", base)).not.toBe(a);
  });
});

describe("config: email service", () => {
  const good = {
    DATABASE_URL: "postgres://x:y@localhost:5432/z",
    WEB_ORIGIN: "http://localhost:5173",
    JWT_SECRET: "config-test-secret-0123456789abcdef-32", // gitleaks:allow
    REDIS_URL: "redis://localhost:6379",
  };
  it("production refuses to boot without a Resend key", () => {
    expect(() => loadConfig({ ...good, NODE_ENV: "production" })).toThrow(/RESEND_API_KEY/);
  });
  it("a key without a sender line is refused in every environment", () => {
    expect(() => loadConfig({ ...good, NODE_ENV: "development", RESEND_API_KEY: "re_x" })).toThrow(/EMAIL_FROM/);
  });
  it("a malformed sender line fails at BOOT, not on the first send", () => {
    for (const bad of ["hello", "AI Home Gym", "AI Home Gym <hi>", "<hi@example.com", "hi@example"]) {
      expect(() => loadConfig({ ...good, NODE_ENV: "development", RESEND_API_KEY: "re_x", EMAIL_FROM: bad }), bad).toThrow(/EMAIL_FROM/);
    }
    for (const ok of ["AI Home Gym <hi@example.com>", "hi@example.com", "Kd's Gym <no-reply@mail.example.co.in>"]) {
      expect(loadConfig({ ...good, NODE_ENV: "development", RESEND_API_KEY: "re_x", EMAIL_FROM: ok }).EMAIL_FROM, ok).toBe(ok);
    }
  });
  it("the daily code ceiling defaults, and is overridable", () => {
    expect(loadConfig({ ...good, NODE_ENV: "development" }).CODE_EMAILS_PER_DAY).toBe(5000);
    expect(loadConfig({ ...good, NODE_ENV: "development", CODE_EMAILS_PER_DAY: "12" }).CODE_EMAILS_PER_DAY).toBe(12);
    expect(() => loadConfig({ ...good, NODE_ENV: "development", CODE_EMAILS_PER_DAY: "0" })).toThrow(/CODE_EMAILS_PER_DAY/);
  });
  it("dev boots with neither; production boots with both", () => {
    expect(loadConfig({ ...good, NODE_ENV: "development" }).RESEND_API_KEY).toBeUndefined();
    const prod = loadConfig({ ...good, NODE_ENV: "production", RESEND_API_KEY: "re_x", EMAIL_FROM: "AI Home Gym <hi@example.com>" });
    expect(prod.EMAIL_FROM).toBe("AI Home Gym <hi@example.com>");
  });
});

describe("createResendTransport", () => {
  const ok = () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "content-type": "application/json" } });

  it("POSTs one message to Resend with the bearer key and the from line", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(ok());
    const transport = createResendTransport({ apiKey: "re_secret", from: "AI Home Gym <hi@example.com>", fetchImpl });
    await transport.send({ to: "kd@example.com", subject: "s", text: "t", html: "<p>t</p>" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [urlArg, init] = fetchImpl.mock.calls[0] ?? [];
    expect(urlArg).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    const headers = init?.headers;
    expect(headers).toMatchObject({ Authorization: "Bearer re_secret", "Content-Type": "application/json" });
    const raw = init?.body;
    if (typeof raw !== "string") throw new Error("the request body must be a JSON string");
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body).toEqual({
      from: "AI Home Gym <hi@example.com>",
      to: ["kd@example.com"],
      subject: "s",
      text: "t",
      html: "<p>t</p>",
    });
  });

  it("a non-2xx answer throws with the status and WITHOUT the key or the address", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ message: "kd@example.com is not allowed" }), { status: 422 }),
    );
    const transport = createResendTransport({ apiKey: "re_secret", from: "x <hi@example.com>", fetchImpl });
    let caught: unknown;
    try {
      await transport.send({ to: "kd@example.com", subject: "s", text: "t", html: "h" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EmailTransportError);
    const message = caught instanceof Error ? caught.message : "";
    expect(message).toContain("422");
    expect(message).not.toContain("re_secret");
    expect(message).not.toContain("kd@example.com");
  });

  it("a network failure or a bodyless 200 also throws (a send is only a send when Resend says so)", async () => {
    const down = createResendTransport({
      apiKey: "k",
      from: "x <hi@example.com>",
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed")),
    });
    await expect(down.send({ to: "a@example.com", subject: "s", text: "t", html: "h" })).rejects.toBeInstanceOf(EmailTransportError);

    const empty = createResendTransport({
      apiKey: "k",
      from: "x <hi@example.com>",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 200 })),
    });
    await expect(empty.send({ to: "a@example.com", subject: "s", text: "t", html: "h" })).rejects.toBeInstanceOf(EmailTransportError);
  });
});

describe("the code emails", () => {
  it("carry the code in the subject and both bodies, the life in minutes, and no link", () => {
    const m = signInCodeEmail("kd@example.com", "042917", 10);
    expect(m.to).toBe("kd@example.com");
    expect(m.subject).toContain("042917");
    expect(m.text).toContain("042917");
    expect(m.html).toContain("042917");
    expect(m.text).toContain("10 minutes");
    expect(m.text).not.toMatch(/https?:\/\//);
    expect(m.html).not.toMatch(/<a\s/i);
  });
  it("the deletion email says what the code is for", () => {
    const m = deleteAccountCodeEmail("kd@example.com", "042917", 10);
    expect(m.subject).toMatch(/deletion/i);
    expect(m.text).toMatch(/delete your account/i);
  });
  it("the undo email carries exactly one link, to our restore page, and the real window", () => {
    const m = accountDeletionEmail("kd@example.com", "Kd", "https://app.example/restore-account?token=abc", 14);
    expect(m.text.match(/https?:\/\//g)).toHaveLength(1);
    expect(m.text).toContain("https://app.example/restore-account?token=abc");
    expect(m.html.match(/<a\s/g)).toHaveLength(1);
    expect(m.subject).toContain("14 days");
    expect(m.text).toContain("14 days");
  });
});

describe("the senders never claim a delivery they did not make", () => {
  it("the log-only senders REJECT every method whose caller reports a send", async () => {
    await expect(createLogOnlyEmailSender(log).sendSignInCodeEmail("a@example.com", "123456")).rejects.toThrow(/NOT sent/);
    const users = createLogOnlyUsersEmailSender(log);
    await expect(users.sendAccountDeleteCodeEmail("a@example.com", "123456")).rejects.toThrow(/NOT sent/);
    await expect(users.sendAccountDeletionEmail("a@example.com", "A", "tok")).rejects.toThrow(/NOT sent/);
  });

  it("the Resend users sender SENDS the undo email, with the restore link on the web origin", async () => {
    // A deletion with no undo email is a deletion with no undo. The link is
    // built from WEB_ORIGIN and the page exists (apps/web /restore-account).
    const sent: EmailMessage[] = [];
    const sender = createResendUsersEmailSender({ send: (m) => { sent.push(m); return Promise.resolve(); } }, log, "https://app.example");
    await sender.sendAccountDeletionEmail("kd@example.com", "Kd", "raw-token-value");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("kd@example.com");
    expect(sent[0]?.text).toContain("https://app.example/restore-account?token=raw-token-value");
    expect(sent[0]?.subject).toContain(`${String(DPDP_RETENTION_DAYS)} days`);
  });
});
