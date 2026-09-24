// One registration and one authentication through the built package, per algorithm, on whichever runtime runs this file: `node`, `bun` or `deno run`. Run `just build` first.
import { challengeOf, verifyAuthentication, verifyRegistration } from "../../dist/index.js";
import { SoftAuthenticator } from "../authenticator.ts";

const origin = "https://ui.example";
const rpId = "ui.example";
const challenge = "Y2hhbGxlbmdlLXdpdGgtZW50cm9weQ";
const expected = { challenge, origin, rpId };

const runtime =
  typeof Deno !== "undefined"
    ? `deno ${Deno.version.deno}`
    : typeof Bun !== "undefined"
      ? `bun ${Bun.version}`
      : `node ${process.versions.node}`;

for (const algorithm of ["ES256", "EdDSA", "RS256"]) {
  const authenticator = new SoftAuthenticator(rpId, { algorithm });
  const registration = await authenticator.create({ challenge, origin, userId: "dXNlci0x" });
  const registered = await verifyRegistration(registration, {
    ...expected,
    challenge: challengeOf(registration.response.clientDataJSON),
  });
  authenticator.signCount = 1;
  const verified = await verifyAuthentication(
    await authenticator.get({ challenge, origin }),
    expected,
    registered,
  );
  console.log(
    `${runtime} ${algorithm}: registered alg=${registered.algorithm} signCount=${registered.signCount}; authenticated signCount=${verified.signCount} userHandle=${verified.userHandle}`,
  );
}
