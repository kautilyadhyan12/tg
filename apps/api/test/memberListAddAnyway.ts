// Add member's "Add anyway" (ROADMAP 5b-iv-b), for suites that type a second record of somebody
// on purpose: sent once, and when the list warns "may already be on your list", sent again
// naming the records the warning named, as the screen does. Any other answer is returned as it is.
import { memberListMayBeOnListSchema } from "@app/shared";

interface Reply {
  statusCode: number;
  body: string;
}

export async function addAnyway<R extends Reply>(send: (body: Record<string, unknown>) => Promise<R>, body: Record<string, unknown>): Promise<R> {
  const first = await send(body);
  if (first.statusCode !== 409) return first;
  const warned = memberListMayBeOnListSchema.safeParse(JSON.parse(first.body));
  if (!warned.success) return first;
  return await send({ ...body, acknowledgedDuplicates: warned.data.people.map((person) => person.entryId) });
}
