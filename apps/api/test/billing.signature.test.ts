// Paddle's webhook signature, checked against the cases in Paddle's own Node SDK
// (PaddleHQ/paddle-node-sdk, src/__tests__/notifications/webhooks-validator.node.test.ts,
// read 2026-09-24): its bodies, headers and secret, and its five-second window.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaddleSignature } from "../src/modules/billing/paddleSignature.js";

const SECRET = "VALID_SECRET"; // Paddle's SDK test value, gitleaks:allow
const AT = 1698796800; // 2023-11-01T00:00:00Z, the SDK's fixed clock
const body = (s: string) => Buffer.from(s, "utf8");

describe("Paddle-Signature, Paddle's own cases", () => {
  it.each([
    ["valid signature", '{"data": ["1", "2"]}', "ts=1698796800;h1=a300428748dce5c70e4da19bffd60769591ea969c99dea3105d0ec9612cf43f9", SECRET, true],
    [
      "valid with several hashes",
      '{"data": "value"}',
      "ts=1698796800;h1=28981e941fae76e53db32f3d2a83cb69db41476595e84e1970a1b5d98f62b261;h1=28981e941fae76e53db32f3d2a83cb69db41476595e84e1970a1b5d98f62b261;h2=RANDOM_HASH",
      SECRET,
      true,
    ],
    ["another secret", '{"data": ["1", "2"]}', "ts=1698796800;h1=a300428748dce5c70e4da19bffd60769591ea969c99dea3105d0ec9612cf43f9", "INVALID_VALID_SECRET", false],
    ["another timestamp", '{"data": ["1", "2"]}', "ts=9876;h1=a300428748dce5c70e4da19bffd60769591ea969c99dea3105d0ec9612cf43f9", SECRET, false],
    ["the body re-spaced", '{ "data": [ "1", "2" ]}', "ts=1698796800;h1=a300428748dce5c70e4da19bffd60769591ea969c99dea3105d0ec9612cf43f9", SECRET, false],
    ["not a signature", '{"data": ["1", "2"]}', "ts=1234;h1=invalid_signature", SECRET, false],
    ["no ts or h1", '{"data": ["1", "2"]}', "invalid_header", SECRET, false],
    ["no ts", '{"data": ["1", "2"]}', "h1=invalid_header", SECRET, false],
    ["no h1", '{"data": ["1", "2"]}', "ts=1234;h2=invalid_header", SECRET, false],
  ])("%s", (_name, raw, header, secret, valid) => {
    expect(verifyPaddleSignature(secret, header, body(raw), AT)).toBe(valid);
  });

  it.each([
    ["1 second later", AT + 1, true],
    ["5 seconds later", AT + 5, true],
    ["6 seconds later", AT + 6, false],
    ["4 days later", AT + 4 * 86_400, false],
    ["6 seconds earlier", AT - 6, false],
  ])("%s", (_name, now, valid) => {
    const header = "ts=1698796800;h1=a300428748dce5c70e4da19bffd60769591ea969c99dea3105d0ec9612cf43f9";
    expect(verifyPaddleSignature(SECRET, header, body('{"data": ["1", "2"]}'), now)).toBe(valid);
  });

  it("a missing header is refused", () => {
    expect(verifyPaddleSignature(SECRET, undefined, body("{}"), AT)).toBe(false);
  });

  it("the signed bytes are the raw body, not its text re-encoded", () => {
    const raw = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xc3, 0xa9, 0x22, 0x7d]); // {"a":"é"}
    const h1 = createHmac("sha256", SECRET).update(Buffer.concat([Buffer.from(`${String(AT)}:`), raw])).digest("hex");
    expect(verifyPaddleSignature(SECRET, `ts=${String(AT)};h1=${h1}`, raw, AT)).toBe(true);
    expect(verifyPaddleSignature(SECRET, `ts=${String(AT)};h1=${h1}`, Buffer.from('{"a":"e"}'), AT)).toBe(false);
  });
});
