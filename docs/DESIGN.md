# passkey Design

> English | [日本語](./DESIGN-ja.md)

## Domain

Registering and authenticating people with passkeys (WebAuthn discoverable credentials). Two parties are involved: the browser has an authenticator create a credential (registration) and sign a challenge with it (authentication), and the verifying side (the relying party) confirms that the result was made for a challenge it issued, for its origin and rpId, with user verification (UV), then records or matches the public key.

This repository makes the two parties separate packages. A user can take in just one of them and swap the other for a different implementation.

Out of scope (other parties' responsibility):

- Issuing, storing and consuming challenges, storing credentials, and issuing sessions belong to the application. The server package only takes "the expected challenge / origin / rpId and the stored public key" and verifies; it keeps no state
- Proving the authenticator model through attestation (packed / tpm / apple, etc.) and the trust root for it (FIDO MDS)

## Architecture

```
Browser                                    Verifying side
@kawaz/passkey-client                      @kawaz/passkey-server
  navigator.credentials.create/get           verifyRegistration(json, expected)
  → shaped as Level 3 toJSON()     ─JSON─▶   verifyAuthentication(json, expected, credential)
                                             (WebCrypto only)
```

### The wire is Level 3 `toJSON()` (camelCase)

The shared vocabulary between client and server is the shape WebAuthn Level 3 `PublicKeyCredential.toJSON()` returns (`RegistrationResponseJSON` / `AuthenticationResponseJSON`, binary as base64url strings). Because the specification defines it, either side can be replaced by another implementation and still connect. On browsers without `toJSON()`, the client builds the same shape. Options use the Level 3 JSON forms too (`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`), with the client covering what `parseCreationOptionsFromJSON()` does.

When an application's own API uses different naming (e.g. snake_case), it maps at the application's boundary. That naming does not enter the packages' inputs or outputs.

### client (`@kawaz/passkey-client`)

- Calling registration / authentication and shaping the result into Level 3 JSON
- Starting and aborting conditional UI (`mediation: "conditional"`, autofill)
- Telling whether passkeys are usable (presence of `PublicKeyCredential`, `isUserVerifyingPlatformAuthenticatorAvailable()`, `isConditionalMediationAvailable()`, `getClientCapabilities()`)
- Reporting, before the call, the constraints inside iframes (the `publickey-credentials-create` / `-get` permissions policy) and PWAs (standalone display)

The concrete API is decided from how three web UIs use it (issue `client-api-from-three-webuis`).

### server (`@kawaz/passkey-server`)

- Depends only on WebCrypto (`crypto.subtle`), so it runs on Node / Bun / Deno / edge runtimes. CBOR reading is built in
- Accepts `none` attestation only. A registration whose `fmt` is not `none` or whose `attStmt` is not empty is rejected
- Signature algorithms: ES256 (-7) / EdDSA (-8) / RS256 (-257)
- Requires both UP and UV. There is no option to relax them
- Rejects registration and authentication from embedding: `crossOrigin` of `true` or the presence of `topOrigin` in `clientDataJSON` does not pass
- Origin is an exact match (scheme / host / port); the rpId's SHA-256 is matched against the rpIdHash in the authenticator data
- Rejects a sign count that goes backwards: when the stored value is above 0 and the new one is not greater, it does not pass (an authenticator that stays at 0 is treated as not counting)
- Reads and returns the BE / BS (backup) flags at registration. They do not decide anything
- Confirmed working on Node 26 / Bun 1.3 / Deno 2.9 for registration and authentication (`packages/server/test/runtime/smoke.mjs`). Edge runtimes are unconfirmed

## Key Design Decisions

- [DR-0001](decisions/DR-0001-client-api.md) — Public API of `@kawaz/passkey-client` (Proposed)
- [DR-0002](decisions/DR-0002-server-api.md) — Public API of `@kawaz/passkey-server` (Proposed)

## Related Documents

- [STRUCTURE.md](./STRUCTURE.md) — Physical structure
- [ROADMAP.md](./ROADMAP.md) — Future considerations
- [decisions/INDEX.md](./decisions/INDEX.md) — DR list
