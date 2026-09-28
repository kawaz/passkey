# 実ブラウザでの確認

build 後の `packages/client/dist/index.js` を headless Chromium で読み、CDP の仮想 authenticator に対して `register()` / `authenticate()` (通常と条件付き UI) を通し、出力の `json` を `@kawaz/passkey-server` の `verifyRegistration` / `verifyAuthentication` に通す。

## 構成

- `serve.ts`: localhost の relying party。`page.html` と `dist/` を配り、options JSON を返し (`/registration-options` / `/authentication-options`)、ページが送る `json` を server の `verify*` で検証する (origin `http://localhost:8787`、rpId `localhost`)
- `page.html`: `/dist/index.js` を ESM で読み、`window.check` に各手順を置く
- `ceremonies.js`: 仮想 authenticator (ctap2 / internal / hasResidentKey / hasUserVerification / isUserVerified) を付け、`capabilities()` / `context()`、登録、同じ credential を `excludeCredentials` に載せた再登録、通常の認証を行う
- `conditional.js`: 登録の後、`authenticate(options, { mediation: "conditional", signal })` を立てて `<input autocomplete="username webauthn">` をクリックし、選ばれた passkey の `json` を server に通す。続けて条件付き UI をもう 1 つ立てて `signal` を abort する
- `*.output.json`: 上の 2 つの実出力

## 手順

```bash
just build
bun packages/client/test/browser/serve.ts 8787 &
playwright-cli -s=passkey-client-check open http://localhost:8787/
playwright-cli -s=passkey-client-check run-code "$(cat packages/client/test/browser/ceremonies.js)"
# Chrome は internal の仮想 authenticator を 1 環境に 1 つしか持てないので、次の前にブラウザを開き直す
playwright-cli -s=passkey-client-check close
playwright-cli -s=passkey-client-check open http://localhost:8787/
playwright-cli -s=passkey-client-check run-code "$(cat packages/client/test/browser/conditional.js)"
playwright-cli -s=passkey-client-check close
```

## 結果 (HeadlessChrome/153.0.0.0、2026-09-28)

| 手順                               | client の出力                                                                                                                                       | server                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 登録                               | `json` は Level 3 の全メンバー (`publicKey` / `publicKeyAlgorithm` / `transports` / `authenticatorAttachment` / `clientExtensionResults.credProps`) | `verifyRegistration` 受理   |
| 再登録 (`excludeCredentials` 一致) | `PasskeyError` `kind: "excluded"` (`InvalidStateError`)                                                                                             | -                           |
| 通常の認証                         | `json.response.userHandle` = `dXNlci0x`                                                                                                             | `verifyAuthentication` 受理 |
| 条件付き UI                        | input のクリックで仮想 authenticator の passkey が選ばれて解決                                                                                      | `verifyAuthentication` 受理 |
| 条件付き UI の abort               | `PasskeyError` `kind: "aborted"` (`AbortError`)                                                                                                     | -                           |

`capabilities()` は `getClientCapabilities()` の答えがそのまま返る (`conditionalGet: true` ほか)。`context()` は `{ embedded: false, standalone: false, allowed: {} }`: この Chromium には `document.permissionsPolicy` が無いので `allowed` のキーは省かれる。
