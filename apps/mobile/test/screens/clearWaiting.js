// The kept code step (12e) lives in the key store's stand-in, which lasts a whole test file: each test starts with none.
beforeEach(() => {
  require("expo-secure-store").kept.delete("sign-in-waiting");
});
