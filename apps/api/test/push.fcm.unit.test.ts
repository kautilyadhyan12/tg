// The Firebase sender (ROADMAP Stage 5 item 18b-i) against a stand-in for Google: what it sends, and
// how it reads each answer. Google's real service is reached only on the phone walk.
import { generateKeyPairSync } from "node:crypto";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { firebaseServiceAccountSchema } from "@app/shared";
import { createFcmSender, type PushMessage } from "../src/modules/push/fcm.adapter.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const account = firebaseServiceAccountSchema.parse({
  type: "service_account",
  project_id: "kwazo-test",
  client_email: "sender@kwazo-test.iam.gserviceaccount.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
const message: PushMessage = {
  token: "phone-address",
  title: "Lotus Yoga · 2 new messages",
  body: "Class moved to 7 pm.",
  tag: "gym-1",
  channelId: "gym-messages",
  data: { kind: "gym_inbox", gymId: "gym-1" },
};

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fakeGoogle = (sendReply: () => Response) => {
  const calls: Call[] = [];
  const fetcher = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    if (url === "https://oauth2.googleapis.com/token") return Promise.resolve(json(200, { access_token: "ya29.test", expires_in: 3599 }));
    return Promise.resolve(sendReply());
  };
  return { calls, fetcher };
};

describe("createFcmSender", () => {
  it("signs in once as the service account and sends one notification tagged with the gym", async () => {
    const google = fakeGoogle(() => json(200, { name: "projects/kwazo-test/messages/1" }));
    const sender = createFcmSender({ account, now: () => new Date("2026-11-02T06:30:00Z"), fetch: google.fetcher });
    expect(await sender.send(message)).toBe("sent");
    expect(await sender.send(message)).toBe("sent");
    const signIns = google.calls.filter((c) => c.url.includes("oauth2"));
    expect(signIns).toHaveLength(1);
    const assertion = new URLSearchParams(typeof signIns[0]?.init.body === "string" ? signIns[0].init.body : "").get("assertion") ?? "";
    expect(jwt.verify(assertion, publicKey, { algorithms: ["RS256"], audience: "https://oauth2.googleapis.com/token", clockTimestamp: Date.parse("2026-11-02T06:31:00Z") / 1000 })).toMatchObject({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
    });
    const send = google.calls.find((c) => c.url.includes("fcm.googleapis.com"));
    expect(send?.url).toBe("https://fcm.googleapis.com/v1/projects/kwazo-test/messages:send");
    expect(new Headers(send?.init.headers).get("authorization")).toBe("Bearer ya29.test");
    expect(JSON.parse(typeof send?.init.body === "string" ? send.init.body : "null")).toEqual({
      message: {
        token: "phone-address",
        notification: { title: "Lotus Yoga · 2 new messages", body: "Class moved to 7 pm." },
        data: { kind: "gym_inbox", gymId: "gym-1" },
        android: { collapse_key: "gym-1", notification: { tag: "gym-1", channel_id: "gym-messages" } },
      },
    });
  });

  it.each([
    ["404, the address is gone", () => json(404, { error: { code: 404, status: "NOT_FOUND" } }), "gone"],
    ["UNREGISTERED in the details", () => json(400, { error: { code: 400, details: [{ errorCode: "UNREGISTERED" }] } }), "gone"],
    ["a bad request otherwise", () => json(400, { error: { code: 400, status: "INVALID_ARGUMENT" } }), "failed"],
    ["Google is down", () => json(503, { error: { code: 503 } }), "failed"],
    ["an answer that is not Google's", () => new Response("<html>proxy</html>", { status: 200 }), "failed"],
    ["a 200 with no name", () => json(200, {}), "failed"],
  ])("%s → %s", async (_case, reply, result) => {
    const google = fakeGoogle(reply);
    const sender = createFcmSender({ account, now: () => new Date(), fetch: google.fetcher });
    expect(await sender.send(message)).toBe(result);
  });

  it("no network, or a sign-in Google refuses, is a failure, never a throw", async () => {
    const offline = createFcmSender({ account, now: () => new Date(), fetch: () => Promise.reject(new Error("offline")) });
    expect(await offline.send(message)).toBe("failed");
    const refused = createFcmSender({ account, now: () => new Date(), fetch: () => Promise.resolve(json(401, { error: "invalid_grant" })) });
    expect(await refused.send(message)).toBe("failed");
  });
});
