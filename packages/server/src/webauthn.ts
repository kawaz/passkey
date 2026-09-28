import {
  base64UrlDecode,
  base64UrlEncode,
  equalBytes,
  equalStrings,
  owned,
  sha256,
} from "./bytes.js";
import { type CborValue, decodeCbor, decodeCborWhole, mapEntry } from "./cbor.js";
import { PasskeyVerificationError } from "./error.js";

/** The flags of the authenticator data (L3 §6.1). Two of them decide whether an exchange is admitted: that a person was present, and that they were verified — both have to hold on every exchange. The two backup flags decide nothing; they are read and handed back. */
const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKUP_STATE = 0x10;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

/** The three algorithms a credential may be created with. */
const ES256 = -7;
const EdDSA = -8;
const RS256 = -257;

export type PasskeyAlgorithm = typeof ES256 | typeof EdDSA | typeof RS256;

export const SUPPORTED_ALGORITHMS: readonly PasskeyAlgorithm[] = [ES256, EdDSA, RS256];

/** The longest credential id a registration may carry (L3 §7.1 step 25). */
const MAX_CREDENTIAL_ID_LENGTH = 1023;

/** The members of a registration's `toJSON()` form that are read. The Level 3 `RegistrationResponseJSON` is assignable as it is; a caller mapping its own stored contract fills in these and nothing else. */
export interface RegistrationResponse {
  readonly rawId: string;
  readonly response: {
    readonly clientDataJSON: string;
    readonly attestationObject: string;
    readonly transports?: readonly string[];
  };
}

/** The members of an authentication's `toJSON()` form that are read. The Level 3 `AuthenticationResponseJSON` is assignable as it is. A `userHandle` of `null` is read as absent. */
export interface AuthenticationResponse {
  readonly rawId: string;
  readonly response: {
    readonly clientDataJSON: string;
    readonly authenticatorData: string;
    readonly signature: string;
    readonly userHandle?: string | null;
  };
}

/** What the relying party expects of one ceremony. */
export interface PasskeyExpectation {
  /** The challenge it issued, base64url as the client data states it. */
  readonly challenge: string;
  /** The origin of the page that runs the ceremony, compared exactly (scheme / host / port). Given several, the exchange has to match one of them. */
  readonly origin: string | readonly string[];
  /** The relying party id, whose SHA-256 the authenticator data carries. Given several, the hash has to be one of theirs. */
  readonly rpId: string | readonly string[];
  /** The origins of the pages this one may be embedded in (a cross-origin iframe), compared exactly with `topOrigin`. Without it, an exchange that says it was embedded is refused. */
  readonly topOrigins?: readonly string[];
  /** What to do with `crossOrigin: true` that names no `topOrigin` (Safari sends none) when `topOrigins` is given. Defaults to `"reject"`. */
  readonly embeddedWithoutTopOrigin?: "reject" | "allow";
}

/** What the relying party expects of a registration. */
export interface RegistrationExpectation extends PasskeyExpectation {
  /** The algorithms the options listed in `pubKeyCredParams`. Defaults to all three verified here. */
  readonly algorithms?: readonly PasskeyAlgorithm[];
}

/** What the relying party expects of an authentication. */
export interface AuthenticationExpectation extends PasskeyExpectation {
  /** The user handle (base64url) of the account identified before the ceremony, when one was. A response that carries a user handle has to carry this one. */
  readonly userHandle?: string;
}

/** What a verified registration leaves behind, for the caller to store. */
export interface RegisteredCredential {
  /** The credential id, base64url. */
  readonly id: string;
  /** The COSE public key exactly as the authenticator encoded it, base64url. Hand it back unchanged to `verifyAuthentication`. */
  readonly publicKey: string;
  readonly algorithm: PasskeyAlgorithm;
  readonly signCount: number;
  /** The BE flag: whether the authenticator may back this credential up, which is what separates a synced passkey from one that lives on a single device. */
  readonly backupEligible: boolean;
  /** The BS flag: whether it was backed up at this moment. */
  readonly backupState: boolean;
  /** `response.transports` as the browser reported it, to be listed in `allowCredentials` later; `[]` when it reported none. */
  readonly transports: readonly string[];
  /** The expected origin the exchange matched. */
  readonly origin: string;
  /** The expected relying party id the authenticator answered for. */
  readonly rpId: string;
}

