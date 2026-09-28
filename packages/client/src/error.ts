/** How a ceremony failed, in the few ways a page draws differently.
 *
 * - `declined`: no passkey was handed over (`NotAllowedError`, or a `null` answer). The person cancelling, the origin having no passkey, and a permissions policy refusing an embedded page all look alike here; tell them apart with `context()`.
 * - `excluded`: registration picked an authenticator that already holds a credential in `excludeCredentials` (`InvalidStateError`).
 * - `aborted`: the caller's `signal` stopped it.
 * - `failed`: anything else — the options or the environment. Show `message`. */
export type PasskeyErrorKind = "declined" | "excluded" | "aborted" | "failed";

export class PasskeyError extends Error {
  readonly kind: PasskeyErrorKind;
  /** The exception the browser threw (a `DOMException` or `TypeError`). A `null` answer and a missing `PublicKeyCredential` carry an `Error` of this package's own. */
  override readonly cause: unknown;

  constructor(kind: PasskeyErrorKind, cause: unknown) {
    super(messageOf(cause), { cause });
    this.name = "PasskeyError";
    this.kind = kind;
    this.cause = cause;
  }
}

function messageOf(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    return String(cause.message);
  }
  return String(cause);
}

/** Sort what a ceremony threw into a `PasskeyError`. */
export function classify(
  caught: unknown,
  ceremony: "create" | "get",
  signal: AbortSignal | undefined,
): PasskeyError {
  if (caught instanceof PasskeyError) return caught;
  const name =
    typeof caught === "object" && caught !== null && "name" in caught ? caught.name : undefined;
  if (name === "AbortError" || (signal?.aborted === true && caught === signal.reason)) {
    return new PasskeyError("aborted", caught);
  }
  if (name === "NotAllowedError") return new PasskeyError("declined", caught);
  if (name === "InvalidStateError" && ceremony === "create") {
    return new PasskeyError("excluded", caught);
  }
  return new PasskeyError("failed", caught);
}
