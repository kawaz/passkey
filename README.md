# passkey

> English | [日本語](./README-ja.md)

Passkey (WebAuthn) libraries for TypeScript: the browser side and the verifying side, shipped as two packages from one repository.

**This is a skeleton for now; there is no API yet.** The contents will come from the WebAuthn code in [kawaz/ccmsg](https://github.com/kawaz/ccmsg) (see [ROADMAP.md](./docs/ROADMAP.md) and [docs/issue/](./docs/issue/INDEX.md) for the plan).

## Packages

| Package                                       | Role                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`@kawaz/passkey-client`](./packages/client/) | Browser side. Calls `navigator.credentials` and returns the result in the WebAuthn Level 3 `toJSON()` form. Covers conditional UI (autofill), telling whether passkeys are usable, and the constraints inside iframes and PWAs |
| [`@kawaz/passkey-server`](./packages/server/) | Verifying side. Verifies registrations and assertions with WebCrypto alone. Attestation is `none`; signature algorithms are ES256 / EdDSA / RS256                                                                              |

The data passed between the two is the Level 3 `toJSON()` form (camelCase JSON), and neither package depends on the other's implementation.

## Install

```sh
bun add @kawaz/passkey-client   # browser side
bun add @kawaz/passkey-server   # server side
```

## Documentation

- [DESIGN.md](./docs/DESIGN.md) — Design (package boundary, wire form, verification policy)
- [STRUCTURE.md](./docs/STRUCTURE.md) — Repository physical structure
- [ROADMAP.md](./docs/ROADMAP.md) — Future considerations

## License

MIT License, Yoshiaki Kawazu (@kawaz)