/** The stored half an authentication is verified against. */
export interface StoredCredential {
  /** The `publicKey` a registration returned. */
  readonly publicKey: string;
  /** The last counter reading stored for the credential. */
  readonly signCount: number;
  /** The BE flag the registration returned. Given, the authentication has to report the same (L3 §7.2 step 19). */
  readonly backupEligible?: boolean;
}

/** What a verified authentication reports. */
export interface VerifiedAuthentication {
  /** The counter this authentication read, to be stored in place of the old one. */
  readonly signCount: number;
  readonly backupEligible: boolean;
  readonly backupState: boolean;
  /** The user handle a discoverable credential answered with, base64url, when it answered with one. Matching it to an account is the caller's. */
  readonly userHandle?: string;
  /** The expected origin the exchange matched. */
  readonly origin: string;
  /** The expected relying party id the authenticator answered for. */
  readonly rpId: string;
}

/** What the browser said about the exchange it ran, as the parts that are checked here. Fields beyond these are left alone: a browser may add them, and the two that must be absent are refused by name below. */
interface ClientData {
  readonly type?: unknown;
  readonly challenge?: unknown;
  readonly origin?: unknown;
  readonly crossOrigin?: unknown;
  readonly topOrigin?: unknown;
}

/** The authenticator data, as far as it is read (L3 §6.1). */
export interface AuthenticatorData {
  readonly rpIdHash: Uint8Array;
  readonly flags: number;
  readonly signCount: number;
  /** Present on a registration, absent on an assertion. */
  readonly credentialId?: Uint8Array;
  /** The COSE key, exactly the bytes it occupied, so it is stored as it came. */
  readonly publicKey?: Uint8Array;
}

export function parseAuthenticatorData(bytes: Uint8Array): AuthenticatorData {
  if (bytes.length < 37) {
    throw new PasskeyVerificationError("authenticator-data", "the authenticator data is too short");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rpIdHash = bytes.subarray(0, 32);
  const flags = bytes[32] as number;
  const signCount = view.getUint32(33);
  if ((flags & FLAG_ATTESTED_CREDENTIAL) === 0) return { rpIdHash, flags, signCount };
  if (bytes.length < 55) {
    throw new PasskeyVerificationError(
      "authenticator-data",
      "the attested credential data is too short",
    );
  }
  const idLength = view.getUint16(53);
  const idEnd = 55 + idLength;
  if (bytes.length < idEnd) {
    throw new PasskeyVerificationError("authenticator-data", "the credential id runs past the end");
  }
  const credentialId = bytes.subarray(55, idEnd);
  // The key is followed by extensions when there are any, so its own length is what the decoder reports rather than what is left in the buffer.
  const rest = bytes.subarray(idEnd);
  let after: number;
  try {
    ({ rest: after } = decodeCbor(rest));
  } catch (cause) {
    throw new PasskeyVerificationError(
      "authenticator-data",
      `the credential's public key could not be read: ${String(cause)}`,
      { cause },
    );
  }
  const publicKey = rest.subarray(0, rest.length - after);
  return { rpIdHash, flags, signCount, credentialId, publicKey };
}

function parseClientData(clientDataJson: Uint8Array): ClientData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(clientDataJson));
  } catch (cause) {
    throw new PasskeyVerificationError(
      "client-data",
      `the client data is not JSON: ${String(cause)}`,
      {
        cause,
      },
    );
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new PasskeyVerificationError("client-data", "the client data is not a JSON object");
  }
  return parsed as ClientData;
}

/** The challenge `clientDataJSON` states, read without verifying anything, for a caller that has to find where the challenge was issued before it can say what to expect. */
export function challengeOf(clientDataJSON: string): string {
  const { challenge } = parseClientData(base64UrlDecode(clientDataJSON));
  if (typeof challenge !== "string") {
    throw new PasskeyVerificationError("client-data", "the client data states no challenge");
  }
  return challenge;
}

