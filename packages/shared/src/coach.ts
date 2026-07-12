// P2.5b — coach chat contracts (R7.2). Message cap 2000 chars ports
// routers/coach.py:32 ("token cost per call is bounded"). Non-streaming
// (DECISIONS P2.5 GAP-3).
import { z } from "zod";

export const COACH_MAX_MESSAGE_CHARS = 2000; // routers/coach.py:32

export const coachChatRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(COACH_MAX_MESSAGE_CHARS),
    threadId: z.string().uuid().optional(), // absent = start a new thread
  })
  .strict();
export type CoachChatRequest = z.infer<typeof coachChatRequestSchema>;

export const coachChatResponseSchema = z.object({
  threadId: z.string().uuid(),
  reply: z.string(),
  cached: z.boolean(), // exact-match answer cache hit (v1 §6.1)
});
export type CoachChatResponse = z.infer<typeof coachChatResponseSchema>;

export const coachThreadListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
});

export const coachThreadListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20), // routers/coach.py:146
    /** `<lastMessageAt ISO>|<thread uuid>` keyset cursor. */
    cursor: z.string().max(120).optional(),
  })
  .strict();
export type CoachThreadListQuery = z.infer<typeof coachThreadListQuerySchema>;

export const coachThreadPageSchema = z.object({
  items: z.array(coachThreadListItemSchema),
  nextCursor: z.string().nullable(),
});
export type CoachThreadPage = z.infer<typeof coachThreadPageSchema>;

export const coachMessageViewSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  createdAt: z.string(),
});

export const coachThreadDetailSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  messages: z.array(coachMessageViewSchema),
});
export type CoachThreadDetail = z.infer<typeof coachThreadDetailSchema>;
