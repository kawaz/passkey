/** Server side of passkeys: verifies registrations and assertions in the WebAuthn Level 3 `toJSON()` form with WebCrypto alone. */
export { PasskeyVerificationError, type PasskeyVerificationReason } from "./error.js";
export {
  challengeOf,
  type PasskeyAlgorithm,
  type PasskeyExpectation,
  type RegisteredCredential,
  type StoredCredential,
  type VerifiedAuthentication,
  verifyAuthentication,
  verifyRegistration,
} from "./webauthn.js";
