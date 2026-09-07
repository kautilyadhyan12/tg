// P2.2 — module schema surface (R7.2): contracts live in @app/shared; this
// file only re-exports what the users module consumes.
export {
  deleteAccountRequestSchema,
  fitnessProfileResponseSchema,
  fitnessProfileSchema,
  putFitnessProfileRequestSchema,
  restoreAccountRequestSchema,
  updateProfileRequestSchema,
  userProfileResponseSchema,
  userProfileSchema,
} from "@app/shared";
export type {
  DeleteAccountRequest,
  FitnessProfile,
  FitnessProfileResponse,
  PutFitnessProfileRequest,
  RestoreAccountRequest,
  UpdateProfileRequest,
  UserProfile,
  UserProfileResponse,
} from "@app/shared";
