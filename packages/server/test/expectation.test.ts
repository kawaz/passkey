import { describe, expect, test } from "bun:test";
import {
  type AuthenticationResponse,
  PasskeyVerificationError,
  type RegistrationResponse,
  type PasskeyVerificationReason,
  verifyAuthentication,
  verifyRegistration,
} from "../src/index.js";
import { SoftAuthenticator } from "./authenticator.js";

const origin = "https://ui.example";
const rpId = "ui.example";
const challenge = "Y2hhbGxlbmdlLXdpdGgtZW50cm9weQ";
const expected = { challenge, origin, rpId };
const parent = "https://portal.example";

async function reason(run: Promise<unknown>): Promise<PasskeyVerificationReason | undefined> {
  try {
    await run;
    return undefined;
  } catch (cause) {
    if (!(cause instanceof PasskeyVerificationError)) throw cause;
    return cause.reason;
  }
}

describe("several expected origins and relying party ids", () => {
  test("the one that matched is answered, on both ceremonies", async () => {
    const authenticator = new SoftAuthenticator("ui.example");
    const several = {
      challenge,
      origin: ["https://www.example", origin],
      rpId: ["www.example", rpId],
    };
    const registered = await verifyRegistration(
      await authenticator.create({ challenge, origin }),
      several,
    );
    expect(registered).toMatchObject({ origin, rpId });
    const verified = await verifyAuthentication(
      await authenticator.get({ challenge, origin }),
      several,
      registered,
    );
    expect(verified).toMatchObject({ origin, rpId });
  });

  test("none matching is refused, and an empty list matches nothing", async () => {
    const credential = await new SoftAuthenticator(rpId).create({ challenge, origin });
    expect(
      await reason(verifyRegistration(credential, { ...expected, origin: ["https://a.example"] })),
    ).toBe("origin");
    expect(await reason(verifyRegistration(credential, { ...expected, origin: [] }))).toBe(
      "origin",
    );
    expect(
      await reason(
        verifyRegistration(credential, { ...expected, rpId: ["a.example", "b.example"] }),
      ),
    ).toBe("rp-id");
    expect(await reason(verifyRegistration(credential, { ...expected, rpId: [] }))).toBe("rp-id");
  });
});

describe("embedded exchanges (topOrigins, embeddedWithoutTopOrigin)", () => {
  /** Every shape of client data an exchange can arrive in, against every shape of expectation, on both ceremonies. */
  const shapes: [string, { crossOrigin?: boolean; topOrigin?: string }][] = [
    ["top-level, no crossOrigin", {}],
    ["top-level, crossOrigin: false", { crossOrigin: false }],
    ["embedded by the expected parent", { crossOrigin: true, topOrigin: parent }],
    ["embedded by another page", { crossOrigin: true, topOrigin: "https://evil.example" }],
    ["embedded, no topOrigin (Safari)", { crossOrigin: true }],
    ["topOrigin without crossOrigin", { topOrigin: parent }],
    ["topOrigin with crossOrigin: false", { crossOrigin: false, topOrigin: parent }],
  ];
  const expectations: [string, Record<string, unknown>][] = [
    ["no option", {}],
    ["topOrigins", { topOrigins: [parent] }],
    ["topOrigins + allow", { topOrigins: [parent], embeddedWithoutTopOrigin: "allow" }],
    ["allow without topOrigins", { embeddedWithoutTopOrigin: "allow" }],
  ];
  const E = "embedded";
  const table: Record<string, (PasskeyVerificationReason | undefined)[]> = {
    "top-level, no crossOrigin": [undefined, undefined, undefined, undefined],
    "top-level, crossOrigin: false": [undefined, undefined, undefined, undefined],
    "embedded by the expected parent": [E, undefined, undefined, E],
    "embedded by another page": [E, E, E, E],
    "embedded, no topOrigin (Safari)": [E, E, undefined, E],
    "topOrigin without crossOrigin": [E, E, E, E],
    "topOrigin with crossOrigin: false": [E, E, E, E],
  };

  for (const ceremony of ["registration", "authentication"] as const) {
    test(`${ceremony}: the table of what is admitted`, async () => {
      const seen: Record<string, (PasskeyVerificationReason | undefined)[]> = {};
      for (const [name, shape] of shapes) {
        const authenticator = new SoftAuthenticator(rpId);
        const registration = await authenticator.create({ challenge, origin });
        const registered = await verifyRegistration(registration, expected);
        authenticator.crossOrigin = shape.crossOrigin;
        authenticator.topOrigin = shape.topOrigin;
        const row: (PasskeyVerificationReason | undefined)[] = [];
        for (const [, option] of expectations) {
          const run =
            ceremony === "registration"
              ? verifyRegistration(await authenticator.create({ challenge, origin }), {
                  ...expected,
                  ...option,
                })
              : verifyAuthentication(
                  await authenticator.get({ challenge, origin }),
                  { ...expected, ...option },
                  registered,
                );
          row.push(await reason(run));
        }
        seen[name] = row;
      }
      expect(seen).toEqual(table);
    });
  }
});

