import { afterEach, expect, test } from "bun:test";
import { verifyAuthentication, verifyRegistration } from "../../server/src/index.js";
import { SoftAuthenticator } from "../../server/test/authenticator.js";
import { authenticate, register } from "../src/index.js";
import { base64url, buffer, fromBase64url, installCredentials, uninstall } from "./fake.js";

afterEach(uninstall);

const origin = "https://ui.example";
const rpId = "ui.example";

/** `navigator.credentials` backed by a software authenticator: it reads the buffers the client opened, and hands back what a browser would, buffers and getters, built from the authenticator's own JSON. */
function browserOver(authenticator: SoftAuthenticator) {
  return installCredentials({
    create: async (options) => {
      const publicKey = options.publicKey as PublicKeyCredentialCreationOptions;
      const made = await authenticator.create({
        challenge: base64url(publicKey.challenge),
        origin,
        userId: base64url(publicKey.user.id),
      });
      const { response } = made;
      return {
        id: made.id,
        rawId: buffer(fromBase64url(made.rawId)),
        type: made.type,
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: buffer(fromBase64url(response.clientDataJSON)),
          attestationObject: buffer(fromBase64url(response.attestationObject)),
          getAuthenticatorData: () => buffer(fromBase64url(response.authenticatorData)),
          getPublicKey: () => null,
          getPublicKeyAlgorithm: () => response.publicKeyAlgorithm,
          getTransports: () => response.transports,
        },
        getClientExtensionResults: () => ({
          credProps: { rk: true },
          prf: { enabled: true, results: { first: buffer([1, 2, 3]) } },
        }),
      };
    },
    get: async (options) => {
      const publicKey = options.publicKey as PublicKeyCredentialRequestOptions;
      const made = await authenticator.get({ challenge: base64url(publicKey.challenge), origin });
      const { response } = made;
      return {
        id: made.id,
        rawId: buffer(fromBase64url(made.rawId)),
        type: made.type,
        authenticatorAttachment: "platform",
        response: {
          clientDataJSON: buffer(fromBase64url(response.clientDataJSON)),
          authenticatorData: buffer(fromBase64url(response.authenticatorData)),
          signature: buffer(fromBase64url(response.signature)),
          userHandle:
            response.userHandle === undefined ? null : buffer(fromBase64url(response.userHandle)),
        },
        getClientExtensionResults: () => ({ prf: { results: { first: buffer([4, 5, 6]) } } }),
      };
    },
  });
}

test.each(["ES256", "EdDSA", "RS256"] as const)(
  "what the client sends is what the server verifies (%s)",
  async (algorithm) => {
    const authenticator = new SoftAuthenticator(rpId, { algorithm });
    browserOver(authenticator);

    const registrationChallenge = "cmVnaXN0cmF0aW9uLWNoYWxsZW5nZQ";
    const options: PublicKeyCredentialCreationOptionsJSON = {
      challenge: registrationChallenge,
      rp: { id: rpId, name: "UI" },
      user: { id: "dXNlci0x", name: "alice", displayName: "Alice" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -8 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { credProps: true, prf: { eval: { first: "AQID" } } },
    };
    const registration = await register(options);
    const wire = JSON.parse(JSON.stringify(registration.json)) as RegistrationResponseJSON;
    expect(wire.clientExtensionResults).toEqual({
      credProps: { rk: true },
      prf: { enabled: true },
    });
    const registered = await verifyRegistration(wire, {
      challenge: registrationChallenge,
      origin,
      rpId,
    });
    expect(registered.id).toBe(authenticator.credentialIdUrl);

    for (const controls of [
      {},
      { mediation: "conditional", signal: new AbortController().signal },
    ] as const) {
      authenticator.signCount += 1;
      const authenticationChallenge = base64url(
        new TextEncoder().encode(`authentication-challenge-${authenticator.signCount}`),
      );
      const authentication = await authenticate(
        {
          challenge: authenticationChallenge,
          rpId,
          userVerification: "required",
          allowCredentials: [{ type: "public-key", id: registered.id }],
        },
        controls,
      );
      const sent = JSON.parse(JSON.stringify(authentication.json)) as AuthenticationResponseJSON;
      expect(sent.clientExtensionResults).toEqual({ prf: {} });
      const verified = await verifyAuthentication(
        sent,
        { challenge: authenticationChallenge, origin, rpId },
        registered,
      );
      expect(verified.userHandle).toBe("dXNlci0x");
      expect(verified.signCount).toBe(authenticator.signCount);
    }
  },
);
