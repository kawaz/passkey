import { base64UrlDecode, base64UrlEncode, bytesOf } from "./bytes.js";
import { classify, PasskeyError } from "./error.js";

export interface RegistrationResult {
  /** What goes on the wire, in the Level 3 `toJSON()` form. `clientExtensionResults.prf.results` is left out. */
  json: RegistrationResponseJSON;
  /** `getClientExtensionResults()` as the browser returned it, buffers and all. Values meant to stay in the page are read from here. */
  extensions: AuthenticationExtensionsClientOutputs;
}

export interface AuthenticationResult {
  /** What goes on the wire, in the Level 3 `toJSON()` form. `clientExtensionResults.prf.results` is left out. */
  json: AuthenticationResponseJSON;
  /** `getClientExtensionResults()` as the browser returned it, buffers and all. Values meant to stay in the page are read from here. */
  extensions: AuthenticationExtensionsClientOutputs;
}

/** Create a passkey from Level 3 creation options JSON. Throws `PasskeyError`. */
export async function register(
  options: PublicKeyCredentialCreationOptionsJSON,
  controls: { signal?: AbortSignal } = {},
): Promise<RegistrationResult> {
  const { signal } = controls;
  try {
    const container = credentials();
    const credential = await container.create({
      publicKey: creationOptions(options),
      ...(signal === undefined ? {} : { signal }),
    });
    const { json, extensions } = shape(credential, "create");
    return { json: json as unknown as RegistrationResponseJSON, extensions };
  } catch (caught) {
    throw classify(caught, "create", signal);
  }
}

/** Sign in with a passkey from Level 3 request options JSON. With `mediation: "conditional"` the request waits in the autofill UI until `signal` is aborted. Throws `PasskeyError`. */
export async function authenticate(
  options: PublicKeyCredentialRequestOptionsJSON,
  controls:
    | { mediation?: undefined; signal?: AbortSignal }
    | { mediation: "conditional"; signal: AbortSignal } = {},
): Promise<AuthenticationResult> {
  const { mediation, signal } = controls;
  try {
    const container = credentials();
    const credential = await container.get({
      publicKey: requestOptions(options),
      ...(mediation === undefined ? {} : { mediation }),
      ...(signal === undefined ? {} : { signal }),
    });
    const { json, extensions } = shape(credential, "get");
    return { json: json as unknown as AuthenticationResponseJSON, extensions };
  } catch (caught) {
    throw classify(caught, "get", signal);
  }
}

function credentials(): CredentialsContainer {
  if (
    typeof PublicKeyCredential === "undefined" ||
    typeof navigator === "undefined" ||
    navigator.credentials === undefined
  ) {
    throw new PasskeyError(
      "failed",
      new Error("this browser has no WebAuthn (PublicKeyCredential)"),
    );
  }
  return navigator.credentials;
}

/* Design rationale: lib.dom spells the enumerations of the JSON forms (`attestation`, `hints`, `transports`, ...) as `string` and those of the native forms as unions, although §5.1.8 / §5.1.9 carry them over unchanged. The values are passed through as the relying party wrote them and the browser judges them, so the native types are reached with a cast instead of a check the browser does anyway. */

function creationOptions(
  json: PublicKeyCredentialCreationOptionsJSON,
): PublicKeyCredentialCreationOptions {
  const { challenge, user, excludeCredentials, extensions, ...rest } = json;
  return {
    ...rest,
    challenge: base64UrlDecode(challenge),
    user: { ...user, id: base64UrlDecode(user.id) },
    ...(excludeCredentials === undefined
      ? {}
      : { excludeCredentials: excludeCredentials.map(descriptor) }),
    ...(extensions === undefined ? {} : { extensions: extensionInputs(extensions) }),
  } as PublicKeyCredentialCreationOptions;
}

function requestOptions(
  json: PublicKeyCredentialRequestOptionsJSON,
): PublicKeyCredentialRequestOptions {
  const { challenge, allowCredentials, extensions, ...rest } = json;
  return {
    ...rest,
    challenge: base64UrlDecode(challenge),
    ...(allowCredentials === undefined
      ? {}
      : { allowCredentials: allowCredentials.map(descriptor) }),
    ...(extensions === undefined ? {} : { extensions: extensionInputs(extensions) }),
  } as PublicKeyCredentialRequestOptions;
}

function descriptor(json: PublicKeyCredentialDescriptorJSON): PublicKeyCredentialDescriptor {
  return { ...json, id: base64UrlDecode(json.id) } as PublicKeyCredentialDescriptor;
}

