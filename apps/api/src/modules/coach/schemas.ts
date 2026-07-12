// P2.5b — module schema surface (R7.2): contracts live in @app/shared.
export {
  coachChatRequestSchema,
  coachChatResponseSchema,
  coachThreadDetailSchema,
  coachThreadListQuerySchema,
  coachThreadPageSchema,
  COACH_MAX_MESSAGE_CHARS,
} from "@app/shared";
export type {
  CoachChatRequest,
  CoachChatResponse,
  CoachThreadDetail,
  CoachThreadListQuery,
  CoachThreadPage,
} from "@app/shared";
