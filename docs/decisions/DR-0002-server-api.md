# DR-0002: `@kawaz/passkey-server` の公開 API

- Status: Proposed (kawaz 裁定待ち)
- Date: 2026-09-24

## Context

kawaz/ccmsg の WebAuthn 検証 (`src/auth/webauthn.ts` / `cbor.ts`) を `@kawaz/passkey-server` に移す (issue `extract-server-from-ccmsg`)。移植元の入力は ccmsg 契約の snake_case 型で、SHA-256 / 定数時間比較 / base64url に `node:crypto` と `Buffer` を使っている ([research](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) 表 3)。DESIGN の server 節は「依存は WebCrypto だけ」「入力は Level 3 の `toJSON()` 形」なので、移植に合わせて入出力の形と依存を決める。

既に決まっていて覆さないこと:

- 検査項目は [DESIGN-ja.md](../DESIGN-ja.md) の server 節 (attestation `none` 固定、UP + UV 必須、埋め込み拒否、origin 完全一致、rpIdHash、sign count 巻き戻り拒否、BE / BS を返す)
- 認証で `crossOrigin` / `topOrigin` を拒否するかは `docs/QUESTIONS.md` PK-Q1 で裁定待ち。この DR は現行 (登録・認証とも拒否、option なし) のまま実装し、PK-Q1 の結論で変える
- challenge の発行・保存・消費、credential の保存と引き当て、userHandle と利用者の照合は呼び出し側の責務

### 目的

- 利用者が「期待する challenge / origin / rpId」と「保存済みの公開鍵と sign count」を渡すだけで、登録と認証を検証できる
- どの JS runtime でも同じコードが動く (Node / Bun / Deno / edge)
- 呼び出し側が失敗の段階をログで区別できる (応答で区別するかは呼び出し側が決める)

増やしたくないもの: 検査を緩める option と、パッケージが持つ状態。

## Decision

```ts
export function verifyRegistration(response: RegistrationResponseJSON, expected: PasskeyExpectation): Promise<RegisteredCredential>;
export function verifyAuthentication(response: AuthenticationResponseJSON, expected: PasskeyExpectation, credential: StoredCredential): Promise<VerifiedAuthentication>;
export function challengeOf(clientDataJSON: string): string;
export class PasskeyVerificationError extends Error { readonly reason: PasskeyVerificationReason }

interface PasskeyExpectation { challenge: string; origin: string; rpId: string }
interface RegisteredCredential { id: string; publicKey: string; algorithm: -7 | -8 | -257; signCount: number; backupEligible: boolean; backupState: boolean }
interface StoredCredential { publicKey: string; signCount: number }
interface VerifiedAuthentication { signCount: number; backupEligible: boolean; backupState: boolean; userHandle?: string }
```

### 1. 入力は lib.dom の Level 3 型をそのまま使う

`RegistrationResponseJSON` / `AuthenticationResponseJSON` を再定義しない。読むのは `rawId`、`response.clientDataJSON`、`response.attestationObject` (登録) / `response.authenticatorData` と `response.signature` と `response.userHandle` (認証) だけ。登録の `response.authenticatorData` / `publicKey` / `publicKeyAlgorithm` はブラウザが attestation object から派生させた写しなので信用せず、attestation object から読む。`type` / `id` / `clientExtensionResults` / `authenticatorAttachment` / `transports` は検証に使わない。

### 2. `publicKey` は COSE 鍵のバイト列そのままを base64url で返す

authenticator が符号化した COSE 鍵を 1 バイトも変えずに base64url 文字列で返し、認証ではそれをそのまま受け取る。ccmsg が今保存している表現と同じで、ccmsg の保存データは移行不要。JWK や SPKI に変換しない理由は、変換すると元のバイト列に戻せず、アルゴリズム識別子 (`alg`) を別に持つ必要が出るため。`algorithm` は保存の便宜と表示のために返すが、認証は COSE 鍵の中の `alg` で判断する。

### 3. `verifyRegistration` は鍵の import まで行う

登録が通った鍵は WebCrypto で import できることを保証する。import できない鍵を記録すると、初回の認証まで使えないことが分からない。import した `CryptoKey` は捨てる (パッケージは状態を持たない)。そのため `verifyRegistration` は `Promise` を返す。

### 4. `challengeOf` を公開する

ccmsg は検証の前に `clientDataJSON` から challenge を読み、それを発行した instance に消費を頼む (research 表 3)。この取り出しを呼び出し側に再実装させないため公開する。検証はしない (値を取り出すだけ) ので、結果を信用してよいのは続く `verify*` が通った後。

### 5. 失敗は 1 つの例外クラスと `reason`

入力に起因する失敗はすべて `PasskeyVerificationError` で、`reason` は次のどれか。`message` はログ用の説明で、分岐には使わない。

