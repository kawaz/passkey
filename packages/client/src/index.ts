/** Browser side of passkeys: calls `navigator.credentials` and hands the result over in the WebAuthn Level 3 `toJSON()` form. */
export {
  type AuthenticationResult,
  authenticate,
  register,
  type RegistrationResult,
} from "./ceremony.js";
export { capabilities, context, type PasskeyContext } from "./environment.js";
export { PasskeyError, type PasskeyErrorKind } from "./error.js";