/** What the two ceremonies check in common (L3 §7.1 steps 7-11, §7.2 steps 10-14): what the browser was doing, which challenge it answered, which page asked, and whether it ran inside a page that embeds it. Answers the expected origin that matched. */
export function checkClientData(
  clientDataJson: Uint8Array,
  expected: {
    type: string;
    challenge: string;
    origin: string | readonly string[];
    topOrigins?: readonly string[] | undefined;
    embeddedWithoutTopOrigin?: "reject" | "allow" | undefined;
  },
): string {
  const parsed = parseClientData(clientDataJson);
  if (parsed.type !== expected.type) {
    throw new PasskeyVerificationError("type", `the client data is for ${String(parsed.type)}`);
  }
  if (typeof parsed.challenge !== "string" || !equalStrings(parsed.challenge, expected.challenge)) {
    throw new PasskeyVerificationError("challenge", "the client data answers another challenge");
  }
  const origins = typeof expected.origin === "string" ? [expected.origin] : expected.origin;
  const origin = origins.find((candidate) => candidate === parsed.origin);
  if (origin === undefined) {
    throw new PasskeyVerificationError(
      "origin",
      `${String(parsed.origin)} is not ${origins.join(" or ")}`,
    );
  }
  checkEmbedding(parsed, expected.topOrigins, expected.embeddedWithoutTopOrigin ?? "reject");
  return origin;
}

/** Whether the exchange ran inside another page, and if so whether that page is one the relying party expects to be embedded in (L3 §7.1 steps 10-11, §7.2 steps 13-14).
 *
 * An embedded exchange is what either `crossOrigin: true` or a `topOrigin` says when it is there to say it. `crossOrigin: false` is not that: Chromium writes the field on every message, and reading its presence as the refusal would turn away every credential those browsers make. `topOrigin` is only ever written when the exchange was cross-origin, so one that arrives beside anything but `crossOrigin: true` describes no exchange a browser runs and is refused whatever the allow-list says. */
function checkEmbedding(
  parsed: ClientData,
  topOrigins: readonly string[] | undefined,
  withoutTopOrigin: "reject" | "allow",
): void {
  const crossOrigin = parsed.crossOrigin === true;
  const { topOrigin } = parsed;
  if (!crossOrigin && topOrigin === undefined) return;
  if (topOrigins === undefined) {
    throw new PasskeyVerificationError(
      "embedded",
      "this exchange must not be run from an embedded page",
    );
  }
  if (topOrigin === undefined) {
    if (withoutTopOrigin === "allow") return;
    throw new PasskeyVerificationError(
      "embedded",
      "an embedded exchange that names no top origin is not admitted",
    );
  }
  if (!crossOrigin) {
    throw new PasskeyVerificationError(
      "embedded",
      "a top origin is named for an exchange that was not cross-origin",
    );
  }
  if (typeof topOrigin !== "string" || !topOrigins.includes(topOrigin)) {
    throw new PasskeyVerificationError(
      "embedded",
      `${JSON.stringify(topOrigin)} is not a page this one may be embedded in`,
    );
  }
}

/** The relying party, the person and the backup flags, as every ceremony states them (L3 §7.1 steps 14-17, §7.2 steps 15-18). Answers the expected relying party id the authenticator answered for. */
export async function checkAuthenticator(
  data: AuthenticatorData,
  rpId: string | readonly string[],
): Promise<string> {
  let matched: string | undefined;
  for (const candidate of typeof rpId === "string" ? [rpId] : rpId) {
    if (equalBytes(data.rpIdHash, await sha256(candidate))) {
      matched = candidate;
      break;
    }
  }
  if (matched === undefined) {
    throw new PasskeyVerificationError(
      "rp-id",
      "the authenticator answered for another relying party",
    );
  }
  if ((data.flags & FLAG_USER_PRESENT) === 0) {
    throw new PasskeyVerificationError("user-present", "no person was present");
  }
  if ((data.flags & FLAG_USER_VERIFIED) === 0) {
    throw new PasskeyVerificationError("user-verified", "no person was verified");
  }
  if ((data.flags & FLAG_BACKUP_ELIGIBLE) === 0 && (data.flags & FLAG_BACKUP_STATE) !== 0) {
    throw new PasskeyVerificationError(
      "backup-state",
      "a credential that may not be backed up says it was",
    );
  }
  return matched;
}

