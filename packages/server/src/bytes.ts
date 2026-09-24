import { PasskeyVerificationError } from "./error.js";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const INDEX = new Map<string, number>(ALPHABET.split("").map((char, at) => [char, at]));

/** Decode base64url (RFC 4648 §5). Trailing `=` padding is tolerated; any other character outside the alphabet, or a length no encoding produces, is refused. */
export function base64UrlDecode(value: string): Uint8Array {
  const body = value.replace(/={1,2}$/, "");
  if (body.length % 4 === 1) {
    throw new PasskeyVerificationError("encoding", "a base64url value has an impossible length");
  }
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let bits = 0;
  let held = 0;
  let at = 0;
  for (const char of body) {
    const sextet = INDEX.get(char);
    if (sextet === undefined) {
      throw new PasskeyVerificationError(
        "encoding",
        "a base64url value holds a character outside its alphabet",
      );
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

export async function sha256(bytes: Uint8Array | string): Promise<Uint8Array> {
  const input = typeof bytes === "string" ? new TextEncoder().encode(bytes) : owned(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

/** Compare two byte strings without saying where they diverged.
 *
 * Design rationale: WebCrypto has no constant-time comparison and `node:crypto.timingSafeEqual` would tie the package to Node-compatible runtimes, so the comparison is written out: every byte is visited and the differences are folded into one value. The length is not secret (both sides are of known shape), so unequal lengths return at once. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let at = 0; at < a.length; at += 1) diff |= (a[at] as number) ^ (b[at] as number);
  return diff === 0;
}

/** Compare two strings, as their UTF-8 bytes, the way `equalBytes` does. A challenge is one a caller may be guessing, and a comparison that returns at the first difference tells them how far they got. */
export function equalStrings(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  return equalBytes(encoder.encode(a), encoder.encode(b));
}

/** A copy backed by a buffer of its own.
 *
 * Every value here is a view into the frame it was decoded from, and WebCrypto takes only a view that owns its buffer. The copy is a few dozen bytes and happens once per verification. */
export function owned(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.length));
  copy.set(bytes);
  return copy;
}
