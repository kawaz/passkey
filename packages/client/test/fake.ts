/** A browser, as far as the client touches one: `navigator.credentials`, `PublicKeyCredential`, `window`, `document` and `matchMedia`. Each test installs what it needs and `uninstall()` puts the globals back. */

const GLOBALS = ["PublicKeyCredential", "window", "document", "matchMedia"] as const;

type Slot = { had: boolean; value: unknown };
const saved = new Map<string, Slot>();

function set(target: object, key: string, value: unknown): void {
  const id = `${target === globalThis ? "global" : "navigator"}.${key}`;
  if (!saved.has(id)) {
    saved.set(id, { had: key in target, value: (target as Record<string, unknown>)[key] });
  }
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

export function setGlobal(key: (typeof GLOBALS)[number], value: unknown): void {
  set(globalThis, key, value);
}

export function setCredentials(value: unknown): void {
  set(globalThis.navigator, "credentials", value);
}

export function uninstall(): void {
  for (const [id, slot] of saved) {
    const [where, key] = id.split(".") as [string, string];
    const target = where === "global" ? globalThis : globalThis.navigator;
    if (slot.had) {
      Object.defineProperty(target, key, { value: slot.value, configurable: true, writable: true });
    } else {
      delete (target as Record<string, unknown>)[key];
    }
  }
  saved.clear();
}

export interface Calls {
  create: CredentialCreationOptions[];
  get: CredentialRequestOptions[];
}

/** Install `navigator.credentials` answering with the given functions, and a bare `PublicKeyCredential`. */
export function installCredentials(answer: {
  create?: (options: CredentialCreationOptions) => Promise<unknown>;
  get?: (options: CredentialRequestOptions) => Promise<unknown>;
  statics?: Record<string, unknown>;
}): Calls {
  const calls: Calls = { create: [], get: [] };
  setGlobal("PublicKeyCredential", { ...answer.statics });
  setCredentials({
    create: (options: CredentialCreationOptions) => {
      calls.create.push(options);
      return answer.create ? answer.create(options) : Promise.reject(new Error("no create"));
    },
    get: (options: CredentialRequestOptions) => {
      calls.get.push(options);
      return answer.get ? answer.get(options) : Promise.reject(new Error("no get"));
    },
  });
  return calls;
}

export function buffer(bytes: Uint8Array | number[]): ArrayBuffer {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out.buffer;
}

export function domError(name: string, message = `${name} happened`): DOMException {
  return new DOMException(message, name);
}

/** A registration credential as a browser hands it over. */
export function attestationCredential(parts: {
  id?: Uint8Array;
  clientDataJSON?: ArrayBuffer;
  attestationObject?: ArrayBuffer;
  authenticatorData?: ArrayBuffer;
  publicKey?: ArrayBuffer | null;
  publicKeyAlgorithm?: number;
  transports?: string[];
  authenticatorAttachment?: string | null;
  extensions?: Record<string, unknown>;
  withoutGetters?: boolean;
}): unknown {
  const id = parts.id ?? new Uint8Array([1, 2, 3, 4]);
  const response: Record<string, unknown> = {
    clientDataJSON: parts.clientDataJSON ?? buffer([0x7b, 0x7d]),
    attestationObject: parts.attestationObject ?? buffer([0xa0]),
  };
  if (!parts.withoutGetters) {
    response["getAuthenticatorData"] = () => parts.authenticatorData ?? buffer([9, 9]);
    response["getPublicKey"] = () =>
      parts.publicKey === undefined ? buffer([5, 5]) : parts.publicKey;
    response["getPublicKeyAlgorithm"] = () => parts.publicKeyAlgorithm ?? -7;
    response["getTransports"] = () => parts.transports ?? ["internal"];
  }
  return {
    id: base64url(id),
    rawId: buffer(id),
    type: "public-key",
    authenticatorAttachment:
      parts.authenticatorAttachment === undefined ? "platform" : parts.authenticatorAttachment,
    response,
    getClientExtensionResults: () => parts.extensions ?? {},
  };
}

/** An authentication credential as a browser hands it over. */
export function assertionCredential(parts: {
  id?: Uint8Array;
  clientDataJSON?: ArrayBuffer;
  authenticatorData?: ArrayBuffer;
  signature?: ArrayBuffer;
  userHandle?: ArrayBuffer | null;
  authenticatorAttachment?: string | null;
  extensions?: Record<string, unknown>;
}): unknown {
  const id = parts.id ?? new Uint8Array([1, 2, 3, 4]);
  return {
    id: base64url(id),
    rawId: buffer(id),
    type: "public-key",
    authenticatorAttachment:
      parts.authenticatorAttachment === undefined ? "platform" : parts.authenticatorAttachment,
    response: {
      clientDataJSON: parts.clientDataJSON ?? buffer([0x7b, 0x7d]),
      authenticatorData: parts.authenticatorData ?? buffer([8, 8]),
      signature: parts.signature ?? buffer([7, 7]),
      userHandle: parts.userHandle === undefined ? null : parts.userHandle,
    },
    getClientExtensionResults: () => parts.extensions ?? {},
  };
}

/** base64url, written apart from the package's own so the two cannot agree on a mistake by sharing code. */
export function base64url(bytes: Uint8Array | ArrayBuffer | BufferSource): string {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(
          (bytes as ArrayBufferView).buffer,
          (bytes as ArrayBufferView).byteOffset,
          (bytes as ArrayBufferView).byteLength,
        );
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function fromBase64url(value: string): Uint8Array {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
