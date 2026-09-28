// A whole-list confirm as these suites were written, before each missing person was marked on
// their own (ROADMAP 5b-v-d): one "They've left" for everybody. Every person the file leaves
// out is marked Left and the leavers box's digest goes with it. A body that already carries
// marks, a confirm that is not a member list's, or a file that leaves nobody out is sent as
// it is — so a stranger's 404 or an expired upload's 409 still comes from the confirm itself.
import { memberListLeaversResponseSchema, memberListMissingResponseSchema } from "@app/shared";

interface Injector {
  inject: (options: {
    method: "GET" | "POST";
    url: string;
    remoteAddress: string;
    cookies: Record<string, string>;
    headers?: Record<string, string>;
    payload?: string;
  }) => Promise<{ statusCode: number; body: string }>;
}

const CONFIRM = /^(\/v1\/orgs\/[^/]+\/member-list\/uploads\/[^/]+)\/confirm$/;

let ip = 0;
const nextIp = () => `10.199.${String(Math.floor(ip / 250) % 250)}.${String((ip++ % 250) + 1)}`;

export async function everyoneLeft(app: Injector, path: string, payload: unknown, cookies: Record<string, string>): Promise<unknown> {
  const upload = CONFIRM.exec(path)?.[1];
  if (upload === undefined || typeof payload !== "object" || payload === null || "marks" in payload) return payload;
  const read = await app.inject({ method: "GET", url: `${upload}/missing`, remoteAddress: nextIp(), cookies });
  if (read.statusCode !== 200) return payload;
  const { missing } = memberListMissingResponseSchema.parse(JSON.parse(read.body));
  if (missing.total === 0) return payload;
  const marks = { missingDigest: missing.digest, left: missing.people.map((person) => person.entryId), stay: [] };
  const box = await app.inject({
    method: "POST",
    url: `${upload}/leavers`,
    remoteAddress: nextIp(),
    cookies,
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ marks }),
  });
  if (box.statusCode !== 200) return { ...payload, marks };
  const { leavers } = memberListLeaversResponseSchema.parse(JSON.parse(box.body));
  return { ...payload, marks, leaversDigest: leavers.preview.digest };
}
