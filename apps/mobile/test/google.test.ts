import { beforeEach, describe, expect, it, vi } from "vitest";

// Google's package, as the phone answers: each call's answer is set by the test.
const google = vi.hoisted(() => ({
  configure: vi.fn(),
  createAccount: vi.fn(),
  presentExplicitSignIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("react-native-nitro-google-signin", () => ({ GoogleOneTapSignIn: google }));

const { askGoogle } = await import("../src/session/google");

const success = (idToken: string) => ({ type: "success", data: { idToken } });

beforeEach(() => {
  vi.resetAllMocks();
  google.signOut.mockResolvedValue(undefined);
});

describe("Google's box, as the app reads it", () => {
  it("is asked with the server's client id and one-time word, and hands back Google's answer", async () => {
    google.createAccount.mockResolvedValue(success("google-answer"));
    expect(await askGoogle("our-client", "the-word")).toEqual({ kind: "token", idToken: "google-answer" });
    expect(google.configure).toHaveBeenCalledWith({ webClientId: "our-client", nonce: "the-word" });
    expect(google.presentExplicitSignIn).not.toHaveBeenCalled();
  });

  it("a phone with no account on it gets Google's own box to add one", async () => {
    google.createAccount.mockResolvedValue({ type: "noSavedCredentialFound", data: null });
    google.presentExplicitSignIn.mockResolvedValue(success("added-account"));
    expect(await askGoogle("our-client", "the-word")).toEqual({ kind: "token", idToken: "added-account" });
  });

  it.each([
    ["closed by the person", { type: "cancelled", data: null }],
    ["a success with nothing in it", { type: "success", data: null }],
  ])("%s: closed, and nothing is said", async (_name, answer) => {
    google.createAccount.mockResolvedValue(answer);
    expect(await askGoogle("our-client", "the-word")).toEqual({ kind: "closed" });
  });

  it("a package that throws is broken, never a sign-in", async () => {
    google.createAccount.mockRejectedValue(new Error("DEVELOPER_ERROR"));
    expect(await askGoogle("our-client", "the-word")).toEqual({ kind: "failed" });
  });

  it("the package's own copy is cleared every time, even when clearing fails", async () => {
    google.createAccount.mockResolvedValue(success("google-answer"));
    await askGoogle("our-client", "the-word");
    google.createAccount.mockRejectedValue(new Error("broken"));
    await askGoogle("our-client", "the-word");
    google.createAccount.mockResolvedValue({ type: "cancelled", data: null });
    google.signOut.mockRejectedValue(new Error("cannot clear"));
    expect(await askGoogle("our-client", "the-word")).toEqual({ kind: "closed" });
    expect(google.signOut).toHaveBeenCalledTimes(3);
  });
});
