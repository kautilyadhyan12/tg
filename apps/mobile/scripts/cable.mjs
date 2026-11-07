// What phone.mjs runs for one copy of the app: the three links through the USB
// cable, the bundler, and the link that opens the copy pointed at its bundler.

/**
 * @param {{ scheme: string, apiPort: unknown, metroPort: unknown, webPort: unknown }} copy
 */
export function cableFor(copy) {
  const { scheme, apiPort, metroPort, webPort } = copy;
  for (const port of [apiPort, metroPort, webPort]) {
    if (typeof port !== "number" || !Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("copies.json: a port must be a whole number from 1024 to 65535.");
    }
  }
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
    throw new Error("app.config.ts: the copy's scheme must be lower-case letters, digits, + . or -.");
  }
  const bundlerUrl = `http://localhost:${String(metroPort)}`;
  return {
    // The phone's localhost reaches this laptop's api, bundler and website through the cable:
    // the website opens a link the member shares from the app (Invite a friend, 20a).
    reverse: [
      ["reverse", `tcp:${String(apiPort)}`, `tcp:${String(apiPort)}`],
      ["reverse", `tcp:${String(metroPort)}`, `tcp:${String(metroPort)}`],
      ["reverse", `tcp:${String(webPort)}`, `tcp:${String(webPort)}`],
    ],
    bundlerUrl,
    // --localhost: the bundler answers this laptop alone, never the Wi-Fi.
    bundlerArgs: ["expo", "start", "--dev-client", "--localhost", "--port", String(metroPort)],
    link: `${scheme}://expo-development-client/?url=${encodeURIComponent(bundlerUrl)}`,
  };
}
