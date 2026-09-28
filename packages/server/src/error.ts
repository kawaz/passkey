/** The step at which a registration or an authentication was refused.
 *
 * - `encoding`: a field that should be base64url is not
 * - `client-data`: `clientDataJSON` is not JSON, or states no challenge
 * - `type`: `clientDataJSON.type` is not the ceremony being verified
 * - `challenge`: `clientDataJSON.challenge` is not the expected one
 * - `origin`: `clientDataJSON.origin` is none of the expected ones, spelled exactly
 * - `embedded`: `crossOrigin` is `true` or `topOrigin` is present, and `topOrigins` does not admit it
 * - `authenticator-data`: the authenticator data is too short or runs past its end
 * - `rp-id`: the rpIdHash is not the SHA-256 of any expected rpId
 * - `user-present`: the UP flag is not set
 * - `user-verified`: the UV flag is not set
 * - `backup-state`: the BS flag is set while the BE flag is not
 * - `backup-eligibility`: the BE flag is not the one `StoredCredential.backupEligible` holds
 * - `attestation`: the attestation object cannot be read, or carries no authenticator data
 * - `attestation-format`: `fmt` is not `none`, or `attStmt` is not empty
 * - `credential`: the registration carries no credential, an empty id, or one longer than 1023 bytes
 * - `credential-id`: `rawId` is not the credential id the authenticator attested
 * - `algorithm`: the key's algorithm is not in `expected.algorithms`
 * - `public-key`: the COSE key names an unsupported algorithm, lacks a part, or cannot be imported
 * - `user-handle`: the response's `userHandle` is not `expected.userHandle`
 * - `sign-count`: the counter did not advance while either the new or the stored reading is non-zero
 * - `signature`: the signature does not verify with the stored key
 */
export type PasskeyVerificationReason =
  | "encoding"
  | "client-data"
  | "type"
  | "challenge"
  | "origin"
  | "embedded"
  | "authenticator-data"
  | "rp-id"
  | "user-present"
  | "user-verified"
  | "backup-state"
  | "backup-eligibility"
  | "attestation"
  | "attestation-format"
  | "credential"
  | "credential-id"
  | "algorithm"
  | "public-key"
  | "user-handle"
  | "sign-count"
  | "signature";

/** A registration or an authentication was refused. `reason` says which step; the message says what was seen, for the log. */
export class PasskeyVerificationError extends Error {
  readonly reason: PasskeyVerificationReason;

  constructor(reason: PasskeyVerificationReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PasskeyVerificationError";
    this.reason = reason;
  }
}
