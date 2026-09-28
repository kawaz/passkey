import { base64UrlDecode, base64UrlEncode } from "./bytes.js";
import { type PasskeyAlgorithm, SUPPORTED_ALGORITHMS } from "./webauthn.js";

/** The hints a page may give the browser about which kind of authenticator to offer (L3 §5.8.8). */
export type PublicKeyCredentialHint = "security-key" | "client-device" | "hybrid";

/** A credential the options name, as the caller stored it after a registration. */
export interface CredentialDescriptorInput {
  /** The credential id, base64url. */
  readonly id: string;
  /** The `transports` a registration returned. */
  readonly transports?: readonly string[];
}

/** What a registration starts from. */
export interface RegistrationOptionsInput {
  readonly rp: { readonly id: string; readonly name: string };
  /** `id` is base64url of 1 to 64 bytes; left out, it is 32 random bytes. `displayName` defaults to `""`. */
  readonly user: { readonly id?: string; readonly name: string; readonly displayName?: string };
  /** base64url of at least 16 bytes; left out, it is 32 random bytes. */
  readonly challenge?: string;
  /** Credentials the account already has, so the authenticator does not make a second one. */
  readonly excludeCredentials?: readonly CredentialDescriptorInput[];
  /** The algorithms to offer, most preferred first. Defaults to `[-7, -8, -257]`. */
  readonly algorithms?: readonly PasskeyAlgorithm[];
  /** Defaults to `"required"`. */
  readonly residentKey?: "required" | "preferred";
  readonly authenticatorAttachment?: "platform" | "cross-platform";
  readonly hints?: readonly PublicKeyCredentialHint[];
  /** Milliseconds. Defaults to 60000. */
  readonly timeout?: number;
  readonly extensions?: AuthenticationExtensionsClientInputsJSON;
}

/** What an authentication starts from. */
export interface AuthenticationOptionsInput {
  readonly rpId: string;
  /** base64url of at least 16 bytes; left out, it is 32 random bytes. */
  readonly challenge?: string;
  /** The credentials that may answer. Left out, any discoverable credential for `rpId` may. */
  readonly allowCredentials?: readonly CredentialDescriptorInput[];
  readonly hints?: readonly PublicKeyCredentialHint[];
  /** Milliseconds. Defaults to 60000. */
  readonly timeout?: number;
  readonly extensions?: AuthenticationExtensionsClientInputsJSON;
}

const RANDOM_LENGTH = 32;
/** L3 §13.4.3: "Challenges SHOULD therefore be at least 16 bytes long." */
const MIN_CHALLENGE_LENGTH = 16;
/** L3 §5.1.3 step 5: a browser refuses a `user.id` outside 1 to 64 bytes. */
const MAX_USER_ID_LENGTH = 64;
const DEFAULT_TIMEOUT = 60000;

/** The options to hand the client for a registration (L3 §5.4), as `PublicKeyCredentialCreationOptionsJSON`.
 *
 * Attestation is `none` and user verification is `required`, whatever the input: those are what `verifyRegistration` accepts, so they are not the caller's to spell. Nothing is kept: storing the returned `challenge` for `expected.challenge` is the caller's. */
export function registrationOptions(
  input: RegistrationOptionsInput,
): PublicKeyCredentialCreationOptionsJSON {
  const algorithms = input.algorithms ?? SUPPORTED_ALGORITHMS;
  if (algorithms.length === 0) {
    throw new RangeError("at least one algorithm has to be offered");
  }
  for (const alg of algorithms) {
    if (!SUPPORTED_ALGORITHMS.includes(alg)) {
      throw new RangeError(`${String(alg)} is not an algorithm verified here`);
    }
  }
  const userId = input.user.id ?? random();
  const userIdLength = decode(userId, "user.id").length;
  if (userIdLength < 1 || userIdLength > MAX_USER_ID_LENGTH) {
    throw new RangeError(`user.id is ${String(userIdLength)} bytes, not 1 to 64`);
  }
  const residentKey = input.residentKey ?? "required";
  return {
    rp: { id: input.rp.id, name: input.rp.name },
    user: { id: userId, name: input.user.name, displayName: input.user.displayName ?? "" },
    challenge: challenge(input.challenge),
    pubKeyCredParams: algorithms.map((alg) => ({ type: "public-key", alg })),
    timeout: timeout(input.timeout),
    ...(input.excludeCredentials === undefined
      ? {}
      : { excludeCredentials: descriptors(input.excludeCredentials, "excludeCredentials") }),
    authenticatorSelection: {
      ...(input.authenticatorAttachment === undefined
        ? {}
        : { authenticatorAttachment: input.authenticatorAttachment }),
      residentKey,
      requireResidentKey: residentKey === "required",
      userVerification: "required",
    },
    ...(input.hints === undefined ? {} : { hints: [...input.hints] }),
    attestation: "none",
    ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
  };
}

/** The options to hand the client for an authentication (L3 §5.5), as `PublicKeyCredentialRequestOptionsJSON`. User verification is `required`, whatever the input. */
export function authenticationOptions(
  input: AuthenticationOptionsInput,
): PublicKeyCredentialRequestOptionsJSON {
  return {
    challenge: challenge(input.challenge),
    timeout: timeout(input.timeout),
    rpId: input.rpId,
    // An empty list is left out as well: some browsers read `allowCredentials: []` as "none may answer" rather than "any may".
    ...(input.allowCredentials === undefined || input.allowCredentials.length === 0
      ? {}
      : { allowCredentials: descriptors(input.allowCredentials, "allowCredentials") }),
    userVerification: "required",
    ...(input.hints === undefined ? {} : { hints: [...input.hints] }),
    ...(input.extensions === undefined ? {} : { extensions: input.extensions }),
  };
}

function random(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(RANDOM_LENGTH)));
}

function challenge(given: string | undefined): string {
  if (given === undefined) return random();
  const length = decode(given, "challenge").length;
  if (length < MIN_CHALLENGE_LENGTH) {
    throw new RangeError(
      `the challenge is ${String(length)} bytes, shorter than ${String(MIN_CHALLENGE_LENGTH)}`,
    );
  }
  return given;
}

function timeout(given: number | undefined): number {
  if (given === undefined) return DEFAULT_TIMEOUT;
  if (!Number.isSafeInteger(given) || given < 0) {
    throw new RangeError(
      `the timeout ${String(given)} is not a non-negative number of milliseconds`,
    );
  }
  return given;
}

function descriptors(
  given: readonly CredentialDescriptorInput[],
  field: string,
): PublicKeyCredentialDescriptorJSON[] {
  return given.map(({ id, transports }) => {
    decode(id, `${field}[].id`);
    return {
      type: "public-key",
      id,
      ...(transports === undefined ? {} : { transports: [...transports] }),
    };
  });
}

/** The bytes of a base64url input. A value that is not base64url is a mistake in the caller's input, not a refused ceremony, so it is a `TypeError`. */
function decode(value: string, field: string): Uint8Array {
  try {
    return base64UrlDecode(value);
  } catch (cause) {
    throw new TypeError(`${field} is not base64url`, { cause });
  }
}
