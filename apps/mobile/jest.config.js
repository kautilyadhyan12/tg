// The screen tests: a screen drawn by React Native's own test tools. The rules
// that need no screen stay on vitest (test/*.test.ts).
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/test/screens/**/*.test.tsx"],
  setupFiles: ["<rootDir>/test/screens/setup.js"],
  // @app/shared is TypeScript whose imports end in ".js" (the api's module rules).
  moduleNameMapper: { "^([.]{1,2}/.*)[.]js$": "$1" },
};
