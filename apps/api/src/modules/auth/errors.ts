/** Typed auth failure: `code`+`statusCode` feed the central error mapper
 *  (R8.1); message is already client-safe. Its own file so the code service
 *  and the session service can both throw it without importing each other. */
export class AuthError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "AuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
