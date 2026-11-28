import type { FastifyInstance } from "fastify";

/**
 * The most list items one request may carry, nested lists included: counted in its JSON body
 * before the body is parsed, and again in its query string. A route that really sends more
 * declares its own number in its `config.listItemsMost`.
 *
 * Why: zod keeps one issue for every list item that fails, and a list with no `.max()` is read
 * to its end. Measured 2026-11-09: a 1 MB body of 500,000 wrong items took 166 MB of memory on
 * zod 3.25.76 and 263 MB on zod 4.6.7, and a 14 MB one took 2.5 GB, more than the server has.
 * 25,000 is above every list the app sends except a run's points (geo routes).
 *
 * The body is counted in its text, in one pass, never by walking the parsed value: walking a
 * list-free object of a million keys cost more than parsing it (round one, H1).
 */
export const LIST_ITEMS_MOST = 25_000;

declare module "fastify" {
  interface FastifyContextConfig {
    /** This route's own `LIST_ITEMS_MOST`. */
    listItemsMost?: number;
    /** The most object keys a body may hold, counted the same way, for a route that names it. Zod checks every key of a
     *  record, and names every unknown key of a strict object: a body of 131,594 keys in one record held the server half a
     *  second and answered 500 (job 64b-i, round one, H1). Not counted for a route that names none. */
    objectMembersMost?: number;
  }
}

/** Answered 413 by the app's error handler. */
export class TooManyItemsError extends Error {
  readonly statusCode = 413;
  readonly code = "too_many_items";
  constructor() {
    super("This request holds more items than the server takes.");
  }
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_LIST = 0x5b;
const CLOSE_LIST = 0x5d;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const isSpace = (c: number): boolean => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09;

/**
 * The list items in a JSON text, in one pass, stopping as soon as `most` is passed. Text that is
 * not JSON gives some number and is then refused by the parser.
 */
export function countJsonListItems(text: string, most: number): number {
  let count = 0;
  // One entry a bracket still open: true for a list, false for an object.
  const open: boolean[] = [];
  // Whether the innermost open list has had an item yet.
  let listHasItem = false;
  const hadItem: boolean[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) continue;
    const inList = open.length > 0 && open[open.length - 1] === true;
    if (inList && !listHasItem && c !== CLOSE_LIST) {
      count++;
      listHasItem = true;
    }
    if (c === QUOTE) {
      // To the closing quote, past any escaped one.
      let j = i + 1;
      while (j < text.length) {
        const d = text.charCodeAt(j);
        if (d === BACKSLASH) j += 2;
        else if (d === QUOTE) break;
        else j++;
      }
      i = j;
    } else if (c === COMMA) {
      if (inList) count++;
    } else if (c === OPEN_LIST || c === OPEN_OBJECT) {
      open.push(c === OPEN_LIST);
      hadItem.push(listHasItem);
      listHasItem = false;
    } else if (c === CLOSE_LIST || c === CLOSE_OBJECT) {
      open.pop();
      listHasItem = hadItem.pop() ?? false;
    }
    if (count > most) return count;
  }
  return count;
}

/**
 * The keys of every object in a JSON text, nested ones included, in one pass, stopping as soon as `most` is passed: the
 * same walk as `countJsonListItems`, counting an object's members where that counts a list's items.
 */
export function countJsonObjectMembers(text: string, most: number): number {
  let count = 0;
  // One entry a bracket still open: true for an object, false for a list.
  const open: boolean[] = [];
  // Whether the innermost open object has had a member yet.
  let objectHasMember = false;
  const hadMember: boolean[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isSpace(c)) continue;
    const inObject = open.length > 0 && open[open.length - 1] === true;
    if (inObject && !objectHasMember && c !== CLOSE_OBJECT) {
      count++;
      objectHasMember = true;
    }
    if (c === QUOTE) {
      let j = i + 1;
      while (j < text.length) {
        const d = text.charCodeAt(j);
        if (d === BACKSLASH) j += 2;
        else if (d === QUOTE) break;
        else j++;
      }
      i = j;
    } else if (c === COMMA) {
      if (inObject) count++;
    } else if (c === OPEN_LIST || c === OPEN_OBJECT) {
      open.push(c === OPEN_OBJECT);
      hadMember.push(objectHasMember);
      objectHasMember = false;
    } else if (c === CLOSE_LIST || c === CLOSE_OBJECT) {
      open.pop();
      objectHasMember = hadMember.pop() ?? false;
    }
    if (count > most) return count;
  }
  return count;
}

/** The list items in a parsed value, counted without recursion, stopping as soon as `most` is passed.
 *  For the query string only, which Node holds to 16 KB. */
export function countListItems(value: unknown, most: number): number {
  let count = 0;
  const waiting: unknown[] = [value];
  while (waiting.length > 0) {
    const next = waiting.pop();
    if (typeof next !== "object" || next === null) continue;
    if (Array.isArray(next)) {
      count += next.length;
      if (count > most) return count;
      for (const item of next) if (typeof item === "object" && item !== null) waiting.push(item);
    } else {
      for (const item of Object.values(next)) if (typeof item === "object" && item !== null) waiting.push(item);
    }
  }
  return count;
}

/** Refuses a request holding more list items than its route takes, before any route reads it. */
export function registerListLimit(app: FastifyInstance): void {
  // Fastify's own JSON parser, with its own settings (a `__proto__` or `constructor` key refused),
  // run only on a body whose count is within the route's.
  const parseJson = app.getDefaultJsonParser("error", "error");
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    const most = req.routeOptions.config.listItemsMost ?? LIST_ITEMS_MOST;
    const members = req.routeOptions.config.objectMembersMost;
    if (countJsonListItems(text, most) > most || (members !== undefined && countJsonObjectMembers(text, members) > members)) {
      done(new TooManyItemsError(), undefined);
      return;
    }
    void parseJson(req, text, done);
  });
  app.addHook("preValidation", (req, _reply, done) => {
    const most = req.routeOptions.config.listItemsMost ?? LIST_ITEMS_MOST;
    done(countListItems(req.query, most) > most ? new TooManyItemsError() : undefined);
  });
}