/** Check a registration (L3 §7.1) and answer what is worth storing.
 *
 * Attestation is `none`: what this reads out of the attestation object is the authenticator data and the key — there is no statement about the hardware to verify, and one that arrived would mean the page asked for something other than `attestation: "none"`. Only `rawId`, `response.clientDataJSON`, `response.attestationObject` and `response.transports` are read; the convenience copies Level 3 adds beside them (`response.authenticatorData`, `response.publicKey`, `response.publicKeyAlgorithm`) are derived from the attestation object by the browser and are not trusted apart from it. */
export async function verifyRegistration(
  response: RegistrationResponse,
  expected: RegistrationExpectation,
): Promise<RegisteredCredential> {
  const origin = checkClientData(base64UrlDecode(response.response.clientDataJSON), {
    type: "webauthn.create",
    challenge: expected.challenge,
    origin: expected.origin,
    topOrigins: expected.topOrigins,
    embeddedWithoutTopOrigin: expected.embeddedWithoutTopOrigin,
  });
  let attestation: CborValue;
  try {
    attestation = decodeCborWhole(base64UrlDecode(response.response.attestationObject));
  } catch (cause) {
    if (cause instanceof PasskeyVerificationError) throw cause;
    throw new PasskeyVerificationError(
      "attestation",
      `the attestation object could not be read: ${String(cause)}`,
      { cause },
    );
  }
  if (mapEntry(attestation, "fmt") !== "none") {
    throw new PasskeyVerificationError(
      "attestation-format",
      "only registrations without attestation are accepted",
    );
  }
  const statement = mapEntry(attestation, "attStmt");
  if (!(statement instanceof Map) || statement.size !== 0) {
    throw new PasskeyVerificationError(
      "attestation-format",
      "an unattested registration carries an empty statement",
    );
  }
  const authData = mapEntry(attestation, "authData");
  if (!(authData instanceof Uint8Array)) {
    throw new PasskeyVerificationError(
      "attestation",
      "the attestation object carries no authenticator data",
    );
  }
  const data = parseAuthenticatorData(authData);
  const rpId = await checkAuthenticator(data, expected.rpId);
  // An empty id is a credential nothing can name later: `allowCredentials` has no way to point at it, so a registration that carries one records a key no authentication will ever reach.
  if (
    data.credentialId === undefined ||
    data.credentialId.length === 0 ||
    data.publicKey === undefined
  ) {
    throw new PasskeyVerificationError("credential", "the registration carries no credential");
  }
  if (data.credentialId.length > MAX_CREDENTIAL_ID_LENGTH) {
    throw new PasskeyVerificationError(
      "credential",
      `the credential id is longer than ${String(MAX_CREDENTIAL_ID_LENGTH)} bytes`,
    );
  }
  // The id the browser reported and the one the authenticator signed are the same value by construction; comparing them is what says the two halves of the message describe one credential.
  if (!equalBytes(data.credentialId, base64UrlDecode(response.rawId))) {
    throw new PasskeyVerificationError(
      "credential-id",
      "the credential named is not the one attested",
    );
  }
  // A key that cannot be imported is a credential that can never be used; finding that out at the first authentication leaves a stored record nobody can explain.
  const { key, alg: algorithm } = readKey(data.publicKey);
  if (!(expected.algorithms ?? SUPPORTED_ALGORITHMS).includes(algorithm)) {
    throw new PasskeyVerificationError(
      "algorithm",
      `the key's algorithm ${String(algorithm)} is not one the options listed`,
    );
  }
  await importPublicKey(key, algorithm);
  // Read as unknown: the type says what a caller should send, and a caller writing JavaScript may send anything.
  const { transports } = response.response as { transports?: unknown };
  return {
    id: base64UrlEncode(data.credentialId),
    publicKey: base64UrlEncode(data.publicKey),
    algorithm,
    signCount: data.signCount,
    backupEligible: (data.flags & FLAG_BACKUP_ELIGIBLE) !== 0,
    backupState: (data.flags & FLAG_BACKUP_STATE) !== 0,
    transports:
      Array.isArray(transports) && transports.every((item) => typeof item === "string")
        ? [...(transports as string[])]
        : [],
    origin,
    rpId,
  };
}