| reason | 段階 |
|---|---|
| `encoding` | base64url でない値 |
| `client-data` | `clientDataJSON` が JSON object でない、または challenge が無い (`challengeOf`) |
| `type` | `type` が `webauthn.create` / `webauthn.get` でない |
| `challenge` | challenge 不一致 |
| `origin` | origin 不一致 (完全一致) |
| `embedded` | `crossOrigin: true` または `topOrigin` あり |
| `authenticator-data` | authenticator data が短い、または終端を越える |
| `rp-id` | rpIdHash 不一致 |
| `user-present` / `user-verified` | UP / UV が立っていない |
| `attestation` | attestation object が読めない、authData が無い |
| `attestation-format` | `fmt` が `none` でない、`attStmt` が空でない |
| `credential` | credential が無い、id が空 |
| `credential-id` | `rawId` と attested credential id が不一致 |
| `public-key` | 未対応アルゴリズム、鍵の成分の欠け、import 失敗 |
| `sign-count` | 保存値 > 0 かつ今回値 <= 保存値 |
| `signature` | 署名が検証できない |

### 6. 依存は WebCrypto だけ

SHA-256 は `crypto.subtle.digest`、定数時間比較は全バイトの XOR を畳み込む自前実装、base64url は `Uint8Array` ベースの自前実装。runtime 依存パッケージは無い。`node:crypto` を使わない理由は、Deno / edge runtime (Cloudflare Workers 等) で `node:` 互換層の有無や挙動に左右されず、DESIGN の「どの runtime でも動く」を import 1 つで満たすため。

### 7. rpId は 1 つ

ccmsg の `verifyAssertion` は `rpIds` を配列で受けたが、呼び出しは常に 1 要素だった (research 表 3)。複数 rpId を受ける要件の利用者はいないので単数にした。

### runtime 対応の実測

`packages/server/test/runtime/smoke.mjs` (build 後の `dist/index.js` を import し、ES256 / EdDSA / RS256 それぞれで登録 + 認証を 1 回通す) の実行結果 (2026-09-24):

| runtime | 結果 |
|---|---|
| Node 26.9.0 | 3 アルゴリズムとも通過 |
| Bun 1.3.13 | 3 アルゴリズムとも通過 |
| Deno 2.9.4 | 3 アルゴリズムとも通過 |
| edge runtime (Cloudflare Workers 等) | 未確認 |

## Alternatives Considered

- 案 A: ccmsg の snake_case 型を入力にする
  - 不採用理由: DESIGN の wire は Level 3 の `toJSON()`。snake_case は利用者の境界で写す
- 案 B: `publicKey` を JWK / SPKI で返す
  - 不採用理由: ccmsg の保存データの移行が要る。COSE の `alg` を別に持つ必要が出る
- 案 C: `checkPublicKey` を別関数で公開する (ccmsg の現状)
  - 不採用理由: 呼び忘れると import できない鍵を記録できる。登録の検証に含めれば呼び忘れが起きない
- 案 D: `rpIds` を配列のまま残す
  - 不採用理由: 使う利用者がいない。必要になったら型を広げる (単数 → 配列は後から足せる)

## Consequences

- ccmsg は境界で snake_case → camelCase を写す必要がある (`client_data_json` → `response.clientDataJSON` 等)
- base64url の読み取りは `Buffer` より厳格になった (アルファベット外の文字と、どの符号化でも出ない長さを拒否する。末尾 `=` は許す)
- `clientDataJSON` が JSON object でない場合 (`null` や数値) は `client-data` で拒否する (ccmsg では `null` で `TypeError` が漏れていた)
- 鍵の読み取り・import の失敗と、WebCrypto が受け付けない署名 (長さ違い等) も `PasskeyVerificationError` にまとめた (呼び出し側が `DOMException` を扱わなくてよい)
- PK-Q1 の結論次第で認証の `embedded` 判定に option が入る

### 未決 (kawaz 裁定)

1. 入力型を lib.dom の `RegistrationResponseJSON` / `AuthenticationResponseJSON` そのものにするか、読むメンバーだけの構造的部分型 (登録: `{ rawId; response: { clientDataJSON; attestationObject } }`、認証: `{ rawId; response: { clientDataJSON; authenticatorData; signature; userHandle? } }`) にするか。Level 3 の型は部分型に代入できるので client の `json` はそのまま渡せる一方、ccmsg のように自前契約から写す利用者は lib.dom 型だと読まれないメンバー (`authenticatorData` / `publicKeyAlgorithm` / `transports`) をダミーで埋める必要が出る。推奨は部分型 (Decision 1 の「読むのはこれだけ」を型で表し、利用者にダミーを強いない)

## 関連

- [DESIGN-ja.md](../DESIGN-ja.md) server 節
- [research/2026-09-24-passkey-usage-in-kawaz-repos.md](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) 表 3
- [DR-0001](DR-0001-client-api.md) (client が出す `json` の形)
- `docs/QUESTIONS.md` PK-Q1
