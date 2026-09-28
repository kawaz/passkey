/** Server side of passkeys: builds the options a ceremony starts from, and verifies registrations and assertions in the WebAuthn Level 3 `toJSON()` form with WebCrypto alone. */
export { PasskeyVerificationError, type PasskeyVerificationReason } from "./error.js";
export {
  type AuthenticationOptionsInput,
  authenticationOptions,
  type CredentialDescriptorInput,
  type PublicKeyCredentialHint,
  type RegistrationOptionsInput,
  registrationOptions,
} from "./options.js";
export {
  type AuthenticationExpectation,
  type AuthenticationResponse,
  challengeOf,
  type PasskeyAlgorithm,
  type PasskeyExpectation,
  type RegisteredCredential,
  type RegistrationExpectation,
  type RegistrationResponse,
  type StoredCredential,
  type VerifiedAuthentication,
  verifyAuthentication,
  verifyRegistration,
} from "./webauthn.js";
