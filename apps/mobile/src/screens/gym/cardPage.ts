import { sha256 } from "@noble/hashes/sha2";
import { utf8ToBytes } from "@noble/hashes/utils";
import { cardFormSchema, squareCardIdSchema, type CardForm } from "@app/shared";
import { colours } from "../../look/colours";

// Add card on the phone (ROADMAP Stage 5 item 20d): Square's own card boxes (its Web Payments SDK, as the desk's Card on
// file uses), drawn in a small web page the app writes itself, as the robot check's is. What is typed in the boxes goes
// to Square inside Square's own frames, never to the app or our server; the page hands back only Square's one-time
// token (`cardFormMessageSchema`). The page's policy lets it run its own script and Square's alone, so nothing else on
// the page can draw a box of its own; it frames https pages alone (Square's, and the card's bank's own check, at any
// bank's address), and only the page itself is listened to. Square draws only on a secure page: the page is given
// the api's own address (https, or localhost on the laptop).
//
// The same page runs the bank's check before Pay on a repeating membership (20i-ii): with no boxes, Square checks the saved
// card for the amount to be charged (`Card.tokenize(verificationDetails, cardId)`, its newer way for a card on file),
// draws the card's bank's own box where the bank asks, and hands back its pass for that card. Tried in Square's test area
// on 2026-11-14: no boxes are needed, an ordinary card answers in about two seconds with no box, and Cancel in the bank's
// box makes Square refuse with "An error occurred while verifying the buyer".

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
function shown(el){var st=window.getComputedStyle(el);if(st.display==="none"||st.visibility==="hidden")return false;var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}
function check(){var on=false;var all=document.body.children;for(var i=0;i<all.length;i++){var el=all[i];if(el===box||el.tagName==="SCRIPT")continue;if(shown(el))on=true;}if(on!==tall){tall=on;say({kind:"tall",on:on});}}
function draw(){
if(!window.Square){say({kind:"blocked"});return;}
var payments;
try{payments=window.Square.payments(form.applicationId,form.locationId);}catch(e){say({kind:"blocked"});return;}
if(form.check){payments.card().then(function(c){card=c;say({kind:"ready"});}).catch(function(){say({kind:"blocked"});});return;}
payments.card({style:form.style}).then(function(c){return c.attach("#card").then(function(){card=c;say({kind:"ready"});height();});}).catch(function(){say({kind:"blocked"});});
}
window.kwazoCheck=function(){
if(card===null||busy||!form.check)return;
busy=true;
var k=form.check;
card.tokenize({amount:k.amount,currencyCode:k.currencyCode,intent:"CHARGE",customerInitiated:true,sellerKeyedIn:false,billingContact:form.contact},k.cardId).then(function(r){busy=false;if(r&&r.status==="OK"&&typeof r.token==="string")say({kind:"pass",token:r.token});else say({kind:"not_taken"});},function(e){busy=false;var m=String((e&&e.message)||"");say({kind:/verif/i.test(m)?"bank_no":"not_taken"});});
};
window.kwazoSave=function(){
if(card===null||busy)return;
busy=true;
card.tokenize({intent:"STORE",customerInitiated:true,sellerKeyedIn:false,billingContact:form.contact}).then(function(r){busy=false;if(r&&r.status==="OK"&&typeof r.token==="string")say({kind:"token",token:r.token});else say({kind:"not_taken"});},function(){busy=false;say({kind:"not_taken"});});
};
var sizes=window.ResizeObserver?new ResizeObserver(function(){check();height();}):null,watched=[];
function watch(){if(sizes===null)return;var all=document.body.children;for(var i=0;i<all.length;i++){var el=all[i];if(el.tagName==="SCRIPT"||watched.indexOf(el)>=0)continue;watched.push(el);sizes.observe(el);}}
watch();
new MutationObserver(function(){watch();check();height();}).observe(document.body,{childList:true,subtree:true,attributes:true});
document.addEventListener("transitionend",check,true);
document.addEventListener("animationend",check,true);
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

/** The page's policy: its own script by fingerprint, Square's scripts, styles, fonts and the address the card goes to,
 *  and https frames and forms for Square and the bank's check; nothing else. */
export const CARD_PAGE_POLICY = [
  "default-src 'none'",
  `script-src ${PAGE_SCRIPT_HASH} ${SQUARE.join(" ")}`,
  `style-src 'unsafe-inline' ${SQUARE.join(" ")}`,
  `font-src data: ${SQUARE_FONTS.join(" ")}`,
  `img-src data: ${SQUARE.join(" ")}`,
  `connect-src ${[...SQUARE, ...SQUARE_CONNECT].join(" ")}`,
  // The bank's own check (3-D Secure): Square's script puts the card's bank's frame on the page itself and posts its form
  // there, at any bank's address. Only the page itself is listened to (AddCard's onMessage), never a frame.
  "frame-src https:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action https:",
].join("; ");

/** Data in the page, safe inside its block: no "<" that could end it. */
const inert = (value: unknown): string => JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** What the bank's check before Pay checks (20i-ii): the saved card, and today's amount as Square takes it ("25.00"). */
export interface CardCheck {
  cardId: string;
  amount: string;
  currencyCode: string;
}

/** The page for one gym's form, or null for a form that is not one the server would send. With `check`, no boxes: the
 *  bank's check of the saved card before Pay (20i-ii). */
export function cardPage(form: CardForm, check: CardCheck | null = null): string | null {
  const parsed = cardFormSchema.safeParse(form);
  if (!parsed.success) return null;
  const f = parsed.data;
  const contact = {
    ...(f.contact.givenName === "" ? {} : { givenName: f.contact.givenName }),
    ...(f.contact.familyName === "" ? {} : { familyName: f.contact.familyName }),
    ...(f.contact.email === null ? {} : { email: f.contact.email }),
    countryCode: f.contact.countryCode,
  };
  if (check !== null && !(squareCardIdSchema.safeParse(check.cardId).success && /^[0-9]{1,8}(\.[0-9]{1,3})?$/.test(check.amount) && /^[A-Z]{3}$/.test(check.currencyCode))) return null;
  const data = { script: SCRIPT[f.environment], applicationId: f.applicationId, locationId: f.locationId, contact, style: STYLE, check };
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

/** The script the app runs to start the bank's check before Pay (20i-ii). */
export const CHECK_SCRIPT = "window.kwazoCheck&&window.kwazoCheck();true;";

/** Where a load the page starts goes. `load`: in the page (the page itself, Square's frames, and the bank's own check
 *  that Square's script frames on it). `outside`: the phone's browser (a link Square shows, such as its privacy
 *  page). `refuse`: nowhere — the page never moves off itself. */
export function cardWhereTo(url: string, topFrame: boolean, page: string): "load" | "outside" | "refuse" {
  if (url === "about:blank" || url === "about:srcdoc") return "load";
  if (topFrame) {
    if (url === page) return "load";
    return url.startsWith("https://") ? "outside" : "refuse";
  }
  // A frame: Square's, and the bank's own check that Square's script puts on the page (any bank's address).
  return url.startsWith("https://") ? "load" : "refuse";
}
