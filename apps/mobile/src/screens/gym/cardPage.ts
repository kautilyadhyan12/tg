import { sha256 } from "@noble/hashes/sha2";
import { utf8ToBytes } from "@noble/hashes/utils";
import { cardFormSchema, type CardForm } from "@app/shared";
import { colours } from "../../look/colours";

// Add card on the phone (ROADMAP Stage 5 item 20d): Square's own card boxes (its Web Payments SDK, as the desk's Card on
// file uses), drawn in a small web page the app writes itself, as the robot check's is. What is typed in the boxes goes
// to Square inside Square's own frames, never to the app or our server; the page hands back only Square's one-time
// token (`cardFormMessageSchema`). The page's policy lets it run its own script and Square's alone, and frame Square
// alone: a changed copy of the page cannot draw a box of its own. Square draws only on a secure page: the page is given
// the api's own address (https, or localhost on the laptop).

const SCRIPT = { sandbox: "https://sandbox.web.squarecdn.com/v1/square.js", production: "https://web.squarecdn.com/v1/square.js" } as const;
const SQUARE = ["https://web.squarecdn.com", "https://sandbox.web.squarecdn.com"];
const SQUARE_CONNECT = ["https://pci-connect.squareup.com", "https://pci-connect.squareupsandbox.com", "https://o160250.ingest.sentry.io"];
// Square's list, and the fonts its boxes were seen loading in the console (18d-ii).
const SQUARE_FONTS = ["https://square-fonts-production-f.squarecdn.com", "https://d1g145x70srn7h.cloudfront.net", "https://cash-f.squarecdn.com"];

/** Square's boxes in the app's colours (Square takes plain colours only). */
const STYLE = {
  ".input-container": { borderColor: colours.cardBoxLine, borderRadius: "12px" },
  ".input-container.is-focus": { borderColor: colours.orange },
  ".input-container.is-error": { borderColor: colours.badText },
  ".message-text": { color: colours.cardBoxHint },
  ".message-icon": { color: colours.cardBoxHint },
  ".message-text.is-error": { color: colours.badText },
  ".message-icon.is-error": { color: colours.badText },
  input: { backgroundColor: colours.box, color: colours.cardBoxText },
  "input::placeholder": { color: colours.cardBoxHint },
  "input.is-error": { color: colours.badText },
};

// The page's one script: the same words for every card, so the policy names it by its fingerprint. What differs (the
// gym's Square location, the person) is read from a block of data, which never runs.
const PAGE_SCRIPT = `(function(){
var form=JSON.parse(document.getElementById("form").textContent);
var box=document.getElementById("card");
var card=null,busy=false,tall=false,lastPx=0;
function say(m){window.ReactNativeWebView.postMessage(JSON.stringify(m));}
function height(){var px=Math.ceil(box.getBoundingClientRect().height);if(px>0&&px!==lastPx){lastPx=px;say({kind:"height",px:px});}}
function check(){var on=false;var all=document.body.children;for(var i=0;i<all.length;i++){var el=all[i];if(el===box||el.tagName==="SCRIPT")continue;if(el.getBoundingClientRect().height>150)on=true;}if(on!==tall){tall=on;say({kind:"tall",on:on});}}
function draw(){
if(!window.Square){say({kind:"blocked"});return;}
var payments;
try{payments=window.Square.payments(form.applicationId,form.locationId);}catch(e){say({kind:"blocked"});return;}
payments.card({style:form.style}).then(function(c){return c.attach("#card").then(function(){card=c;say({kind:"ready"});height();});}).catch(function(){say({kind:"blocked"});});
}
window.kwazoSave=function(){
if(card===null||busy)return;
busy=true;
card.tokenize({intent:"STORE",customerInitiated:true,sellerKeyedIn:false,billingContact:form.contact}).then(function(r){busy=false;if(r&&r.status==="OK"&&typeof r.token==="string")say({kind:"token",token:r.token});else say({kind:"not_taken"});},function(){busy=false;say({kind:"not_taken"});});
};
if(window.ResizeObserver)new ResizeObserver(height).observe(box);
new MutationObserver(function(){check();height();}).observe(document.body,{childList:true,subtree:true,attributes:true});
var s=document.createElement("script");
s.src=form.script;
s.onload=draw;
s.onerror=function(){say({kind:"blocked"});};
document.head.appendChild(s);
})();`;

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64.charAt((n >> 18) & 63) + BASE64.charAt((n >> 12) & 63);
    out += b === undefined ? "=" : BASE64.charAt((n >> 6) & 63);
    out += c === undefined ? "=" : BASE64.charAt(n & 63);
  }
  return out;
}

/** The fingerprint the policy lets run: the page's own script, and nothing else written into it. */
export const PAGE_SCRIPT_HASH = `'sha256-${base64(sha256(utf8ToBytes(PAGE_SCRIPT)))}'`;

/** The page's policy: its own script by fingerprint, Square's scripts, frames, styles, fonts and the address the card
 *  goes to; nothing else. */
export const CARD_PAGE_POLICY = [
  "default-src 'none'",
  `script-src ${PAGE_SCRIPT_HASH} ${SQUARE.join(" ")}`,
  `style-src 'unsafe-inline' ${SQUARE.join(" ")}`,
  `font-src data: ${SQUARE_FONTS.join(" ")}`,
  `img-src data: ${SQUARE.join(" ")}`,
  `connect-src ${[...SQUARE, ...SQUARE_CONNECT].join(" ")}`,
  `frame-src ${SQUARE.join(" ")}`,
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** Data in the page, safe inside its block: no "<" that could end it. */
const inert = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** The page for one gym's form, or null for a form that is not one the server would send. */
export function cardPage(form: CardForm): string | null {
  const parsed = cardFormSchema.safeParse(form);
  if (!parsed.success) return null;
  const f = parsed.data;
  const contact = {
    ...(f.contact.givenName === "" ? {} : { givenName: f.contact.givenName }),
    ...(f.contact.familyName === "" ? {} : { familyName: f.contact.familyName }),
    ...(f.contact.email === null ? {} : { email: f.contact.email }),
    countryCode: f.contact.countryCode,
  };
  const data = { script: SCRIPT[f.environment], applicationId: f.applicationId, locationId: f.locationId, contact, style: STYLE };
  return `<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="${CARD_PAGE_POLICY}">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<link rel="icon" href="data:,">
<style>html,body{margin:0;padding:0;background:${colours.box}}#card{padding:2px 1px 0}</style>
</head><body>
<div id="card"></div>
<script type="application/json" id="form">${inert(data)}</script>
<script>${PAGE_SCRIPT}</script>
</body></html>`;
}

/** The script the app runs in the page when Save card is pressed: Square makes its token for the card typed. */
export const SAVE_SCRIPT = "window.kwazoSave&&window.kwazoSave();true;";

/** Where a load the page starts goes. `load`: in the page (the page itself, Square's frames, and the bank's own check
 *  that Square's frame opens inside it). `outside`: the phone's browser (a link Square shows, such as its privacy
 *  page). `refuse`: nowhere — the page never moves off itself. */
export function cardWhereTo(url: string, topFrame: boolean, page: string): "load" | "outside" | "refuse" {
  if (url === "about:blank" || url === "about:srcdoc") return "load";
  if (topFrame) {
    if (url === page) return "load";
    return url.startsWith("https://") ? "outside" : "refuse";
  }
  // A frame: the page's policy frames only Square, and Square's frame opens the bank's own check (any bank's address).
  return url.startsWith("https://") ? "load" : "refuse";
}