/** Check an authentication (L3 §7.2) against the key a registration left behind. Finding the stored credential by `rawId`, and the account by `userHandle` when none was identified beforehand, are the caller's. */
export async function verifyAuthentication(
  response: AuthenticationResponse,
  expected: AuthenticationExpectation,
  credential: StoredCredential,
): Promise<VerifiedAuthentication> {
  const userHandle = response.response.userHandle ?? undefined;
  if (
    expected.userHandle !== undefined &&
    userHandle !== undefined &&
    !equalBytes(base64UrlDecode(userHandle), base64UrlDecode(expected.userHandle))
  ) {
    throw new PasskeyVerificationError(
      "user-handle",
      "the credential answered for another user account",
    );
  }
  const clientDataJson = base64UrlDecode(response.response.clientDataJSON);
  const origin = checkClientData(clientDataJson, {
    type: "webauthn.get",
    challenge: expected.challenge,
    origin: expected.origin,
    topOrigins: expected.topOrigins,
    embeddedWithoutTopOrigin: expected.embeddedWithoutTopOrigin,
  });
  const authData = base64UrlDecode(response.response.authenticatorData);
  const data = parseAuthenticatorData(authData);
  const rpId = await checkAuthenticator(data, expected.rpId);
  const backupEligible = (data.flags & FLAG_BACKUP_ELIGIBLE) !== 0;
  if (credential.backupEligible !== undefined && credential.backupEligible !== backupEligible) {
    throw new PasskeyVerificationError(
      "backup-eligibility",
      "the credential's backup eligibility is not the one it was registered with",
    );
  }
  // A synced passkey reports zero forever, and an authenticator that keeps a counter only ever counts up. So once either reading is non-zero, every later one has to be higher — including a zero, which from an authenticator that was counting is a different device answering with a copy of the credential.
  if (
    (data.signCount !== 0 || credential.signCount !== 0) &&
    data.signCount <= credential.signCount
  ) {
    throw new PasskeyVerificationError("sign-count", "the authenticator's counter did not advance");
  }
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData, 0);
  signed.set(await sha256(clientDataJson), authData.length);
  const ok = await verifySignature(
    base64UrlDecode(credential.publicKey),
    signed,
    base64UrlDecode(response.response.signature),
  );
  if (!ok)
    throw new PasskeyVerificationError("signature", "the signature is not this credential's");
  return {
    signCount: data.signCount,
    backupEligible,
    backupState: (data.flags & FLAG_BACKUP_STATE) !== 0,
    ...(userHandle === undefined ? {} : { userHandle }),
    origin,
    rpId,
  };
}

function readKey(cose: Uint8Array): { key: CborValue; alg: PasskeyAlgorithm } {
  let key: CborValue;
  try {
    key = decodeCborWhole(cose);
  } catch (cause) {
    throw new PasskeyVerificationError(
      "public-key",
      `the key could not be read: ${String(cause)}`,
      { cause },
    );
  }
  const alg = mapEntry(key, 3);
  if (typeof alg !== "number" || !(SUPPORTED_ALGORITHMS as readonly number[]).includes(alg)) {
    throw new PasskeyVerificationError("public-key", "the key names no algorithm verified here");
  }
  return { key, alg: alg as PasskeyAlgorithm };
}

/** Import a COSE key and answer its algorithm, so a registration never returns a key nothing can verify with. The imported key is thrown away; an authentication imports its own. */
export async function checkPublicKey(cose: Uint8Array): Promise<PasskeyAlgorithm> {
  const { key, alg } = readKey(cose);
  await importPublicKey(key, alg);
  return alg;
}

/** Verify one signature against a COSE key.
 *
 * The key is imported per verification rather than kept: holding a `CryptoKey` per credential would be a cache of something cheap to make that has to be invalidated when the credential is removed, and the package holds no state. */
async function verifySignature(
  cose: Uint8Array,
  signed: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  const { key, alg } = readKey(cose);
  const imported = await importPublicKey(key, alg);
  try {
    if (alg === ES256) {
      // WebAuthn signs ES256 as the ASN.1 sequence X.509 uses, while WebCrypto verifies the raw pair, so the two halves are taken out of the DER here.
      const raw = rawEcdsaSignature(signature);
      if (raw === undefined) return false;
      return await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        imported,
        owned(raw),
        owned(signed),
      );
    }
    const algorithm = alg === EdDSA ? { name: "Ed25519" } : { name: "RSASSA-PKCS1-v1_5" };
    return await crypto.subtle.verify(algorithm, imported, owned(signature), owned(signed));
  } catch {
    // A signature WebCrypto cannot even take (a wrong length for the key) is one that does not verify.
    return false;
  }
}

