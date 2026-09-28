/** A localhost relying party for the browser check: serves `page.html` and the built `dist/`, and verifies what the page sends with `@kawaz/passkey-server`. Run with `bun packages/client/test/browser/serve.ts [port]`. */
import {
  type RegisteredCredential,
  verifyAuthentication,
  verifyRegistration,
} from "../../../server/src/index.js";

const port = Number(process.argv[2] ?? 8787);
const origin = `http://localhost:${port}`;
const rpId = "localhost";
const dist = new URL("../../dist/", import.meta.url);
const page = new URL("./page.html", import.meta.url);

const challenges = new Set<string>();
let registered: RegisteredCredential | undefined;

function challenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  challenges.add(value);
  return value;
}

function take(value: string): string {
  if (!challenges.delete(value)) throw new Error("unknown challenge");
  return value;
}

Bun.serve({
  port,
  hostname: "localhost",
  async fetch(request) {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/") return new Response(Bun.file(page));
      if (path.startsWith("/dist/")) {
        return new Response(Bun.file(new URL(path.slice("/dist/".length), dist)), {
          headers: { "content-type": "text/javascript" },
        });
      }
      if (path === "/registration-options") {
        return Response.json({
          challenge: challenge(),
          rp: { id: rpId, name: "passkey-client browser check" },
          user: { id: "dXNlci0x", name: "alice", displayName: "Alice" },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -8 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          attestation: "none",
          extensions: { credProps: true },
        } satisfies PublicKeyCredentialCreationOptionsJSON);
      }
      if (path === "/authentication-options") {
        return Response.json({
          challenge: challenge(),
          rpId,
          userVerification: "required",
        } satisfies PublicKeyCredentialRequestOptionsJSON);
      }
      if (path === "/verify-registration") {
        const body = (await request.json()) as {
          challenge: string;
          json: RegistrationResponseJSON;
        };
        registered = await verifyRegistration(body.json, {
          challenge: take(body.challenge),
          origin,
          rpId,
        });
        return Response.json({ ok: true, registered });
      }
      if (path === "/verify-authentication") {
        const body = (await request.json()) as {
          challenge: string;
          json: AuthenticationResponseJSON;
        };
        if (registered === undefined) throw new Error("nothing registered yet");
        const verified = await verifyAuthentication(
          body.json,
          { challenge: take(body.challenge), origin, rpId },
          registered,
        );
        return Response.json({ ok: true, verified });
      }
      return new Response("not found", { status: 404 });
    } catch (error) {
      return Response.json({ ok: false, error: String(error) }, { status: 400 });
    }
  },
});

console.log(`listening on ${origin}`);
