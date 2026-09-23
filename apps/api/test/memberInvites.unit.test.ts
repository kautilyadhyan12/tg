// Member invitations, the pure parts (ROADMAP 3b-i-a; Part 3 §9.12): the rule that
// decides whether an email may go, the shared-address rule, the gym's words in an
// email, the unsubscribe token, the mail-domain check, the email itself and the Resend
// transport. No database.
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { safeRequestSerializer } from "../src/logSafety.js";
import { createResendInviteTransport, type InviteEmail } from "../src/email/resend.js";
import { memberInviteEmail, memberInviteFrom } from "../src/email/templates.js";
import { emailHmac, isSharedAddress } from "../src/modules/orgs/invites/address.js";
import { decideSend, type SendFacts } from "../src/modules/orgs/invites/decide.js";
import { cleanGymText, gymNameForEmail } from "../src/modules/orgs/invites/gymText.js";
import { cachedMailDomainCheck, checkMailDomain, type MailResolver } from "../src/modules/orgs/invites/mailDomain.js";
import { devInviteTransport } from "../src/modules/orgs/invites/sender.js";
import { inviteSettings } from "../src/modules/orgs/invites/settings.js";
import { readUnsubscribeToken, unsubscribeToken } from "../src/modules/orgs/invites/token.js";

// =========================================================================
// THE RULE: MAY THIS EMAIL GO NOW?
// =========================================================================

const allowed: SendFacts = {
  inviteState: "pending",
  addressMatchesInvite: true,
  gym: { active: true, onPlan: true, stopped: false, hasPostalAddress: true, named: true },
  onList: true,
  inApp: false,
  suppression: null,
  addressValid: true,
  shared: false,
  mail: "accepts",
};

describe("decideSend — every class of case", () => {
  const cases: [string, Partial<SendFacts>, ReturnType<typeof decideSend>][] = [
    ["everything allows it", {}, { kind: "send" }],
    ["the domain has not been asked yet", { mail: null }, { kind: "check_mail" }],
    ["the domain takes no mail", { mail: "no_mail" }, { kind: "skip", reason: "no_mail_domain" }],
    ["the domain could not be asked", { mail: "unknown" }, { kind: "retry", reason: "dns_unavailable" }],
    ["the gym is gone", { gym: null }, { kind: "skip", reason: "gym_not_active" }],
    ["the gym is archived", { gym: { active: false, onPlan: true, stopped: false, hasPostalAddress: true, named: true } }, { kind: "skip", reason: "gym_not_active" }],
    ["the gym has no plan", { gym: { active: true, onPlan: false, stopped: false, hasPostalAddress: true, named: true } }, { kind: "skip", reason: "gym_not_active" }],
    ["the gym has no postal address", { gym: { active: true, onPlan: true, stopped: false, hasPostalAddress: false, named: true } }, { kind: "skip", reason: "no_postal_address" }],
    ["the gym's sending was stopped", { gym: { active: true, onPlan: true, stopped: true, hasPostalAddress: true, named: true } }, { kind: "skip", reason: "sending_stopped" }],
    ["a stopped gym and an unsubscribe", { gym: { active: true, onPlan: true, stopped: true, hasPostalAddress: true, named: true }, suppression: "unsubscribed" }, { kind: "skip", reason: "sending_stopped" }],
    ["the gym's name cannot be shown", { gym: { active: true, onPlan: true, stopped: false, hasPostalAddress: true, named: false } }, { kind: "skip", reason: "gym_name" }],
    ["the invitation is gone", { inviteState: null }, { kind: "skip", reason: "invitation_closed" }],
    ["the invitation was accepted", { inviteState: "accepted" }, { kind: "skip", reason: "invitation_closed" }],
    ["the invitation was declined", { inviteState: "declined" }, { kind: "skip", reason: "invitation_closed" }],
    ["the invitation was withdrawn", { inviteState: "withdrawn" }, { kind: "skip", reason: "invitation_closed" }],
    ["the address is not the invitation's", { addressMatchesInvite: false }, { kind: "skip", reason: "not_on_list" }],
    ["no current entry holds the address", { onList: false }, { kind: "skip", reason: "not_on_list" }],
    ["the person joined the app since", { inApp: true }, { kind: "skip", reason: "in_app" }],
    ["the person unsubscribed", { suppression: "unsubscribed" }, { kind: "skip", reason: "unsubscribed" }],
    ["the person complained", { suppression: "complained" }, { kind: "skip", reason: "complained" }],
    ["the address bounces", { suppression: "bounced" }, { kind: "skip", reason: "bounced" }],
    ["the address is not valid", { addressValid: false }, { kind: "skip", reason: "bad_address" }],
    ["the address is a shared mailbox", { shared: true }, { kind: "skip", reason: "shared_address" }],
    // Order: a stop that holds for every address comes before one about this address,
    // and nothing about the address is asked of DNS once it is already ruled out.
    ["a lapsed gym and an unsubscribe", { gym: { active: true, onPlan: false, stopped: false, hasPostalAddress: true, named: true }, suppression: "unsubscribed" }, { kind: "skip", reason: "gym_not_active" }],
    ["taken off the list and unsubscribed", { onList: false, suppression: "unsubscribed" }, { kind: "skip", reason: "not_on_list" }],
    ["unsubscribed, with no domain asked", { suppression: "unsubscribed", mail: null }, { kind: "skip", reason: "unsubscribed" }],
    ["shared, with no domain asked", { shared: true, mail: null }, { kind: "skip", reason: "shared_address" }],
    ["in the app, with the domain down", { inApp: true, mail: "unknown" }, { kind: "skip", reason: "in_app" }],
  ];
  for (const [name, change, expected] of cases) {
    it(name, () => {
      expect(decideSend({ ...allowed, ...change })).toEqual(expected);
    });
  }

  it("sends only when every fact allows it", () => {
    const flips: Partial<SendFacts>[] = [
      { inviteState: "declined" },
      { addressMatchesInvite: false },
      { gym: null },
      { gym: { active: true, onPlan: true, stopped: true, hasPostalAddress: true, named: true } },
      { onList: false },
      { inApp: true },
      { suppression: "unsubscribed" },
      { addressValid: false },
      { shared: true },
      { mail: "no_mail" },
    ];
    for (const flip of flips) expect(decideSend({ ...allowed, ...flip }).kind).not.toBe("send");
  });
});

