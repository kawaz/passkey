const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INDEX = new Map<string, number>(ALPHABET.split("").map((char, at) => [char, at]));

/** Decode base64url (RFC 4648 §5). Trailing `=` padding is tolerated; any other character outside the alphabet, or a length no encoding produces, is refused. */
export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string") {
    throw new TypeError("a base64url value is not a string");
  }
  const body = value.replace(/={1,2}$/, "");
  if (body.length % 4 === 1) {
    throw new TypeError("a base64url value has an impossible length");
  }
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let bits = 0;
  let held = 0;
  let at = 0;
  for (const char of body) {
    const sextet = INDEX.get(char);
    if (sextet === undefined) {
      throw new TypeError("a base64url value holds a character outside its alphabet");
    }
    held = (held << 6) | sextet;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (held >> bits) & 0xff;
      at += 1;
    }
  }
  return out;
}

/** Encode base64url without padding, as WebAuthn Level 3 spells binary values. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  let at = 0;
  for (; at + 2 < bytes.length; at += 3) {
    const n =
      ((bytes[at] as number) << 16) | ((bytes[at + 1] as number) << 8) | (bytes[at + 2] as number);
    out +=
      (ALPHABET[n >> 18] as string) +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63] +
      ALPHABET[n & 63];
  }
  const rest = bytes.length - at;
  if (rest === 1) {
    const n = (bytes[at] as number) << 16;
    out += (ALPHABET[n >> 18] as string) + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = ((bytes[at] as number) << 16) | ((bytes[at + 1] as number) << 8);
    out += (ALPHABET[n >> 18] as string) + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63];
  }
  return out;
}

/** The bytes of an `ArrayBuffer` or any view onto one, or `undefined` for anything else. */
export function bytesOf(value: unknown): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}