/** The COSE key as WebCrypto holds it. A key whose parts are missing or the wrong shape fails here, which is where both the registration and every authentication find out. */
async function importPublicKey(key: CborValue, alg: PasskeyAlgorithm): Promise<CryptoKey> {
  let jwk: JsonWebKey;
  let algorithm: EcKeyImportParams | RsaHashedImportParams | Algorithm;
  switch (alg) {
    case ES256: {
      if (mapEntry(key, 1) !== 2)
        throw new PasskeyVerificationError("public-key", "an ES256 key is an EC2 key");
      if (mapEntry(key, -1) !== 1)
        throw new PasskeyVerificationError("public-key", "an ES256 key is on P-256");
      const x = bytesAt(key, -2, 32);
      const y = bytesAt(key, -3, 32);
      jwk = { kty: "EC", crv: "P-256", x: base64UrlEncode(x), y: base64UrlEncode(y) };
      algorithm = { name: "ECDSA", namedCurve: "P-256" };
      break;
    }
    case EdDSA: {
      if (mapEntry(key, 1) !== 1)
        throw new PasskeyVerificationError("public-key", "an EdDSA key is an OKP key");
      if (mapEntry(key, -1) !== 6)
        throw new PasskeyVerificationError("public-key", "an EdDSA key is on Ed25519");
      const x = bytesAt(key, -2, 32);
      jwk = { kty: "OKP", crv: "Ed25519", x: base64UrlEncode(x) };
      algorithm = { name: "Ed25519" };
      break;
    }
    case RS256: {
      if (mapEntry(key, 1) !== 3)
        throw new PasskeyVerificationError("public-key", "an RS256 key is an RSA key");
      const n = bytesAt(key, -1);
      const e = bytesAt(key, -2);
      jwk = { kty: "RSA", n: base64UrlEncode(n), e: base64UrlEncode(e) };
      algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
      break;
    }
  }
  try {
    return await crypto.subtle.importKey("jwk", jwk, algorithm, false, ["verify"]);
  } catch (cause) {
    throw new PasskeyVerificationError(
      "public-key",
      `the key could not be imported: ${String(cause)}`,
      { cause },
    );
  }
}

function bytesAt(key: CborValue, label: number, width?: number): Uint8Array {
  const held = mapEntry(key, label);
  if (!(held instanceof Uint8Array)) {
    throw new PasskeyVerificationError("public-key", `the key carries no ${String(label)}`);
  }
  if (width !== undefined && held.length !== width) {
    throw new PasskeyVerificationError(
      "public-key",
      `the key's ${String(label)} is not ${String(width)} bytes`,
    );
  }
  return held;
}

/** The `r` and `s` of a DER-encoded ECDSA signature, each padded to 32 bytes.
 *
 * Nothing is trusted about the lengths: a signature is attacker-supplied until it verifies, so a structure that does not parse is a refusal rather than an exception. */
function rawEcdsaSignature(der: Uint8Array): Uint8Array | undefined {
  if (der[0] !== 0x30) return undefined;
  let at = 2;
  const parts: Uint8Array[] = [];
  for (let i = 0; i < 2; i += 1) {
    if (der[at] !== 0x02) return undefined;
    const length = der[at + 1];
    if (length === undefined) return undefined;
    const start = at + 2;
    const end = start + length;
    if (end > der.length) return undefined;
    let part = der.subarray(start, end);
    // A leading zero is the DER sign byte; a shorter value is left-padded.
    while (part.length > 32 && part[0] === 0) part = part.subarray(1);
    if (part.length > 32) return undefined;
    parts.push(part);
    at = end;
  }
  const raw = new Uint8Array(64);
  raw.set(parts[0] as Uint8Array, 32 - (parts[0] as Uint8Array).length);
  raw.set(parts[1] as Uint8Array, 64 - (parts[1] as Uint8Array).length);
  return raw;
}
