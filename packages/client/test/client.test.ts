import { afterEach, describe, expect, test } from "bun:test";
import { base64UrlDecode, base64UrlEncode } from "../src/bytes.js";
import {
  authenticate,
  capabilities,
  context,
  PasskeyError,
  type PasskeyErrorKind,
  register,
} from "../src/index.js";
import {
  assertionCredential,
  attestationCredential,
  base64url,
  buffer,
  domError,
  installCredentials,
  setCredentials,
  setGlobal,
  uninstall,
} from "./fake.js";

afterEach(uninstall);

const creation: PublicKeyCredentialCreationOptionsJSON = {
  challenge: "AAECAwQ",
  rp: { id: "ui.example", name: "UI" },
  user: { id: "dXNlci0x", name: "alice", displayName: "Alice" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  timeout: 60000,
  hints: ["client-device"],
  attestation: "none",
  authenticatorSelection: { residentKey: "required", userVerification: "required" },
  excludeCredentials: [{ type: "public-key", id: "CgsM", transports: ["internal"] }],
};

const request: PublicKeyCredentialRequestOptionsJSON = {
  challenge: "AAECAwQ",
  rpId: "ui.example",
  userVerification: "required",
  allowCredentials: [{ type: "public-key", id: "CgsM" }],
};

async function kindOf(run: Promise<unknown>): Promise<PasskeyErrorKind | "resolved"> {
  try {
    await run;
    return "resolved";
  } catch (caught) {
    if (!(caught instanceof PasskeyError)) throw caught;
    return caught.kind;
  }
}

function bytes(source: BufferSource | undefined): number[] {
  if (source === undefined) throw new Error("missing buffer");
  return [...new Uint8Array(source instanceof ArrayBuffer ? source : source.buffer)];
}

describe("base64url", () => {
  test("round-trips every length and refuses what no encoding produces", () => {
    for (let length = 0; length < 8; length += 1) {
      const input = Uint8Array.from({ length }, (_, at) => at * 37 + 250);
      const text = base64UrlEncode(input);
      expect(text).toBe(base64url(input));
      expect([...base64UrlDecode(text)]).toEqual([...input]);
    }
    expect([...base64UrlDecode("AQI=")]).toEqual([1, 2]);
    expect(() => base64UrlDecode("A")).toThrow(TypeError);
    expect(() => base64UrlDecode("AQ+/")).toThrow(TypeError);
  });
});

describe("register: options JSON is opened into buffers", () => {
  test("challenge, user.id and excludeCredentials[].id are opened; everything else is passed as written", async () => {
    const calls = installCredentials({ create: async () => attestationCredential({}) });
    await register(creation);
    const options = calls.create[0] as CredentialCreationOptions;
    const publicKey = options.publicKey as PublicKeyCredentialCreationOptions & {
      hints?: string[];
    };
    expect(bytes(publicKey.challenge)).toEqual([0, 1, 2, 3, 4]);
    expect(bytes(publicKey.user.id)).toEqual([...new TextEncoder().encode("user-1")]);
    expect(publicKey.user.name).toBe("alice");
    expect(bytes(publicKey.excludeCredentials?.[0]?.id)).toEqual([10, 11, 12]);
    expect(publicKey.excludeCredentials?.[0]?.transports).toEqual(["internal"]);
    expect(publicKey.timeout).toBe(60000);
    expect(publicKey.hints).toEqual(["client-device"]);
    expect(publicKey.attestation).toBe("none");
    expect(publicKey.authenticatorSelection).toEqual(creation.authenticatorSelection ?? {});
    expect(publicKey.rp).toEqual(creation.rp);
    expect("signal" in options).toBe(false);
  });

  test("members the options leave out are not filled in", async () => {
    const calls = installCredentials({ create: async () => attestationCredential({}) });
    await register({
      challenge: "AA",
      rp: { name: "UI" },
      user: { id: "AA", name: "a", displayName: "a" },
      pubKeyCredParams: [],
    });
    const publicKey = calls.create[0]?.publicKey as unknown as Record<string, unknown>;
    expect(Object.keys(publicKey).sort()).toEqual(["challenge", "pubKeyCredParams", "rp", "user"]);
  });

  test("prf eval / evalByCredential and largeBlob.write are opened; other extensions pass as written", async () => {
    const calls = installCredentials({
      create: async () => attestationCredential({}),
      get: async () => assertionCredential({}),
    });
    const extensions = {
      credProps: true,
      appid: "https://legacy.example",
      appidExclude: "https://legacy.example",
      prf: { eval: { first: "AQI", second: "AwQ" } },
      largeBlob: { support: "preferred", write: "BQY" },
      credentialProtectionPolicy: "userVerificationRequired",
    } as AuthenticationExtensionsClientInputsJSON;
    await register({ ...creation, extensions });
    const opened = calls.create[0]?.publicKey?.extensions as Record<string, any>;
    expect(bytes(opened["prf"].eval.first)).toEqual([1, 2]);
    expect(bytes(opened["prf"].eval.second)).toEqual([3, 4]);
    expect(bytes(opened["largeBlob"].write)).toEqual([5, 6]);
    expect(opened["largeBlob"].support).toBe("preferred");
    expect(opened["credProps"]).toBe(true);
    expect(opened["appid"]).toBe("https://legacy.example");
    expect(opened["appidExclude"]).toBe("https://legacy.example");
    expect(opened["credentialProtectionPolicy"]).toBe("userVerificationRequired");

    await authenticate({
      ...request,
      extensions: {
        prf: { evalByCredential: { CgsM: { first: "AQI" } } },
        largeBlob: { read: true },
      },
    });
    const byCredential = calls.get[0]?.publicKey?.extensions as Record<string, any>;
    expect(bytes(byCredential["prf"].evalByCredential.CgsM.first)).toEqual([1, 2]);
    expect("second" in byCredential["prf"].evalByCredential.CgsM).toBe(false);
    expect(byCredential["largeBlob"]).toEqual({ read: true });
  });

  test("a malformed base64url value in the options fails before the browser is asked", async () => {
    const calls = installCredentials({ create: async () => attestationCredential({}) });
    expect(await kindOf(register({ ...creation, challenge: "A" }))).toBe("failed");
    expect(calls.create).toHaveLength(0);
  });
});

describe("register: the result is shaped as the Level 3 toJSON() form", () => {
  test("every member of RegistrationResponseJSON", async () => {
    installCredentials({
      create: async () =>
        attestationCredential({
          id: new Uint8Array([1, 2, 3, 4]),
          clientDataJSON: buffer([1]),
          attestationObject: buffer([2]),
          authenticatorData: buffer([3]),
          publicKey: buffer([4]),
          publicKeyAlgorithm: -8,
          transports: ["hybrid", "internal"],
          authenticatorAttachment: "cross-platform",
          extensions: { credProps: { rk: true } },
        }),
    });
    const { json, extensions } = await register(creation);
    expect(json).toEqual({
      id: "AQIDBA",
      rawId: "AQIDBA",
      type: "public-key",
      authenticatorAttachment: "cross-platform",
      response: {
        clientDataJSON: "AQ",
        attestationObject: "Ag",
        authenticatorData: "Aw",
        publicKey: "BA",
        publicKeyAlgorithm: -8,
        transports: ["hybrid", "internal"],
      },
      clientExtensionResults: { credProps: { rk: true } },
    });
    expect(extensions).toEqual({ credProps: { rk: true } });
  });

  test("a null authenticatorAttachment and a null getPublicKey() are left out", async () => {
    installCredentials({
      create: async () => attestationCredential({ authenticatorAttachment: null, publicKey: null }),
    });
    const { json } = await register(creation);
    expect("authenticatorAttachment" in json).toBe(false);
    expect("publicKey" in json.response).toBe(false);
  });

  test("a browser without the attestation getters fails", async () => {
    installCredentials({ create: async () => attestationCredential({ withoutGetters: true }) });
    expect(await kindOf(register(creation))).toBe("failed");
  });

  test("prf.results is kept out of json but stays in extensions; prf.enabled and largeBlob.blob are written", async () => {
    const first = new Uint8Array([0xaa, 0xbb]);
    const raw = {
      prf: { enabled: true, results: { first: buffer(first), second: buffer([0xcc]) } },
      largeBlob: { blob: buffer([1, 2, 3]) },
    };
    installCredentials({ create: async () => attestationCredential({ extensions: raw }) });
    const { json, extensions } = await register(creation);
    expect(json.clientExtensionResults).toEqual({
      prf: { enabled: true },
      largeBlob: { blob: "AQID" },
    });
    expect(JSON.stringify(json)).not.toContain(base64url(first));
    expect(extensions).toBe(raw as AuthenticationExtensionsClientOutputs);
    expect(bytes(extensions.prf?.results?.first)).toEqual([0xaa, 0xbb]);
  });

  test("a buffer an unknown extension answers with is written as base64url", async () => {
    installCredentials({
      create: async () =>
        attestationCredential({
          extensions: { someExtension: { value: new Uint8Array([1, 2]), list: [buffer([3])] } },
        }),
    });
    const { json } = await register(creation);
    expect(json.clientExtensionResults).toEqual({
      someExtension: { value: "AQI", list: ["Aw"] },
    } as AuthenticationExtensionsClientOutputsJSON);
  });
});

describe("authenticate: the result is shaped as the Level 3 toJSON() form", () => {
  test("options are opened and every member of AuthenticationResponseJSON is written", async () => {
    const calls = installCredentials({
      get: async () =>
        assertionCredential({
          clientDataJSON: buffer([1]),
          authenticatorData: buffer([2]),
          signature: buffer([3]),
          userHandle: buffer([4]),
          extensions: { prf: { results: { first: buffer([9]) } } },
        }),
    });
    const { json, extensions } = await authenticate(request);
    const publicKey = calls.get[0]?.publicKey as PublicKeyCredentialRequestOptions;
    expect(bytes(publicKey.challenge)).toEqual([0, 1, 2, 3, 4]);
    expect(bytes(publicKey.allowCredentials?.[0]?.id)).toEqual([10, 11, 12]);
    expect(publicKey.rpId).toBe("ui.example");
    expect(publicKey.userVerification).toBe("required");
    expect("mediation" in (calls.get[0] as object)).toBe(false);
    expect(json).toEqual({
      id: "AQIDBA",
      rawId: "AQIDBA",
      type: "public-key",
      authenticatorAttachment: "platform",
      response: {
        clientDataJSON: "AQ",
        authenticatorData: "Ag",
        signature: "Aw",
        userHandle: "BA",
      },
      clientExtensionResults: { prf: {} },
    });
    expect(bytes(extensions.prf?.results?.first)).toEqual([9]);
  });

  test("a null userHandle is left out", async () => {
    installCredentials({ get: async () => assertionCredential({ userHandle: null }) });
    const { json } = await authenticate(request);
    expect("userHandle" in json.response).toBe(false);
  });

  test("conditional mediation hands mediation and signal to get()", async () => {
    const calls = installCredentials({ get: async () => assertionCredential({}) });
    const controller = new AbortController();
    await authenticate(request, { mediation: "conditional", signal: controller.signal });
    expect(calls.get[0]?.mediation).toBe("conditional");
    expect(calls.get[0]?.signal).toBe(controller.signal);
  });

  test("the type requires a signal with conditional mediation", () => {
    const check = () => {
      // @ts-expect-error: conditional mediation without a signal could never be taken down.
      void authenticate(request, { mediation: "conditional" });
    };
    expect(typeof check).toBe("function");
  });
});

describe("failures are sorted into four kinds", () => {
  test.each([
    ["NotAllowedError", "create", "declined"],
    ["NotAllowedError", "get", "declined"],
    ["InvalidStateError", "create", "excluded"],
    ["InvalidStateError", "get", "failed"],
    ["AbortError", "create", "aborted"],
    ["AbortError", "get", "aborted"],
    ["SecurityError", "get", "failed"],
    ["NotSupportedError", "create", "failed"],
    ["ConstraintError", "create", "failed"],
  ] as const)("%s from %s() is %s", async (name, ceremony, kind) => {
    const thrown = domError(name, `${name}: the message`);
    installCredentials({ create: () => Promise.reject(thrown), get: () => Promise.reject(thrown) });
    let caught: unknown;
    try {
      await (ceremony === "create" ? register(creation) : authenticate(request));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PasskeyError);
    const error = caught as PasskeyError;
    expect(error.kind).toBe(kind);
    expect(error.message).toBe(`${name}: the message`);
    expect(error.cause).toBe(thrown);
  });

  test("a TypeError from the browser is failed", async () => {
    const thrown = new TypeError("bad options");
    installCredentials({ create: () => Promise.reject(thrown) });
    expect(await kindOf(register(creation))).toBe("failed");
  });

  test("a null answer is declined", async () => {
    installCredentials({ create: async () => null, get: async () => null });
    expect(await kindOf(register(creation))).toBe("declined");
    expect(await kindOf(authenticate(request))).toBe("declined");
  });

  test("no PublicKeyCredential is failed, and the browser is not asked", async () => {
    const calls = installCredentials({ create: async () => attestationCredential({}) });
    setGlobal("PublicKeyCredential", undefined);
    expect(await kindOf(register(creation))).toBe("failed");
    expect(calls.create).toHaveLength(0);
    setCredentials(undefined);
    installCredentials({});
    setCredentials(undefined);
    expect(await kindOf(authenticate(request))).toBe("failed");
  });

  test("aborting the caller's signal comes back as aborted, with a custom reason too", async () => {
    const pending = (options: CredentialRequestOptions) =>
      new Promise<unknown>((_, reject) => {
        const signal = options.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const calls = installCredentials({ get: pending, create: pending });
    const controller = new AbortController();
    const waiting = authenticate(request, { mediation: "conditional", signal: controller.signal });
    controller.abort();
    expect(await kindOf(waiting)).toBe("aborted");
    expect(calls.get[0]?.signal).toBe(controller.signal);

    const other = new AbortController();
    const registering = register(creation, { signal: other.signal });
    other.abort(new Error("unmounted"));
    expect(await kindOf(registering)).toBe("aborted");
    expect(calls.create[0]?.signal).toBe(other.signal);
  });
});

describe("capabilities", () => {
  test("getClientCapabilities() is returned as it is", async () => {
    const answer = { conditionalGet: true, hybridTransport: false, "extension:prf": true };
    installCredentials({ statics: { getClientCapabilities: async () => answer } });
    expect(await capabilities()).toEqual(answer);
  });

  test("without it, conditionalGet and userVerifyingPlatformAuthenticator come from the older methods and nothing else is said", async () => {
    installCredentials({
      statics: {
        isConditionalMediationAvailable: async () => true,
        isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
      },
    });
    expect(await capabilities()).toEqual({
      conditionalGet: true,
      userVerifyingPlatformAuthenticator: false,
    });
    installCredentials({
      statics: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
    });
    expect(await capabilities()).toEqual({
      conditionalGet: false,
      userVerifyingPlatformAuthenticator: true,
    });
  });

  test("without PublicKeyCredential, every ClientCapability is false", async () => {
    setGlobal("PublicKeyCredential", undefined);
    expect(await capabilities()).toEqual({
      conditionalCreate: false,
      conditionalGet: false,
      hybridTransport: false,
      passkeyPlatformAuthenticator: false,
      userVerifyingPlatformAuthenticator: false,
      relatedOrigins: false,
      signalAllAcceptedCredentials: false,
      signalCurrentUserDetails: false,
      signalUnknownCredential: false,
    });
  });
});

describe("context", () => {
  test("a top-level page with a permissions policy and a standalone display", () => {
    const self = {} as Window;
    setGlobal("window", { top: self, self });
    setGlobal("matchMedia", (query: string) => ({
      matches: query === "(display-mode: standalone)",
    }));
    const asked: string[] = [];
    setGlobal("document", {
      permissionsPolicy: {
        allowsFeature: (feature: string) => {
          asked.push(feature);
          return feature === "publickey-credentials-get";
        },
      },
    });
    expect(context()).toEqual({
      embedded: false,
      standalone: true,
      allowed: { create: false, get: true },
    });
    expect(asked).toEqual(["publickey-credentials-create", "publickey-credentials-get"]);
  });

  test("a frame is embedded, and one whose top cannot be compared is embedded too", () => {
    setGlobal("window", { top: {}, self: {} });
    expect(context().embedded).toBe(true);
    setGlobal("window", {
      get top(): never {
        throw domError("SecurityError");
      },
      self: {},
    });
    expect(context().embedded).toBe(true);
  });

  test("allowed leaves out what cannot be told", () => {
    setGlobal("window", undefined);
    setGlobal("matchMedia", undefined);
    setGlobal("document", {});
    expect(context()).toEqual({ embedded: false, standalone: false, allowed: {} });
    setGlobal("document", {
      permissionsPolicy: {
        allowsFeature: (feature: string) => {
          if (feature === "publickey-credentials-create") throw new TypeError("unknown feature");
          return true;
        },
      },
    });
    expect(context().allowed).toEqual({ get: true });
  });
});
