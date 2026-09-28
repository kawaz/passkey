// Per algorithm, on whichever runtime runs this file (`node`, `bun` or `deno run`): options built by the package, then one registration and one authentication through the built package verified against them. Run `just build` first.
import {
  authenticationOptions,
  challengeOf,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../../dist/index.js";
import { SoftAuthenticator } from "../authenticator.ts";

const origin = "https://ui.example";
const rpId = "ui.example";
const ALG = { ES256: -7, EdDSA: -8, RS256: -257 };

const runtime =
  typeof Deno !== "undefined"
    ? `deno ${Deno.version.deno}`
    : typeof Bun !== "undefined"
      ? `bun ${Bun.version}`
      : `node ${process.versions.node}`;

for (const algorithm of ["ES256", "EdDSA", "RS256"]) {
  const creation = registrationOptions({
    rp: { id: rpId, name: "UI Example" },
    user: { name: "alice@example.com" },
    algorithms: [ALG[algorithm]],
  });
  const authenticator = new SoftAuthenticator(creation.rp.id, { algorithm });
  const registration = await authenticator.create({
    challenge: creation.challenge,
    origin,
    userId: creation.user.id,
  });
  const registered = await verifyRegistration(registration, {
    challenge: challengeOf(registration.response.clientDataJSON),
    origin,
    rpId,
    algorithms: creation.pubKeyCredParams.map((param) => param.alg),
  });
  const request = authenticationOptions({
    rpId,
    allowCredentials: [{ id: registered.id, transports: registered.transports }],
  });
  authenticator.signCount = 1;
  const verified = await verifyAuthentication(
    await authenticator.get({ challenge: request.challenge, origin }),
    { challenge: request.challenge, origin, rpId: request.rpId, userHandle: creation.user.id },
    registered,
  );
  console.log(
    `${runtime} ${algorithm}: options challenge=${creation.challenge.length}ch timeout=${creation.timeout}; registered alg=${registered.algorithm} transports=${registered.transports.join(",")} origin=${registered.origin}; authenticated signCount=${verified.signCount} userHandle=${verified.userHandle === creation.user.id ? "matched" : "MISMATCH"} rpId=${verified.rpId}`,
  );
}
