// Does an address's domain take email? (Part 3 §9.12: "a cached MX lookup for the
// domain".) RFC 5321 §5.1: mail goes to the MX hosts, or to the domain's own address
// when it has no MX; RFC 7505: a single MX of "." (a null MX) says it takes none.
import { promises as dns } from "node:dns";
import type { MailCheck } from "./decide.js";

export type MailDomainCheck = (domain: string) => Promise<MailCheck>;

/** The DNS resolver's answers, narrowed to what the check reads. Injectable for tests. */
export interface MailResolver {
  resolveMx: (domain: string) => Promise<{ exchange: string; priority: number }[]>;
  resolve4: (domain: string) => Promise<string[]>;
  resolve6: (domain: string) => Promise<string[]>;
}

/** The two answers that mean "nothing there", as opposed to "could not ask". */
const NOTHING = new Set(["ENODATA", "ENOTFOUND"]);

const codeOf = (err: unknown): string | null =>
  typeof err === "object" && err !== null && "code" in err && typeof err.code === "string" ? err.code : null;

/** Ask once, three ways at most. `unknown` for anything that is not a clear answer. */
async function ask(domain: string, lookup: (d: string) => Promise<unknown[]>): Promise<"yes" | "no" | "unknown"> {
  try {
    return (await lookup(domain)).length > 0 ? "yes" : "no";
  } catch (err) {
    return NOTHING.has(codeOf(err) ?? "") ? "no" : "unknown";
  }
}

export async function checkMailDomain(resolver: MailResolver, domain: string): Promise<MailCheck> {
  let records: { exchange: string; priority: number }[] = [];
  try {
    records = await resolver.resolveMx(domain);
  } catch (err) {
    const code = codeOf(err);
    // A domain that does not exist takes no mail and has no A record to fall back to.
    if (code === "ENOTFOUND") return "no_mail";
    if (code !== "ENODATA") return "unknown";
  }
  if (records.length > 0) {
    const nullMx = records.length === 1 && records[0]?.exchange === "" && records[0].priority === 0;
    return nullMx ? "no_mail" : "accepts";
  }
  const v4 = await ask(domain, (d) => resolver.resolve4(d));
  if (v4 === "yes") return "accepts";
  const v6 = await ask(domain, (d) => resolver.resolve6(d));
  if (v6 === "yes") return "accepts";
  return v4 === "unknown" || v6 === "unknown" ? "unknown" : "no_mail";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MOST_CACHED = 10_000;

/** The check with a day's memory per domain in this process. `unknown` is never
 *  remembered: it is asked again next time. */
export function cachedMailDomainCheck(resolver: MailResolver, now: () => number): MailDomainCheck {
  const cache = new Map<string, { answer: MailCheck; until: number }>();
  return async (domain) => {
    const held = cache.get(domain);
    if (held !== undefined && held.until > now()) return held.answer;
    const answer = await checkMailDomain(resolver, domain);
    if (answer !== "unknown") {
      if (cache.size >= MOST_CACHED) cache.clear();
      cache.set(domain, { answer, until: now() + DAY_MS });
    }
    return answer;
  };
}

/** The system resolver. */
export const systemResolver: MailResolver = {
  resolveMx: (domain) => dns.resolveMx(domain),
  resolve4: (domain) => dns.resolve4(domain),
  resolve6: (domain) => dns.resolve6(domain),
};
