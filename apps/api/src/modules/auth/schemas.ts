// P2.1 — module schema surface (R7.2): contracts live in @app/shared; this
// file only re-exports what the auth module consumes.
export {
  authSessionResponseSchema,
  authUserSchema,
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  registerResponseSchema,
  resetPasswordRequestSchema,
  sendCodeRequestSchema,
  verifyCodeRequestSchema,
  verifyEmailRequestSchema,
} from "@app/shared";
export type {
  AuthSessionResponse,
  AuthUser,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  ResetPasswordRequest,
  SendCodeRequest,
  VerifyCodeRequest,
  VerifyEmailRequest,
} from "@app/shared";
