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
ブラウザ                                   検証側
@kawaz/passkey-client                     @kawaz/passkey-server
  navigator.credentials.create/get          verifyRegistration(json, expected)
  → Level 3 toJSON() の形に整形   ─JSON─▶   verifyAuthentication(json, expected, credential)
                                            (WebCrypto だけ)
```

### wire は Level 3 の `toJSON()` (camelCase)

client と server の間で共有する語は WebAuthn Level 3 の `PublicKeyCredential.toJSON()` が返す形 (`RegistrationResponseJSON` / `AuthenticationResponseJSON`、バイナリは base64url 文字列) とする。仕様が定めた形なので、どちらかを別の実装に替えても繋がる。`toJSON()` を持たないブラウザでは client が同じ形を組み立てる。options の側 (`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`) も同様に Level 3 の JSON 形を使い、client が `parseCreationOptionsFromJSON()` 相当を受け持つ。

使う側の API がこれと違う命名 (例: snake_case) を採る場合は、使う側の境界で写す。パッケージの入出力には持ち込まない。

### client (`@kawaz/passkey-client`)

- 登録 / 認証の呼び出しと、結果の Level 3 JSON への整形
- 条件付き UI (`mediation: "conditional"`、autofill) の開始と中断
- passkey が使えるかの判定 (`PublicKeyCredential` の有無、`isUserVerifyingPlatformAuthenticatorAvailable()`、`isConditionalMediationAvailable()`、`getClientCapabilities()`)
- iframe (`publickey-credentials-create` / `-get` の permissions policy) と PWA (standalone 表示) での制約を、呼ぶ前に分かる形で返す

API の具体形は 3 つの webui の使い方から決める (issue `client-api-from-three-webuis`)。

### server (`@kawaz/passkey-server`)

- 依存は WebCrypto (`crypto.subtle`) だけで、Node / Bun / Deno / edge runtime のどれでも動く。CBOR の読み取りは内蔵する
- attestation は `none` だけを受け付ける。`fmt` が `none` 以外、または `attStmt` が空でない登録は拒否する
- 署名アルゴリズムは ES256 (-7) / EdDSA (-8) / RS256 (-257)
- UP と UV の両方を必須にする。緩める option は持たない
- 埋め込みからの登録・認証を拒否する: `clientDataJSON` の `crossOrigin` が `true`、または `topOrigin` がある時は通さない
- origin は完全一致 (scheme / host / port)、rpId は SHA-256 を authenticator data の rpIdHash と照合する
- sign count の巻き戻りを拒否する: 保存済みの値が 0 より大きく、今回の値がそれ以下なら通さない (0 のままの authenticator は数えないものとして扱う)
- 登録時に BE / BS (backup) flag を読んで返す。判断には使わない
- Node 26 / Bun 1.3 / Deno 2.9 で登録・認証を確認済み (`packages/server/test/runtime/smoke.mjs`)。edge runtime は未確認

## 主要な設計判断

- [DR-0001](decisions/DR-0001-client-api.md) — `@kawaz/passkey-client` の公開 API (Proposed)
- [DR-0002](decisions/DR-0002-server-api.md) — `@kawaz/passkey-server` の公開 API (Proposed)

## 関連ドキュメント

- [STRUCTURE.md](./STRUCTURE.md) — 物理構造
- [ROADMAP.md](./ROADMAP.md) — 将来検討
- [decisions/INDEX.md](./decisions/INDEX.md) — DR 一覧
