import { describe, expect, test } from "bun:test";
import { sha256 } from "../src/bytes.js";
import { PasskeyVerificationError } from "../src/error.js";
import { checkAuthenticator, checkClientData, parseAuthenticatorData } from "../src/webauthn.js";

const ORIGIN = "https://ui.example";
const RP_ID = "ui.example";
const CHALLENGE = "Q0hBTExFTkdF";

function clientData(fields: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(fields));
}

/** What a check refused, or `undefined` when it let the value through. */
async function refusal(check: () => unknown): Promise<string | undefined> {
  try {
    await check();
    return undefined;
  } catch (cause) {
    if (!(cause instanceof PasskeyVerificationError)) throw cause;
    return cause.message;
  }
}

function checked(fields: Record<string, unknown>): Promise<string | undefined> {
  return refusal(() =>
    checkClientData(clientData(fields), {
      type: "webauthn.get",
      challenge: CHALLENGE,
      origin: ORIGIN,
    }),
  );
}

/** The 37 bytes every assertion carries: the relying party, the flags and the
 * counter. */
async function authData(
  options: { rpId?: string; flags?: number; signCount?: number } = {},
): Promise<Uint8Array> {
  const bytes = new Uint8Array(37);
  bytes.set(await sha256(options.rpId ?? RP_ID), 0);
  // User present and user verified, which is what an exchange this instance
  // asked for comes back with.
  bytes[32] = options.flags ?? 0x05;
  new DataView(bytes.buffer).setUint32(33, options.signCount ?? 0);
  return bytes;
}

describe("what the page said it was doing (WebAuthn L2 §7.2)", () => {
  test("the exchange this instance asked for is let through", async () => {
    expect(
      await checked({ type: "webauthn.get", challenge: CHALLENGE, origin: ORIGIN }),
    ).toBeUndefined();
    // Chromium writes the field on every message; reading its presence as a
    // refusal would turn away every credential those browsers make.
    expect(
      await checked({
        type: "webauthn.get",
        challenge: CHALLENGE,
        origin: ORIGIN,
        crossOrigin: false,
      }),
    ).toBeUndefined();
  });

  test("the origin is the one the credential names, spelled exactly", async () => {
    // An origin is compared as the serialization it is: a different port, a
    // different scheme, a different case and a trailing slash are each another
    // origin, and none of them is the one the credential was made at.
    for (const origin of [
      "https://ui.example:8443",
      "http://ui.example",
      "https://UI.example",
      "https://ui.example/",
      "https://ui.example.evil",
      "https://evil.ui.example",
    ]) {
      expect([
        origin,
        await checked({ type: "webauthn.get", challenge: CHALLENGE, origin }),
      ]).toEqual([origin, `${origin} is not ${ORIGIN}`]);
    }
  });

  test("the challenge is the one this instance issued, and the type the ceremony it is", async () => {
    expect(
      await checked({ type: "webauthn.get", challenge: "c29tZXRoaW5nIGVsc2U", origin: ORIGIN }),
    ).toBe("the client data answers another challenge");
    // A registration's message replayed into an assertion: the right challenge
    // for the wrong ceremony.
    expect(await checked({ type: "webauthn.create", challenge: CHALLENGE, origin: ORIGIN })).toBe(
      "the client data is for webauthn.create",
    );
  });

  test("an exchange an embedding page ran is refused", async () => {
    expect(
      await checked({
        type: "webauthn.get",
        challenge: CHALLENGE,
        origin: ORIGIN,
        crossOrigin: true,
      }),
    ).toBe("this exchange must not be run from an embedded page");
    // `topOrigin` is only ever written when the exchange was cross-origin, so
    // its presence at all is the refusal.
    expect(
      await checked({
        type: "webauthn.get",
        challenge: CHALLENGE,
        origin: ORIGIN,
        topOrigin: "https://elsewhere.example",
      }),
    ).toBe("this exchange must not be run from an embedded page");
  });

  test("a field of the wrong type, and data that is not JSON at all, are refused", async () => {
    expect(await checked({ type: "webauthn.get", challenge: 1, origin: ORIGIN })).toBe(
      "the client data answers another challenge",
    );
    expect(await checked({ type: "webauthn.get", challenge: CHALLENGE, origin: 1 })).toBe(
      `1 is not ${ORIGIN}`,
    );
    expect(
      await refusal(() =>
        checkClientData(new Uint8Array([0x7b]), {
          type: "webauthn.get",
          challenge: CHALLENGE,
          origin: ORIGIN,
        }),
      ),
    ).toStartWith("the client data is not JSON");
  });
});

describe("what the authenticator said (WebAuthn L2 §7.2)", () => {
  test("a relying party this instance serves is let through, and another is not", async () => {
    const data = parseAuthenticatorData(await authData());
    expect(await refusal(() => checkAuthenticator(data, RP_ID))).toBe(undefined);
    // A name whose hash is not the one signed — including the one that only
    // looks like it.
    for (const rpId of ["ui.example.evil", "example", "UI.example"]) {
      expect([rpId, await refusal(() => checkAuthenticator(data, rpId))]).toEqual([
        rpId,
        "the authenticator answered for another relying party",
      ]);
    }
  });

  test("a person has to have been present and verified", async () => {
    // UV without UP, UP without UV, and neither.
    expect(
      await refusal(async () =>
        checkAuthenticator(parseAuthenticatorData(await authData({ flags: 0x04 })), RP_ID),
      ),
    ).toBe("no person was present");
    expect(
      await refusal(async () =>
        checkAuthenticator(parseAuthenticatorData(await authData({ flags: 0x01 })), RP_ID),
      ),
    ).toBe("no person was verified");
    expect(
      await refusal(async () =>
        checkAuthenticator(parseAuthenticatorData(await authData({ flags: 0x00 })), RP_ID),
      ),
    ).toBe("no person was present");
  });

  test("the counter is read as the authenticator wrote it", async () => {
    // Big-endian, and the whole 32 bits: a counter past 2^31 must not come
    // back negative.
    expect(parseAuthenticatorData(await authData({ signCount: 1 })).signCount).toBe(1);
    expect(parseAuthenticatorData(await authData({ signCount: 0xff_ff_ff_ff })).signCount).toBe(
      4_294_967_295,
    );
  });

  test("authenticator data shorter than its fixed head is refused", async () => {
    const short = (await authData()).subarray(0, 36);
    expect(await refusal(() => parseAuthenticatorData(short))).toBe(
      "the authenticator data is too short",
    );
  });
});