// =========================================================================
// SHARED MAILBOXES — cases from RFC 2142 and Mailchimp's list, and the people
// whose addresses look like them
// =========================================================================

describe("isSharedAddress", () => {
  // RFC 2142 §3–§5, every name, as the RFC writes them (upper case).
  const rfc2142 = ["INFO", "MARKETING", "SALES", "SUPPORT", "ABUSE", "NOC", "SECURITY", "POSTMASTER", "HOSTMASTER", "USENET", "NEWS", "WEBMASTER", "WWW", "UUCP", "FTP"];
  // Mailchimp, "Limits on Role-Based Addresses", every prefix.
  const mailchimp = [
    "abuse", "admin", "billing", "compliance", "devnull", "dns", "ftp", "hostmaster", "inoc", "ispfeedback", "ispsupport",
    "list-request", "list", "maildaemon", "noc", "no-reply", "noreply", "null", "phish", "phishing", "postmaster", "privacy",
    "registrar", "root", "security", "spam", "support", "sysadmin", "tech", "undisclosed-recipients", "unsubscribe", "usenet",
    "uucp", "webmaster", "www",
  ];
  it("every RFC 2142 mailbox, in any case (§2: recognised independent of case)", () => {
    for (const name of rfc2142) {
      expect(isSharedAddress(`${name}@gym.example.com`)).toBe(true);
      expect(isSharedAddress(`${name.toLowerCase()}@gym.example.com`)).toBe(true);
      expect(isSharedAddress(`${name[0] ?? ""}${name.slice(1).toLowerCase()}@gym.example.com`)).toBe(true);
    }
  });
  it("every Mailchimp role prefix", () => {
    for (const name of mailchimp) expect(isSharedAddress(`${name}@example.co.uk`)).toBe(true);
  });
  it("a +tag on a shared mailbox is the same mailbox (RFC 5233)", () => {
    expect(isSharedAddress("info+members@gym.com")).toBe(true);
    expect(isSharedAddress("Support+Leeds@gym.com")).toBe(true);
  });
  it("people whose addresses only contain a role word are people", () => {
    for (const person of [
      "infoguy@gmail.com",
      "jane.sales@outlook.com",
      "sales.team.lead@company.com",
      "admin.jones@yahoo.co.uk",
      "support4you@hotmail.com",
      "marketingmaria@icloud.com",
      "wwwilliams@gmail.com",
      "postmaster.general@gmail.com",
      "news-anchor.kim@gmail.com",
      "tech.tom@gmail.com",
      "rootbeer@gmail.com",
      "+info@gmail.com",
    ]) {
      expect(isSharedAddress(person), person).toBe(false);
    }
  });
  it("shared-sounding words neither list names are emailed (the lists are the rule, not a guess)", () => {
    for (const address of ["reception@gym.com", "frontdesk@gym.com", "hello@gym.com", "contact@gym.com", "office@gym.com", "team@gym.com", "enquiries@gym.co.uk"]) {
      expect(isSharedAddress(address), address).toBe(false);
    }
  });
});

