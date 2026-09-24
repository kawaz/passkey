import { describe, expect, test } from "bun:test";
import { base64UrlDecode, base64UrlEncode, equalBytes } from "../src/bytes.js";
import {
  challengeOf,
  PasskeyVerificationError,
  type PasskeyVerificationReason,
  verifyAuthentication,
  verifyRegistration,
} from "../src/index.js";
import { b64, SoftAuthenticator, url } from "./authenticator.js";

const origin = "https://ui.example";
const rpId = "ui.example";
const challenge = "Y2hhbGxlbmdlLXdpdGgtZW50cm9weQ";
const expected = { challenge, origin, rpId };

async function reason(run: Promise<unknown>): Promise<PasskeyVerificationReason | undefined> {
  try {
    await run;
    return undefined;
  } catch (cause) {
    if (!(cause instanceof PasskeyVerificationError)) throw cause;
    return cause.reason;
  }
}

describe("the public surface", () => {
  test("a registration answers what the caller stores, and an authentication answers against it", async () => {
    const authenticator = new SoftAuthenticator(rpId, { algorithm: "EdDSA" });
    authenticator.backupEligible = true;
    authenticator.backupState = true;
    authenticator.signCount = 3;
    const registered = await verifyRegistration(
      await authenticator.create({ challenge, origin, userId: "dXNlci0x" }),
      expected,
    );
    expect(registered).toMatchObject({
      id: authenticator.credentialIdUrl,
      algorithm: -8,
      signCount: 3,
      backupEligible: true,
      backupState: true,
    });
    authenticator.signCount = 4;
    authenticator.backupState = false;
    const verified = await verifyAuthentication(
      await authenticator.get({ challenge, origin }),
      expected,
      registered,
    );
    expect(verified).toEqual({
      signCount: 4,
      backupEligible: true,
      backupState: false,
      userHandle: "dXNlci0x",
    });
  });

  test("an authentication without a user handle answers none", async () => {
    const authenticator = new SoftAuthenticator(rpId);
    const registered = await verifyRegistration(
      await authenticator.create({ challenge, origin }),
      expected,
    );
    const verified = await verifyAuthentication(
      await authenticator.get({ challenge, origin }),
      expected,
      registered,
    );
    expect("userHandle" in verified).toBe(false);
  });

  test("each refusal names the step that refused it", async () => {
    const authenticator = new SoftAuthenticator(rpId);
    const credential = await authenticator.create({ challenge, origin });
    expect(
      await reason(verifyRegistration(credential, { ...expected, challenge: "b3RoZXI" })),
    ).toBe("challenge");
    expect(
      await reason(
        verifyRegistration(credential, { ...expected, origin: "https://other.example" }),
      ),
    ).toBe("origin");
    expect(
      await reason(verifyRegistration(credential, { ...expected, rpId: "other.example" })),
    ).toBe("rp-id");
    expect(
      await reason(
        verifyRegistration({ ...credential, rawId: base64UrlEncode(new Uint8Array(16)) }, expected),
      ),
    ).toBe("credential-id");
    expect(
      await reason(
        verifyRegistration(
          { ...credential, response: { ...credential.response, clientDataJSON: "not base64url!" } },
          expected,
        ),
      ),
    ).toBe("encoding");
    const registered = await verifyRegistration(credential, expected);
    authenticator.signCount = 5;
    const assertion = await authenticator.get({ challenge, origin });
    expect(
      await reason(verifyAuthentication(assertion, expected, { ...registered, signCount: 5 })),
    ).toBe("sign-count");
    expect(
      await reason(
        verifyAuthentication(
          await new SoftAuthenticator(rpId).get({ challenge, origin }),
          expected,
          registered,
        ),
      ),
    ).toBe("signature");
    expect(
      await reason(verifyAuthentication(assertion, expected, { publicKey: "oA", signCount: 0 })),
    ).toBe("public-key");
    const embedded = new SoftAuthenticator(rpId, { crossOrigin: true });
    expect(
      await reason(verifyRegistration(await embedded.create({ challenge, origin }), expected)),
    ).toBe("embedded");
  });

  test("the challenge is read out of the client data before anything is verified", async () => {
    const credential = await new SoftAuthenticator(rpId).create({ challenge, origin });
    expect(challengeOf(credential.response.clientDataJSON)).toBe(challenge);
    const unread = (json: string): Promise<PasskeyVerificationReason | undefined> =>
      reason((async () => challengeOf(url(new TextEncoder().encode(json))))());
    expect(await unread("{")).toBe("client-data");
    expect(await unread('{"type":"webauthn.get"}')).toBe("client-data");
    expect(await unread("null")).toBe("client-data");
  });
});

describe("base64url without node:crypto", () => {
  test("round-trips every length against an independent encoder", () => {
    for (let length = 0; length < 70; length += 1) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      expect(base64UrlEncode(bytes)).toBe(url(bytes));
      expect(equalBytes(base64UrlDecode(url(bytes)), bytes)).toBe(true);
      expect(equalBytes(base64UrlDecode(url(bytes)), b64(url(bytes)))).toBe(true);
    }
  });

  test("padding is tolerated, and what no encoder writes is refused", () => {
    expect(base64UrlDecode("AQ==")).toEqual(new Uint8Array([1]));
    for (const broken of ["A", "AQ+/", "AQ.", "AQ==="]) {
      expect([
        broken,
        (() => {
          try {
            base64UrlDecode(broken);
            return undefined;
          } catch (cause) {
            return cause instanceof PasskeyVerificationError ? cause.reason : cause;
          }
        })(),
      ]).toEqual([broken, "encoding"]);
    }
  });

  test("the comparison answers equality alone", () => {
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});