/** Open the base64url members of the §10 extensions that have them (`prf`, `largeBlob`). Every other extension is passed on as written: which of its strings are buffers differs per extension and is not guessed. */
function extensionInputs(
  json: AuthenticationExtensionsClientInputsJSON,
): AuthenticationExtensionsClientInputs {
  const { prf, largeBlob, ...rest } = json;
  const out: Record<string, unknown> = { ...rest };
  if (prf !== undefined) {
    const { eval: evaluate, evalByCredential, ...prfRest } = prf;
    out["prf"] = {
      ...prfRest,
      ...(evaluate === undefined ? {} : { eval: prfValues(evaluate) }),
      ...(evalByCredential === undefined
        ? {}
        : {
            evalByCredential: Object.fromEntries(
              Object.entries(evalByCredential).map(([id, values]) => [id, prfValues(values)]),
            ),
          }),
    };
  }
  if (largeBlob !== undefined) {
    const { write, ...blobRest } = largeBlob;
    out["largeBlob"] = {
      ...blobRest,
      ...(write === undefined ? {} : { write: base64UrlDecode(write) }),
    };
  }
  return out as AuthenticationExtensionsClientInputs;
}

function prfValues(json: AuthenticationExtensionsPRFValuesJSON): AuthenticationExtensionsPRFValues {
  return {
    first: base64UrlDecode(json.first),
    ...(json.second === undefined ? {} : { second: base64UrlDecode(json.second) }),
  };
}

/** Write a credential out in the Level 3 `toJSON()` form, always by this package and never by the browser's own `toJSON()`, so every browser yields the same members. */
function shape(
  credential: Credential | null,
  ceremony: "create" | "get",
): { json: Record<string, unknown>; extensions: AuthenticationExtensionsClientOutputs } {
  if (credential === null) {
    throw new PasskeyError("declined", new Error("the browser returned no credential"));
  }
  const pkc = credential as PublicKeyCredential;
  const extensions = pkc.getClientExtensionResults();
  const response = ceremony === "create" ? attestation(pkc.response) : assertion(pkc.response);
  const json: Record<string, unknown> = {
    id: pkc.id,
    rawId: encode(pkc.rawId, "rawId"),
    type: pkc.type,
    response,
    clientExtensionResults: wireExtensions(extensions),
  };
  if (pkc.authenticatorAttachment !== null && pkc.authenticatorAttachment !== undefined) {
    json["authenticatorAttachment"] = pkc.authenticatorAttachment;
  }
  return { json, extensions };
}

function attestation(response: AuthenticatorResponse): Record<string, unknown> {
  const held = response as Partial<AuthenticatorAttestationResponse>;
  if (
    typeof held.getAuthenticatorData !== "function" ||
    typeof held.getPublicKey !== "function" ||
    typeof held.getPublicKeyAlgorithm !== "function" ||
    typeof held.getTransports !== "function"
  ) {
    throw new TypeError(
      "this browser's AuthenticatorAttestationResponse lacks getAuthenticatorData / getPublicKey / getPublicKeyAlgorithm / getTransports",
    );
  }
  const publicKey = held.getPublicKey();
  return {
    clientDataJSON: encode(response.clientDataJSON, "clientDataJSON"),
    authenticatorData: encode(held.getAuthenticatorData(), "authenticatorData"),
    transports: held.getTransports(),
    ...(publicKey === null ? {} : { publicKey: encode(publicKey, "publicKey") }),
    publicKeyAlgorithm: held.getPublicKeyAlgorithm(),
    attestationObject: encode(held.attestationObject, "attestationObject"),
  };
}

function assertion(response: AuthenticatorResponse): Record<string, unknown> {
  const held = response as Partial<AuthenticatorAssertionResponse>;
  return {
    clientDataJSON: encode(response.clientDataJSON, "clientDataJSON"),
    authenticatorData: encode(held.authenticatorData, "authenticatorData"),
    signature: encode(held.signature, "signature"),
    ...(held.userHandle === null || held.userHandle === undefined
      ? {}
      : { userHandle: encode(held.userHandle, "userHandle") }),
  };
}

function encode(value: unknown, member: string): string {
  const bytes = bytesOf(value);
  if (bytes === undefined) throw new TypeError(`the credential's ${member} is not a buffer`);
  return base64UrlEncode(bytes);
}

/** `getClientExtensionResults()` with every buffer written as base64url, less `prf.results`: §10.1.4 asks for it to be left out when the credential is sent to a server, and §7 never reads it. */
function wireExtensions(
  extensions: AuthenticationExtensionsClientOutputs,
): Record<string, unknown> {
  const out = toWire(extensions) as Record<string, unknown>;
  const prf = out["prf"];
  if (typeof prf === "object" && prf !== null && "results" in prf) {
    const { results: _results, ...kept } = prf as Record<string, unknown>;
    out["prf"] = kept;
  }
  return out;
}

function toWire(value: unknown): unknown {
  const bytes = bytesOf(value);
  if (bytes !== undefined) return base64UrlEncode(bytes);
  if (Array.isArray(value)) return value.map(toWire);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, held]) => [key, toWire(held)]));
  }
  return value;
}