describe("the key's algorithm against the ones the options listed", () => {
  test("an algorithm outside expected.algorithms is refused, and leaving it out admits all three", async () => {
    for (const algorithm of ["ES256", "EdDSA", "RS256"] as const) {
      const credential = await new SoftAuthenticator(rpId, { algorithm }).create({
        challenge,
        origin,
      });
      expect(await reason(verifyRegistration(credential, expected))).toBeUndefined();
    }
    const eddsa = await new SoftAuthenticator(rpId, { algorithm: "EdDSA" }).create({
      challenge,
      origin,
    });
    expect(await reason(verifyRegistration(eddsa, { ...expected, algorithms: [-7, -257] }))).toBe(
      "algorithm",
    );
    expect(
      await reason(verifyRegistration(eddsa, { ...expected, algorithms: [-8] })),
    ).toBeUndefined();
  });
});

describe("the backup flags", () => {
  test("BS without BE is refused on both ceremonies", async () => {
    const authenticator = new SoftAuthenticator(rpId);
    const registered = await verifyRegistration(
      await authenticator.create({ challenge, origin }),
      expected,
    );
    authenticator.backupState = true;
    expect(
      await reason(verifyRegistration(await authenticator.create({ challenge, origin }), expected)),
    ).toBe("backup-state");
    expect(
      await reason(
        verifyAuthentication(await authenticator.get({ challenge, origin }), expected, registered),
      ),
    ).toBe("backup-state");
  });

  test("the stored BE, when given, has to be the one reported, in both directions", async () => {
    for (const [stored, current, refused] of [
      [undefined, false, false],
      [undefined, true, false],
      [false, false, false],
      [true, true, false],
      [false, true, true],
      [true, false, true],
    ] as const) {
      const authenticator = new SoftAuthenticator(rpId);
      const registered = await verifyRegistration(
        await authenticator.create({ challenge, origin }),
        expected,
      );
      authenticator.backupEligible = current;
      const run = verifyAuthentication(await authenticator.get({ challenge, origin }), expected, {
        publicKey: registered.publicKey,
        signCount: 0,
        ...(stored === undefined ? {} : { backupEligible: stored }),
      });
      expect([stored, current, await reason(run)]).toEqual([
        stored,
        current,
        refused ? "backup-eligibility" : undefined,
      ]);
    }
  });
});

describe("the credential id's length (L3 §7.1 step 25)", () => {
  test("1023 bytes is admitted and 1024 is refused", async () => {
    const at = async (length: number) => {
      const authenticator = new SoftAuthenticator(rpId, { credentialIdLength: length });
      return reason(
        verifyRegistration(await authenticator.create({ challenge, origin }), expected),
      );
    };
    expect(await at(1)).toBeUndefined();
    expect(await at(1023)).toBeUndefined();
    expect(await at(1024)).toBe("credential");
  });
});

