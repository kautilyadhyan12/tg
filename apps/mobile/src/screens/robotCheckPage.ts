import { robotCheckSiteKeySchema } from "@app/shared";

// The robot check on the phone (ROADMAP Stage 5 item 12b-ii): Cloudflare Turnstile's own box,
// drawn in a small web page the app writes itself. The page loads Cloudflare's script and
// nothing else, and says only four things back (`robotCheckMessageSchema`). It is given the
// api's own address, so Cloudflare sees the hostname the site key's list of domains names.

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=drawBox";
const CLOUDFLARE = "https://challenges.cloudflare.com/";

/** The page's address: the api's origin, with a slash. Null for anything that is not one. */
export function pageAddress(apiUrl: string): string | null {
  const origin = /^(https?:\/\/[^/?#@\s]+)(?:[/?#]|$)/i.exec(apiUrl)?.[1];
  return origin === undefined ? null : `${origin}/`;
}

/** The page for one site key, or null when the key is not one Cloudflare would issue. */
export function robotCheckPage(siteKey: string): string | null {
  const key = robotCheckSiteKeySchema.safeParse(siteKey);
  if (!key.success) return null;
  return `<!doctype html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<style>html,body{margin:0;padding:0;background:transparent}#box{display:flex;justify-content:center}</style>
</head><body>
<div id="box"></div>
<script>
function say(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
function drawBox(){
  turnstile.render("#box",{
    sitekey:${JSON.stringify(key.data)},
    action:"sign_in",
    theme:"dark",
    size:"flexible",
    callback:function(t){say({kind:"token",token:t});},
    "expired-callback":function(){say({kind:"expired"});},
    "error-callback":function(){say({kind:"failed"});return true;}
  });
}
</script>
<script src="${SCRIPT_URL}" async defer onerror="say({kind:'blocked'})"></script>
</body></html>`;
}

/** Where a link the page opens goes. `load`: in the box (the page itself, Cloudflare's own
 *  frame). `outside`: the phone's browser (Cloudflare's Privacy and Terms). `refuse`: nowhere. */
export function whereTo(url: string, topFrame: boolean, page: string): "load" | "outside" | "refuse" {
  if (url === "about:blank" || url === "about:srcdoc") return "load";
  if (topFrame) {
    if (url === page) return "load";
    return url.startsWith("https://") ? "outside" : "refuse";
  }
  return url.startsWith(CLOUDFLARE) ? "load" : "refuse";
}
