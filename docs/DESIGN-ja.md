# passkey 設計

> [English](./DESIGN.md) | 日本語

## ドメイン

passkey (WebAuthn の discoverable credential) で人を登録し、認証する。関わるのは 2 者で、ブラウザは authenticator に credential を作らせ (登録)、それで challenge に署名させる (認証)。検証側 (relying party) は、その結果が自分の発行した challenge に対して、自分の origin と rpId で、本人確認 (UV) を経て作られたことを確かめ、公開鍵を記録または照合する。

このリポはその 2 者を別々のパッケージにする。使う側は片方だけを取り込めて、もう片方を別の実装に替えられる。

扱わないもの (他者の責務):

- challenge の発行・保存・消費、credential の保存、session の発行は使う側のアプリが持つ。server パッケージは「期待する challenge / origin / rpId と、保存済みの公開鍵」を受け取って検証するだけで、状態を持たない
- attestation による authenticator の機種の証明 (packed / tpm / apple 等) と、その信頼の根 (FIDO MDS)

## アーキテクチャ

```
ブラウザ                                        検証側
@kawaz/passkey-client                          @kawaz/passkey-server
  register() / authenticate()                    registrationOptions() / authenticationOptions()
  → Level 3 toJSON() の形に整形     ◀─JSON──      verifyRegistration(response, expected)
                                     ─JSON──▶      verifyAuthentication(response, expected, credential)
                                                   (WebCrypto だけ)
```

### wire は Level 3 の `toJSON()` (camelCase)

client と server の間で共有する語は WebAuthn Level 3 の `PublicKeyCredential.toJSON()` が返す形 (`RegistrationResponseJSON` / `AuthenticationResponseJSON`、バイナリは base64url 文字列) とする。仕様が定めた形なので、どちらかを別の実装に替えても繋がる。`toJSON()` を持たないブラウザでは client が同じ形を組み立てる。options の側 (`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`) も同様に Level 3 の JSON 形を使い、client が `parseCreationOptionsFromJSON()` 相当を受け持つ。

使う側の API がこれと違う命名 (例: snake_case) を採る場合は、使う側の境界で写す。パッケージの入出力には持ち込まない。

### client (`@kawaz/passkey-client`)

- `register(options)` / `authenticate(options, controls?)` が登録 / 認証を呼び出し、結果を Level 3 の `RegistrationResponseJSON` / `AuthenticationResponseJSON` (`json`) と生の拡張出力 (`extensions`) に整形する。`clientExtensionResults.prf.results` のような鍵素材は `json` に載せず `extensions` からだけ取れる
- 整形はブラウザの `toJSON()` / `parse*OptionsFromJSON()` を使わず常に client 自身が行う (`toJSON()` は Chrome 129 / Firefox 119 / Safari 18.4 からで、passkey が使える Safari 16〜18.3 / Chrome 108〜128 には無いため)。§10 で JSON 形を定義する `appid` / `appidExclude` / `credProps` / `prf` / `largeBlob` の 5 拡張は入出力とも展開・畳み込みを行う
- 失敗は `PasskeyError` を throw し、`kind` で `declined` (取り消し・passkey 無し・埋め込みの拒否)・`excluded` (`excludeCredentials` に一致)・`aborted` (`AbortSignal` による中断)・`failed` (options か環境の問題) の 4 つに分ける
- 条件付き UI は `authenticate(options, { mediation: "conditional", signal })` で開始し、`signal` の abort で中断する。別関数にはしない
- `capabilities()` が WebAuthn Level 3 `getClientCapabilities()` と同じ語彙 (`conditionalCreate` / `conditionalGet` / `hybridTransport` / `userVerifyingPlatformAuthenticator` 等) で可否を返し、無いブラウザでは個別 API から合成する
- `context()` が呼ぶ前に分かる事実 (`embedded`: `window.top !== window.self`、`standalone`: PWA として開かれているか、`allowed.create` / `allowed.get`: permissions policy の許可) を返す

### server (`@kawaz/passkey-server`)

- `registrationOptions(input)` / `authenticationOptions(input)` が Level 3 の `PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON` を組み立てる。client の `register()` / `authenticate()` にそのまま渡せる。状態を持たないので、返した `challenge` の保存は呼び出し側が行う
- 依存は WebCrypto (`crypto.subtle`) だけで、Node / Bun / Deno / edge runtime のどれでも動く。CBOR の読み取りは内蔵する
- attestation は `none` だけを受け付ける。`fmt` が `none` 以外、または `attStmt` が空でない登録は拒否する
- 署名アルゴリズムは ES256 (-7) / EdDSA (-8) / RS256 (-257)
- UP と UV の両方を必須にする。緩める option は持たない
- 埋め込みからの登録・認証は既定で拒否する。`expected.topOrigins` に親ページの origin を許可リストとして渡した時だけ、その `topOrigin` からの応答を通す。`topOrigin` を送らない `crossOrigin: true` (Safari) は `embeddedWithoutTopOrigin: "allow"` を明示した時だけ通す
- origin と rpId はどちらも複数受け付けられる (`string | string[]`)。origin は完全一致 (scheme / host / port)、rpId は SHA-256 を authenticator data の rpIdHash と照合する
- `verifyRegistration()` は `algorithms` で許可するアルゴリズムを絞り込め、鍵を WebCrypto に import できることまで確認する。`verifyAuthentication()` は `userHandle` を渡すと応答の `userHandle` との一致を要求する
- 登録時に BE / BS (backup) flag を読んで返す。両方 0 でない BE = 0 ∧ BS = 1 の矛盾は拒否する。`StoredCredential.backupEligible` を渡すと登録時との一致も要求する (緩める option は無い)
- sign count の巻き戻りを拒否する: 保存済みの値または今回の値が 0 でなく、今回の値が保存値以下なら通さない (両方 0 のままの authenticator は数えないものとして扱う)
- 入力は読むメンバーだけの構造的部分型 (`RegistrationResponse` / `AuthenticationResponse`)。client の `json` はそのまま渡せる
- 失敗は 1 つの例外クラス `PasskeyVerificationError` と `reason` (段階を示す文字列) で表す
- Node 26 / Bun 1.3 / Deno 2.9 で登録・認証を確認済み (`packages/server/test/runtime/smoke.mjs`)。edge runtime は未確認

## 主要な設計判断

- [DR-0001](decisions/DR-0001-client-api.md) — `@kawaz/passkey-client` の公開 API。実装済 (`packages/client`)
- [DR-0002](decisions/DR-0002-server-api.md) — `@kawaz/passkey-server` の公開 API。実装済 (`packages/server`)

## 関連ドキュメント

- [STRUCTURE.md](./STRUCTURE.md) — 物理構造
- [ROADMAP.md](./ROADMAP.md) — 将来検討
- [decisions/INDEX.md](./decisions/INDEX.md) — DR 一覧
