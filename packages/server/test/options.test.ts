import { describe, expect, test } from "bun:test";
import { base64UrlDecode } from "../src/bytes.js";
import {
  authenticationOptions,
  type PasskeyAlgorithm,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../src/index.js";
import { b64, type SoftAlgorithm, SoftAuthenticator, url } from "./authenticator.js";

const origin = "https://ui.example";
const rpId = "ui.example";
const rp = { id: rpId, name: "UI Example" };
const user = { name: "alice@example.com" };
const SOFT: Record<PasskeyAlgorithm, SoftAlgorithm> = {
  [-7]: "ES256",
  [-8]: "EdDSA",
  [-257]: "RS256",
};

/** What a browser does with the challenge: it takes the bytes the options carry and writes them back, base64url, into the client data. Decoded and re-encoded by the test's own codec so the round trip does not lean on the package's. */
function asBrowser(challenge: string): string {
  return url(b64(challenge));
}

function bytes(value: string): number {
  return base64UrlDecode(value).length;
}

describe("registrationOptions", () => {
  test("the defaults are the safe side, and what is fixed is not the caller's to spell", () => {
    const options = registrationOptions({ rp, user });
    expect(options).toEqual({
      rp,
      user: { id: options.user.id, name: user.name, displayName: "" },
      challenge: options.challenge,
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -8 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 60000,
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
      attestation: "none",
    });
    expect(bytes(options.challenge)).toBe(32);
    expect(bytes(options.user.id)).toBe(32);
    const again = registrationOptions({ rp, user });
    expect(again.challenge).not.toBe(options.challenge);
    expect(again.user.id).not.toBe(options.user.id);
  });

  test("what the caller gives is written as given, in the vocabulary of the specification", () => {
    const options = registrationOptions({
      rp,
      user: { id: "dXNlci0x", name: user.name, displayName: "Alice" },
      challenge: "AAAAAAAAAAAAAAAAAAAAAA",
      excludeCredentials: [
        { id: "Y3JlZC0x", transports: ["internal", "hybrid"] },
        { id: "Y3JlZC0y" },
      ],
      algorithms: [-257, -7],
      residentKey: "preferred",
      authenticatorAttachment: "platform",
      hints: ["client-device", "hybrid"],
      timeout: 300000,
      extensions: { credProps: true },
    });
    expect(options).toEqual({
      rp,
      user: { id: "dXNlci0x", name: user.name, displayName: "Alice" },
      challenge: "AAAAAAAAAAAAAAAAAAAAAA",
      pubKeyCredParams: [
        { type: "public-key", alg: -257 },
        { type: "public-key", alg: -7 },
      ],
      timeout: 300000,
      excludeCredentials: [
        { type: "public-key", id: "Y3JlZC0x", transports: ["internal", "hybrid"] },
        { type: "public-key", id: "Y3JlZC0y" },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        requireResidentKey: false,
        userVerification: "required",
      },
      hints: ["client-device", "hybrid"],
      attestation: "none",
      extensions: { credProps: true },
    });
  });

  test("a challenge shorter than 16 bytes, and a user id outside 1 to 64 bytes, are the caller's mistake", () => {
    const sized = (length: number): string => url(new Uint8Array(length));
    expect(() => registrationOptions({ rp, user, challenge: sized(15) })).toThrow(RangeError);
    expect(registrationOptions({ rp, user, challenge: sized(16) }).challenge).toBe(sized(16));
    expect(() => registrationOptions({ rp, user: { ...user, id: "" } })).toThrow(RangeError);
    expect(registrationOptions({ rp, user: { ...user, id: sized(1) } }).user.id).toBe(sized(1));
    expect(registrationOptions({ rp, user: { ...user, id: sized(64) } }).user.id).toBe(sized(64));
    expect(() => registrationOptions({ rp, user: { ...user, id: sized(65) } })).toThrow(RangeError);
    expect(() => registrationOptions({ rp, user, challenge: "not base64url!" })).toThrow(TypeError);
    expect(() => registrationOptions({ rp, user: { ...user, id: "a+b" } })).toThrow(TypeError);
    expect(() => registrationOptions({ rp, user, excludeCredentials: [{ id: "a/b" }] })).toThrow(
      TypeError,
    );
  });

  test("a timeout has to be a non-negative whole number of milliseconds, and an algorithm one verified here", () => {
    expect(registrationOptions({ rp, user, timeout: 0 }).timeout).toBe(0);
    for (const timeout of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => registrationOptions({ rp, user, timeout })).toThrow(RangeError);
    }
    expect(() => registrationOptions({ rp, user, algorithms: [] })).toThrow(RangeError);
    expect(() => registrationOptions({ rp, user, algorithms: [-35 as PasskeyAlgorithm] })).toThrow(
      RangeError,
    );
  });
});