describe("emailHmac", () => {
  const key = Buffer.from("k".repeat(32));
  it("is the same for one address in any case, and differs by key and by address", () => {
    expect(emailHmac(key, "Ann@Gym.com")).toBe(emailHmac(key, "ann@gym.com"));
    expect(emailHmac(key, " ann@gym.com ")).toBe(emailHmac(key, "ann@gym.com"));
    expect(emailHmac(key, "ann@gym.com")).not.toBe(emailHmac(Buffer.from("j".repeat(32)), "ann@gym.com"));
    // Gmail's dots are NOT folded: exact keys only (spec §9.2 rule 4).
    expect(emailHmac(key, "a.nn@gmail.com")).not.toBe(emailHmac(key, "ann@gmail.com"));
    expect(emailHmac(key, "ann@gym.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// =========================================================================
// A GYM'S WORDS IN AN EMAIL: no link, no address, no control characters
// =========================================================================

describe("cleanGymText", () => {
  const cases: [string, string, string][] = [
    ["a plain name", "Iron House Gym", "Iron House Gym"],
    ["an apostrophe and an ampersand", "St John's Strength & Conditioning", "St John's Strength & Conditioning"],
    ["a scheme link", "Iron House https://evil.example/login now", "Iron House now"],
    ["a www link", "Iron House www.evil.example", "Iron House"],
    ["a bare domain", "Gym.com Fitness", "Gym com Fitness"],
    ["a domain with a country code", "claim-your-prize.co.uk", "claim-your-prize co uk"],
    ["an upper-case domain", "BEST-GYM.NET", "BEST-GYM NET"],
    ["an address", "Mail me at ann@evil.example", "Mail me at ann evil example"],
    ["a dot before a number stays", "No.5 Studio", "No.5 Studio"],
    ["an abbreviation then a space stays", "St. John's", "St. John's"],
    ["a zero-width space hiding a domain", "gym​.com", "gym .com"],
    ["a right-to-left override", "Iron‮House", "Iron House"],
    ["a new line inside a name", "Iron\nHouse", "Iron, House"],
    ["an address over lines", "12 High Street\r\nLeeds LS1 1AA\n\nUnited Kingdom", "12 High Street, Leeds LS1 1AA, United Kingdom"],
    ["a tab", "Iron\tHouse", "Iron House"],
    ["a link on a line of its own leaves no empty part", "12 High Street\nwww.evil.example\nLeeds", "12 High Street, Leeds"],
    ["a link between commas leaves one comma", "Unit 4, www.evil.example, Leeds", "Unit 4, Leeds"],
    ["a link at the end of a line keeps the join's comma", "Mill Lane https://evil.example\nLeeds", "Mill Lane, Leeds"],
    ["a comma-separated address is kept as written", "Unit 4, Mill Lane, Leeds LS2 7AB", "Unit 4, Mill Lane, Leeds LS2 7AB"],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(cleanGymText(input, 200)).toBe(expected);
    });
  }
  it("a gym named like a web address is still named in an email, and a name of nothing but symbols is not", () => {
    expect(gymNameForEmail("Iron House")).toBe("Iron House");
    expect(gymNameForEmail("www.IronHouse.com")).toBe("IronHouse com");
    expect(gymNameForEmail("https://ironhouse.fit")).toBe("ironhouse fit");
    expect(gymNameForEmail("HTTP://www.gym.co.uk/join")).toBe("gym co uk/join");
    expect(gymNameForEmail("@@@")).toBe("");
  });

  it("cuts at the limit without splitting a character", () => {
    expect(cleanGymText("a".repeat(80), 60)).toHaveLength(60);
    const emoji = "💪".repeat(70);
    const cut = cleanGymText(emoji, 60);
    expect(Array.from(cut)).toHaveLength(60);
    expect(cut).toBe("💪".repeat(60));
  });
});

// =========================================================================
// THE UNSUBSCRIBE TOKEN
// =========================================================================

describe("the development sender's log", () => {
  it("names the join link and the send, never the unsubscribe token or the address", async () => {
    const lines: unknown[] = [];
    const dev = devInviteTransport({ info: (obj) => lines.push(obj) });
    await dev.send({
      to: "ann@example.org",
      subject: "You're a member of Iron House — get the app",
      text: "… https://app.example.com/join/iron-house … https://api.example.com/v1/email/unsubscribe?t=SECRETTOKEN.MAC",
      html: "",
      from: "",
      headers: { "List-Unsubscribe": "<https://api.example.com/v1/email/unsubscribe?t=SECRETTOKEN.MAC>" },
      idempotencyKey: "member-invite-1",
    });
    const written = JSON.stringify(lines);
    expect(written).toContain("https://app.example.com/join/iron-house");
    expect(written).not.toContain("SECRETTOKEN");
    expect(written).not.toContain("ann@example.org");
  });
});

describe("the unsubscribe link in the api's request log", () => {
  it("is logged without its token: the token rides in the query string, which the log drops", () => {
    const logged = safeRequestSerializer({ method: "POST", url: "/v1/email/unsubscribe?t=CwqCVp1OTxqLbC09T1prfA.AAAAAAAAAAAAAAAAAAAAAA" });
    expect(logged.url).toBe("/v1/email/unsubscribe");
  });
});

describe("unsubscribe token", () => {
  const key = Buffer.from("unsubscribe-test-key-0123456789ab");
  const id = "0b7a3c52-9d4e-4f1a-8b6c-2d3e4f5a6b7c";
  it("names the invitation it was made for", () => {
    const token = unsubscribeToken(key, id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{22}$/);
    expect(readUnsubscribeToken(key, token)).toBe(id);
  });
  it("refuses the same bytes spelled another way (the last character of each part carries spare bits)", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const token = unsubscribeToken(key, id);
    const [idPart = "", macPart = ""] = token.split(".");
    const respell = (part: string) => {
      const last = alphabet.indexOf(part.slice(-1));
      // Only the top two of the last character's six bits are read; flip a low one.
      return part.slice(0, -1) + (alphabet[last ^ 1] ?? "");
    };
    expect(Buffer.from(respell(macPart), "base64url")).toEqual(Buffer.from(macPart, "base64url"));
    expect(readUnsubscribeToken(key, `${idPart}.${respell(macPart)}`)).toBeNull();
    expect(readUnsubscribeToken(key, `${respell(idPart)}.${macPart}`)).toBeNull();
  });

  it("refuses a real MAC with one bit changed", () => {
    const [idPart = "", macPart = ""] = unsubscribeToken(key, id).split(".");
    const bytes = Buffer.from(macPart, "base64url");
    bytes[0] = (bytes[0] ?? 0) ^ 0x01;
    expect(readUnsubscribeToken(key, `${idPart}.${bytes.toString("base64url")}`)).toBeNull();
  });

  it("refuses a changed id, a changed MAC, another key and junk", () => {
    const token = unsubscribeToken(key, id);
    const [idPart, mac] = token.split(".");
    const otherId = unsubscribeToken(key, "0b7a3c52-9d4e-4f1a-8b6c-2d3e4f5a6b7d").split(".")[0]; // a made-up id, gitleaks:allow
    expect(readUnsubscribeToken(key, `${otherId ?? ""}.${mac ?? ""}`)).toBeNull();
    expect(readUnsubscribeToken(key, `${idPart ?? ""}.${"A".repeat(22)}`)).toBeNull();
    expect(readUnsubscribeToken(Buffer.from("another-key-0123456789abcdefghij"), token)).toBeNull();
    for (const junk of ["", ".", "abc", `${token}x`, token.replace(".", ""), "../../etc/passwd"]) {
      expect(readUnsubscribeToken(key, junk)).toBeNull();
    }
  });
});

// =========================================================================
// DOES THE DOMAIN TAKE MAIL — RFC 5321 §5.1, RFC 7505
// =========================================================================

const dnsError = (code: string) => Object.assign(new Error(code), { code });

function resolver(parts: Partial<MailResolver>): MailResolver {
  return {
    resolveMx: parts.resolveMx ?? (() => Promise.reject(dnsError("ENODATA"))),
    resolve4: parts.resolve4 ?? (() => Promise.reject(dnsError("ENODATA"))),
    resolve6: parts.resolve6 ?? (() => Promise.reject(dnsError("ENODATA"))),
  };
}

describe("checkMailDomain", () => {
  // Shapes read from Node's resolver on 2026-09-23 through 1.1.1.1: gmail.com's five
  // MX records; example.com's null MX came back as [{ exchange: "", priority: 0 }];
  // a name that does not exist as ENOTFOUND.
  it("MX records: takes mail", async () => {
    const mx = [{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }, { exchange: "alt1.gmail-smtp-in.l.google.com", priority: 10 }];
    expect(await checkMailDomain(resolver({ resolveMx: () => Promise.resolve(mx) }), "gmail.com")).toBe("accepts");
  });
  it("a null MX (RFC 7505): takes none", async () => {
    expect(await checkMailDomain(resolver({ resolveMx: () => Promise.resolve([{ exchange: "", priority: 0 }]) }), "example.com")).toBe("no_mail");
  });
  it("a domain that does not exist: takes none", async () => {
    expect(await checkMailDomain(resolver({ resolveMx: () => Promise.reject(dnsError("ENOTFOUND")) }), "nope.invalid")).toBe("no_mail");
  });
  it("no MX but an address record: takes mail (the implicit MX)", async () => {
    expect(await checkMailDomain(resolver({ resolve4: () => Promise.resolve(["203.0.113.7"]) }), "small.example")).toBe("accepts");
    expect(await checkMailDomain(resolver({ resolve6: () => Promise.resolve(["2001:db8::7"]) }), "small.example")).toBe("accepts");
  });
  it("no MX and no address: takes none", async () => {
    expect(await checkMailDomain(resolver({}), "parked.example")).toBe("no_mail");
  });
  it("a resolver that fails is not an answer", async () => {
    for (const code of ["ESERVFAIL", "ETIMEOUT", "ECONNREFUSED", "EREFUSED"]) {
      expect(await checkMailDomain(resolver({ resolveMx: () => Promise.reject(dnsError(code)) }), "gym.com")).toBe("unknown");
    }
    expect(await checkMailDomain(resolver({ resolve4: () => Promise.reject(dnsError("ETIMEOUT")) }), "gym.com")).toBe("unknown");
  });
  it("remembers an answer for a day and never remembers 'unknown'", async () => {
    let asked = 0;
    let fail = true;
    let clock = 0;
    const check = cachedMailDomainCheck(
      resolver({
        resolveMx: () => {
          asked += 1;
          return fail ? Promise.reject(dnsError("ESERVFAIL")) : Promise.resolve([{ exchange: "mx.gym.com", priority: 10 }]);
        },
      }),
      () => clock,
    );
    expect(await check("gym.com")).toBe("unknown");
    fail = false;
    expect(await check("gym.com")).toBe("accepts");
    expect(await check("gym.com")).toBe("accepts");
    expect(asked).toBe(2);
    clock += 24 * 60 * 60 * 1000 + 1;
    expect(await check("gym.com")).toBe("accepts");
    expect(asked).toBe(3);
  });
});

// =========================================================================
// THE EMAIL
// =========================================================================

describe("the invitation email", () => {
  const words = {
    to: "ann@example.org",
    gymName: "Iron House",
    gymCity: "Leeds",
    postalAddress: "12 High Street, Leeds LS1 1AA",
    joinLink: "https://app.example.com/join/iron-house",
    unsubscribeLink: "https://api.example.com/v1/email/unsubscribe/abc.def",
  };
  it("has the ruled subject, both links, the gym's postal address, and no other link", () => {
    const email = memberInviteEmail(words);
    expect(email.subject).toBe("You're a member of Iron House — get the app");
    expect(email.to).toBe("ann@example.org");
    expect(email.text).toContain(words.joinLink);
    expect(email.text).toContain(words.unsubscribeLink);
    expect(email.text).toContain("12 High Street, Leeds LS1 1AA");
    expect(email.text).toContain("Iron House in Leeds");
    expect(email.text.match(/https?:\/\//g)).toHaveLength(2);
    expect(email.html.match(/href=/g)).toHaveLength(2);
  });
  it("escapes the gym's words in the HTML", () => {
    const email = memberInviteEmail({ ...words, gymName: "<b>Iron</b> & \"House\"" });
    expect(email.html).not.toContain("<b>Iron</b>");
    expect(email.html).toContain("&lt;b&gt;Iron&lt;/b&gt; &amp; &quot;House&quot;");
  });
  it("names the gym in From, on the invitations' own mailbox, with no RFC 5322 specials", () => {
    expect(memberInviteFrom("AI Home Gym <invites@invites.example.com>", "Iron House")).toBe(
      "Iron House via AI Home Gym <invites@invites.example.com>",
    );
    expect(memberInviteFrom("invites@invites.example.com", 'Smith, Jones & Co. "Gym" <x> (1)')).toBe(
      "Smith Jones & Co Gym x 1 via AI Home Gym <invites@invites.example.com>",
    );
  });
});

// =========================================================================
// RESEND, FOR INVITATIONS
// =========================================================================

describe("createResendInviteTransport", () => {
  const message: InviteEmail = {
    to: "ann@example.org",
    subject: "s",
    text: "t",
    html: "h",
    from: "Iron House via AI Home Gym <invites@invites.example.com>",
    headers: { "List-Unsubscribe": "<https://api.example.com/u/x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    idempotencyKey: "member-invite-1",
  };
  const answer = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("sends the key, the headers and the idempotency key, and reads the id", async () => {
    const seen: { init: RequestInit }[] = [];
    const transport = createResendInviteTransport({
      apiKey: "re_test",
      fetchImpl: (_url, init) => {
        seen.push({ init: init ?? {} });
        return Promise.resolve(answer(200, { id: "msg_1" }));
      },
    });
    expect(await transport.send(message)).toEqual({ kind: "sent", id: "msg_1" });
    const call = seen[0];
    if (call === undefined) throw new Error("no request");
    const headers = new Headers(call.init.headers);
    expect(headers.get("Idempotency-Key")).toBe("member-invite-1");
    expect(headers.get("Authorization")).toBe("Bearer re_test");
    const raw = call.init.body;
    if (typeof raw !== "string") throw new Error("the body was not text");
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body["headers"]).toEqual(message.headers);
    expect(body["from"]).toBe(message.from);
    expect(body["to"]).toEqual(["ann@example.org"]);
  });

  // Three kinds of answer: it went; it did not go (Resend refused the request before
  // sending anything); and unclear, when it may have gone. Resend's errors page (read
  // 2026-09-23): 400 validation_error and 422 missing_required_field describe the
  // request, 401 and 403 the key and account, 429 the rate.
  const cases: [string, () => Promise<Response>, string][] = [
    ["an idempotency key already used with another body means it went", () => Promise.resolve(answer(409, { name: "invalid_idempotent_request" })), "sent"],
    ["the same key still running: it may have gone", () => Promise.resolve(answer(409, { name: "concurrent_idempotent_requests" })), "unclear"],
    ["a request Resend could not read (422) did not go", () => Promise.resolve(answer(422, { name: "missing_required_field" })), "not_sent"],
    ["a bad request (400) did not go", () => Promise.resolve(answer(400, { name: "validation_error" })), "not_sent"],
    ["our key is wrong: it did not go", () => Promise.resolve(answer(401, { name: "missing_api_key" })), "not_sent"],
    ["our account is refused: it did not go", () => Promise.resolve(answer(403, { name: "invalid_access" })), "not_sent"],
    ["too many requests: it did not go", () => Promise.resolve(answer(429, { name: "rate_limit_exceeded" })), "not_sent"],
    ["Resend is down: it may have gone", () => Promise.resolve(answer(503, {})), "unclear"],
    ["Resend failed inside: it may have gone", () => Promise.resolve(answer(500, {})), "unclear"],
    ["the network failed: it may have gone", () => Promise.reject(new Error("socket hang up")), "unclear"],
    ["a 200 with no id still went", () => Promise.resolve(answer(200, {})), "sent"],
  ];
  for (const [name, reply, kind] of cases) {
    it(name, async () => {
      const transport = createResendInviteTransport({ apiKey: "re_test", fetchImpl: reply });
      expect((await transport.send(message)).kind).toBe(kind);
    });
  }
});

// =========================================================================
// CONFIGURATION
// =========================================================================

describe("invitation settings", () => {
  const good = {
    DATABASE_URL: "postgres://x:y@localhost:5432/z",
    WEB_ORIGIN: "http://localhost:5173",
    JWT_SECRET: "config-test-secret-0123456789abcdef-32", // gitleaks:allow
    REDIS_URL: "redis://localhost:6379",
  };
  const prod = { ...good, NODE_ENV: "production", RESEND_API_KEY: "re_x", EMAIL_FROM: "AI Home Gym <hi@example.com>" };

  it("production: the key alone keeps invitations readable; sending needs the sender and the api's address too", () => {
    expect(inviteSettings(loadConfig(prod))).toBeNull();
    const full = {
      ...prod,
      INVITE_EMAIL_FROM: "AI Home Gym <invites@invites.example.com>",
      INVITE_HMAC_SECRET: "invite-hmac-secret-0123456789abcdef", // gitleaks:allow
      API_ORIGIN: "https://api.example.com",
    };
    expect(inviteSettings(loadConfig(full))?.sender).not.toBeNull();
    const without = (missing: string) => Object.fromEntries(Object.entries(full).filter(([name]) => name !== missing));
    // No key: nothing can be read or sent.
    expect(inviteSettings(loadConfig(without("INVITE_HMAC_SECRET")))).toBeNull();
    // A key but no sender: sending is off, and invitations already made can still be
    // read and unsubscribed from.
    for (const missing of ["INVITE_EMAIL_FROM", "API_ORIGIN"]) {
      const settings = inviteSettings(loadConfig(without(missing)));
      expect(settings, missing).not.toBeNull();
      expect(settings?.sender, missing).toBeNull();
    }
  });
  it("outside production: a key from JWT_SECRET, this api's own address, the logging sender", () => {
    const settings = inviteSettings(loadConfig({ ...good, NODE_ENV: "development", PORT: "3001" }));
    expect(settings?.sender?.from).toBeNull();
    expect(settings?.sender?.apiOrigin).toBe("http://localhost:3001");
    expect(settings?.hmacKey.length).toBe(32);
    expect(settings?.perDay).toBe(2000);
    expect(settings?.paused).toBe(false);
  });
  it("the off switch and the day's cap are read", () => {
    const settings = inviteSettings(loadConfig({ ...good, INVITES_PAUSED: "true", INVITE_EMAILS_PER_DAY: "7" }));
    expect(settings?.paused).toBe(true);
    expect(settings?.perDay).toBe(7);
    expect(() => loadConfig({ ...good, INVITES_PAUSED: "yes" })).toThrow(/INVITES_PAUSED/);
  });
  it("an invitations sender needs a Resend key, and a short secret is refused", () => {
    expect(() => loadConfig({ ...good, INVITE_EMAIL_FROM: "invites@invites.example.com" })).toThrow(/RESEND_API_KEY/);
    expect(() => loadConfig({ ...good, INVITE_HMAC_SECRET: "short" })).toThrow(/INVITE_HMAC_SECRET/);
    expect(() => loadConfig({ ...good, RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.co", INVITE_EMAIL_FROM: "not an address" })).toThrow(
      /INVITE_EMAIL_FROM/,
    );
  });
});