describe("transports", () => {
  test("the response's transports are copied, and absent or malformed ones answer []", async () => {
    const credential = await new SoftAuthenticator(rpId).create({ challenge, origin });
    expect((await verifyRegistration(credential, expected)).transports).toEqual(["internal"]);
    // lib.dom's type requires `transports`; a caller that maps its own stored contract into this shape may still leave it out.
    const { transports: _, ...rest } = credential.response;
    const bare = rest as AuthenticatorAttestationResponseJSON;
    expect(
      (await verifyRegistration({ ...credential, response: bare }, expected)).transports,
    ).toEqual([]);
    const malformed = { ...credential.response, transports: [1] as unknown as string[] };
    expect(
      (await verifyRegistration({ ...credential, response: malformed }, expected)).transports,
    ).toEqual([]);
  });
});

describe("the user handle of an account identified beforehand (L3 §7.2 step 6)", () => {
  test("a different one is refused, the same one or none in the response is admitted", async () => {
    const authenticator = new SoftAuthenticator(rpId);
    const registered = await verifyRegistration(
      await authenticator.create({ challenge, origin, userId: "dXNlci0x" }),
      expected,
    );
    const assertion = await authenticator.get({ challenge, origin });
    expect(
      await reason(
        verifyAuthentication(assertion, { ...expected, userHandle: "dXNlci0y" }, registered),
      ),
    ).toBe("user-handle");
    expect(
      await reason(
        verifyAuthentication(assertion, { ...expected, userHandle: "dXNlci0x" }, registered),
      ),
    ).toBeUndefined();
    const { userHandle: _, ...withoutHandle } = assertion.response;
    expect(
      await reason(
        verifyAuthentication(
          { ...assertion, response: withoutHandle },
          { ...expected, userHandle: "dXNlci0y" },
          registered,
        ),
      ),
    ).toBeUndefined();
  });
});

describe("the sign count (L3 §7.2 step 22)", () => {
  test("the specification's condition refuses exactly what 'a non-zero stored value that did not advance' refuses", async () => {
    const readings = [0, 1, 2, 5, 0xffffffff];
    const authenticator = new SoftAuthenticator(rpId);
    const registered = await verifyRegistration(
      await authenticator.create({ challenge, origin }),
      expected,
    );
    for (const stored of readings) {
      for (const current of readings) {
        authenticator.signCount = current;
        const got = await reason(
          verifyAuthentication(await authenticator.get({ challenge, origin }), expected, {
            publicKey: registered.publicKey,
            signCount: stored,
          }),
        );
        const storedNonZeroRule = stored !== 0 && current <= stored;
        expect([stored, current, got]).toEqual([
          stored,
          current,
          storedNonZeroRule ? "sign-count" : undefined,
        ]);
      }
    }
  });
});

describe("the input types (PK-Q3)", () => {
  test("lib.dom's toJSON() forms are assignable, and so are objects with only the members read", async () => {
    const fromDom = (json: RegistrationResponseJSON): RegistrationResponse => json;
    const fromDomAssertion = (json: AuthenticationResponseJSON): AuthenticationResponse => json;
    const authenticator = new SoftAuthenticator(rpId);
    const full = await authenticator.create({ challenge, origin, userId: "dXNlci0x" });
    const minimal = {
      rawId: full.rawId,
      response: {
        clientDataJSON: full.response.clientDataJSON,
        attestationObject: full.response.attestationObject,
      },
    } satisfies RegistrationResponse;
    const registered = await verifyRegistration(minimal, expected);
    expect(registered.transports).toEqual([]);
    await verifyRegistration(fromDom(full), expected);
    const assertion = await authenticator.get({ challenge, origin });
    const verified = await verifyAuthentication(
      {
        rawId: assertion.rawId,
        response: {
          clientDataJSON: assertion.response.clientDataJSON,
          authenticatorData: assertion.response.authenticatorData,
          signature: assertion.response.signature,
          userHandle: null,
        },
      } satisfies AuthenticationResponse,
      { ...expected, userHandle: "dXNlci0y" },
      registered,
    );
    expect("userHandle" in verified).toBe(false);
    await verifyAuthentication(fromDomAssertion(assertion), expected, registered);
  });
});