describe("authenticationOptions", () => {
  test("the defaults, and a missing or empty allowCredentials left out of the JSON", () => {
    const options = authenticationOptions({ rpId });
    expect(options).toEqual({
      challenge: options.challenge,
      timeout: 60000,
      rpId,
      userVerification: "required",
    });
    expect(bytes(options.challenge)).toBe(32);
    expect("allowCredentials" in authenticationOptions({ rpId, allowCredentials: [] })).toBe(false);
  });

  test("what the caller gives is written as given", () => {
    expect(
      authenticationOptions({
        rpId,
        challenge: "AAAAAAAAAAAAAAAAAAAAAA",
        allowCredentials: [{ id: "Y3JlZC0x", transports: ["usb"] }],
        hints: ["security-key"],
        timeout: 120000,
        extensions: { appid: "https://ui.example" },
      }),
    ).toEqual({
      challenge: "AAAAAAAAAAAAAAAAAAAAAA",
      timeout: 120000,
      rpId,
      allowCredentials: [{ type: "public-key", id: "Y3JlZC0x", transports: ["usb"] }],
      userVerification: "required",
      hints: ["security-key"],
      extensions: { appid: "https://ui.example" },
    });
  });

  test("the input is checked as the registration's is", () => {
    expect(() => authenticationOptions({ rpId, challenge: url(new Uint8Array(15)) })).toThrow(
      RangeError,
    );
    expect(() => authenticationOptions({ rpId, timeout: -1 })).toThrow(RangeError);
    expect(() => authenticationOptions({ rpId, allowCredentials: [{ id: "a/b" }] })).toThrow(
      TypeError,
    );
  });
});

describe("the options round-trip through an authenticator into verification", () => {
  for (const alg of [-7, -8, -257] as const) {
    test(`${SOFT[alg]}: the options a registration and an authentication start from are the ones they are verified against`, async () => {
      const creation = registrationOptions({ rp, user, algorithms: [alg] });
      const first = creation.pubKeyCredParams[0];
      expect(first?.alg).toBe(alg);
      const authenticator = new SoftAuthenticator(creation.rp.id as string, {
        algorithm: SOFT[alg],
      });
      const registration = await authenticator.create({
        challenge: asBrowser(creation.challenge),
        origin,
        userId: creation.user.id,
      });
      const registered = await verifyRegistration(registration, {
        challenge: creation.challenge,
        origin,
        rpId,
        algorithms: creation.pubKeyCredParams.map((param) => param.alg as PasskeyAlgorithm),
      });
      expect(registered.algorithm).toBe(alg);

      const request = authenticationOptions({
        rpId,
        allowCredentials: [{ id: registered.id, transports: registered.transports }],
      });
      expect(request.allowCredentials).toEqual([
        { type: "public-key", id: registered.id, transports: ["internal"] },
      ]);
      authenticator.signCount = 1;
      const verified = await verifyAuthentication(
        await authenticator.get({ challenge: asBrowser(request.challenge), origin }),
        {
          challenge: request.challenge,
          origin,
          rpId: request.rpId as string,
          userHandle: creation.user.id,
        },
        registered,
      );
      expect(verified).toMatchObject({ signCount: 1, userHandle: creation.user.id, origin, rpId });
    });
  }
});
