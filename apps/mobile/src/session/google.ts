import { GoogleOneTapSignIn } from "react-native-nitro-google-signin";

// The one file that knows Google's package (Android's Credential Manager). It hands back
// Google's signed answer and nothing else: the server checks it, never the phone.

/** What Google's own box answered: its signed answer, closed by the person, or broken. */
export type GoogleAnswer = { kind: "token"; idToken: string } | { kind: "closed" } | { kind: "failed" };

/** `clientId` and `nonce` are the server's, from its start of the sign-in. */
export type AskGoogle = (clientId: string, nonce: string) => Promise<GoogleAnswer>;

export const askGoogle: AskGoogle = async (clientId, nonce) => {
  try {
    GoogleOneTapSignIn.configure({ webClientId: clientId, nonce });
    // The accounts on the phone, from the bottom; a phone with none gets Google's own box to add one.
    let answer = await GoogleOneTapSignIn.createAccount();
    if (answer.type === "noSavedCredentialFound") answer = await GoogleOneTapSignIn.presentExplicitSignIn();
    if (answer.type !== "success" || answer.data === null) return { kind: "closed" };
    return { kind: "token", idToken: answer.data.idToken };
  } catch {
    return { kind: "failed" };
  } finally {
    // The package keeps its own copy of the answer; ours is the server's session.
    await GoogleOneTapSignIn.signOut().catch(() => undefined);
  }
};
