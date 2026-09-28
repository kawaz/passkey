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
Browser                                         Verifying side
@kawaz/passkey-client                           @kawaz/passkey-server
  register() / authenticate()                     registrationOptions() / authenticationOptions()
  → shaped as Level 3 toJSON()       ◀─JSON──      verifyRegistration(response, expected)
                                      ─JSON──▶      verifyAuthentication(response, expected, credential)
                                                    (WebCrypto only)
```

### The wire is Level 3 `toJSON()` (camelCase)

The shared vocabulary between client and server is the shape WebAuthn Level 3 `PublicKeyCredential.toJSON()` returns (`RegistrationResponseJSON` / `AuthenticationResponseJSON`, binary as base64url strings). Because the specification defines it, either side can be replaced by another implementation and still connect. On browsers without `toJSON()`, the client builds the same shape. Options use the Level 3 JSON forms too (`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`), with the client covering what `parseCreationOptionsFromJSON()` does.

When an application's own API uses different naming (e.g. snake_case), it maps at the application's boundary. That naming does not enter the packages' inputs or outputs.

### client (`@kawaz/passkey-client`)

- `register(options)` / `authenticate(options, controls?)` call registration / authentication and shape the result into Level 3 `RegistrationResponseJSON` / `AuthenticationResponseJSON` (`json`) plus the raw extension outputs (`extensions`). Key material such as `clientExtensionResults.prf.results` never lands in `json`; it is only reachable from `extensions`
- Shaping never uses the browser's `toJSON()` / `parse*OptionsFromJSON()`; the client always does it itself (`toJSON()` only ships from Chrome 129 / Firefox 119 / Safari 18.4, and passkeys work without it on Safari 16–18.3 / Chrome 108–128). The five extensions with a JSON shape in §10 — `appid` / `appidExclude` / `credProps` / `prf` / `largeBlob` — are expanded and folded on both input and output
- Failures throw `PasskeyError` with a `kind` of `declined` (cancellation, no passkey, or an embedding rejection), `excluded` (matches an `excludeCredentials` entry), `aborted` (stopped via `AbortSignal`), or `failed` (an options or environment problem)
- Conditional UI starts with `authenticate(options, { mediation: "conditional", signal })` and stops when `signal` aborts; there is no separate function for it
- `capabilities()` reports availability using the same vocabulary as WebAuthn Level 3's `getClientCapabilities()` (`conditionalCreate` / `conditionalGet` / `hybridTransport` / `userVerifyingPlatformAuthenticator`, etc.), synthesizing it from individual APIs where that method is absent
- `context()` reports facts knowable before calling (`embedded`: `window.top !== window.self`, `standalone`: opened as an installed PWA, `allowed.create` / `allowed.get`: permissions-policy allowance)

### server (`@kawaz/passkey-server`)

- `registrationOptions(input)` / `authenticationOptions(input)` build the Level 3 `PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`, ready to hand straight to the client's `register()` / `authenticate()`. The package keeps no state, so storing the returned `challenge` is the caller's job
- Depends only on WebCrypto (`crypto.subtle`), so it runs on Node / Bun / Deno / edge runtimes. CBOR reading is built in
- Accepts `none` attestation only. A registration whose `fmt` is not `none` or whose `attStmt` is not empty is rejected
- Signature algorithms: ES256 (-7) / EdDSA (-8) / RS256 (-257)
- Requires both UP and UV. There is no option to relax them
- Rejects embedded registration and authentication by default. Passing the parent page's origin in `expected.topOrigins` allows a response with that `topOrigin` through. A `crossOrigin: true` response without a `topOrigin` (Safari) is allowed only when `embeddedWithoutTopOrigin: "allow"` is set explicitly
- Both origin and rpId accept multiple values (`string | string[]`). Origin is an exact match (scheme / host / port); the rpId's SHA-256 is matched against the rpIdHash in the authenticator data
- `verifyRegistration()` can narrow the accepted algorithms via `algorithms` and confirms the key can be imported by WebCrypto. `verifyAuthentication()` requires the response's `userHandle` to match when one is passed in
- Reads and returns the BE / BS (backup) flags at registration, rejecting the contradiction BE = 0 ∧ BS = 1. Passing `StoredCredential.backupEligible` also requires it to match the value recorded at registration (there is no option to relax this)
- Rejects a sign count that goes backwards: when the stored value or the new one is nonzero and the new one is not greater than the stored one, it does not pass (an authenticator that stays at 0 on both sides is treated as not counting)
- Inputs are structural partial types that only read the members they need (`RegistrationResponse` / `AuthenticationResponse`); the client's `json` can be passed straight through
- Failures are a single exception class, `PasskeyVerificationError`, carrying a `reason` string that names the stage
- Confirmed working on Node 26 / Bun 1.3 / Deno 2.9 for registration and authentication (`packages/server/test/runtime/smoke.mjs`). Edge runtimes are unconfirmed

## Key Design Decisions

- [DR-0001](decisions/DR-0001-client-api.md) — Public API of `@kawaz/passkey-client`. Implemented (`packages/client`)
- [DR-0002](decisions/DR-0002-server-api.md) — Public API of `@kawaz/passkey-server`. Implemented (`packages/server`)

## Related Documents

- [STRUCTURE.md](./STRUCTURE.md) — Physical structure
- [ROADMAP.md](./ROADMAP.md) — Future considerations
- [decisions/INDEX.md](./decisions/INDEX.md) — DR list
