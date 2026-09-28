/** Every `ClientCapability` of §5.8.7. */
const CLIENT_CAPABILITIES = [
  "conditionalCreate",
  "conditionalGet",
  "hybridTransport",
  "passkeyPlatformAuthenticator",
  "userVerifyingPlatformAuthenticator",
  "relatedOrigins",
  "signalAllAcceptedCredentials",
  "signalCurrentUserDetails",
  "signalUnknownCredential",
] as const;

/** What this browser can do, in the vocabulary of `getClientCapabilities()` (§5.1.7): `true` can, `false` cannot, a missing key is unknown.
 *
 * A browser without `getClientCapabilities()` answers `conditionalGet` from `isConditionalMediationAvailable()` and `userVerifyingPlatformAuthenticator` from `isUserVerifyingPlatformAuthenticatorAvailable()`, `false` where the method itself is missing, and nothing else. A browser without `PublicKeyCredential` answers `false` to every `ClientCapability`. */
export async function capabilities(): Promise<PublicKeyCredentialClientCapabilities> {
  if (typeof PublicKeyCredential === "undefined") {
    return Object.fromEntries(CLIENT_CAPABILITIES.map((key) => [key, false]));
  }
  const held = PublicKeyCredential as Partial<typeof PublicKeyCredential>;
  if (typeof held.getClientCapabilities === "function") {
    return await held.getClientCapabilities();
  }
  return {
    conditionalGet:
      typeof held.isConditionalMediationAvailable === "function"
        ? await held.isConditionalMediationAvailable()
        : false,
    userVerifyingPlatformAuthenticator:
      typeof held.isUserVerifyingPlatformAuthenticatorAvailable === "function"
        ? await held.isUserVerifyingPlatformAuthenticatorAvailable()
        : false,
  };
}

export interface PasskeyContext {
  /** `window.top !== window.self`: the page runs inside a frame. `true` as well when the comparison itself is refused. */
  embedded: boolean;
  /** `matchMedia("(display-mode: standalone)")` matches: the page was opened as an installed PWA. */
  standalone: boolean;
  /** Whether the permissions policy allows `publickey-credentials-create` / `-get`. A key is missing (unknown) where the browser has no `document.permissionsPolicy`. */
  allowed: { create?: boolean; get?: boolean };
}

/** The Permissions Policy API (`document.permissionsPolicy`), which lib.dom does not declare. */
interface PermissionsPolicy {
  allowsFeature(feature: string): boolean;
}

/** Facts about where the page runs, known before any ceremony is attempted. */
export function context(): PasskeyContext {
  return { embedded: embedded(), standalone: standalone(), allowed: allowed() };
}

function embedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

function standalone(): boolean {
  if (typeof matchMedia !== "function") return false;
  return matchMedia("(display-mode: standalone)").matches;
}

function allowed(): PasskeyContext["allowed"] {
  if (typeof document === "undefined") return {};
  const policy = (document as { permissionsPolicy?: PermissionsPolicy }).permissionsPolicy;
  if (policy === undefined || policy === null) return {};
  const out: PasskeyContext["allowed"] = {};
  const create = allows(policy, "publickey-credentials-create");
  if (create !== undefined) out.create = create;
  const get = allows(policy, "publickey-credentials-get");
  if (get !== undefined) out.get = get;
  return out;
}

function allows(policy: PermissionsPolicy, feature: string): boolean | undefined {
  try {
    return policy.allowsFeature(feature);
  } catch {
    return undefined;
  }
}
