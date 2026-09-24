# DR-0002: `@kawaz/passkey-server` の公開 API

- Status: Proposed (kawaz 裁定待ち)
- Date: 2026-09-24

## Context

`@kawaz/passkey-server` は relying party の検証側。入力は Level 3 の `toJSON()` 形、依存は WebCrypto だけ、状態を持たない ([DESIGN-ja.md](../DESIGN-ja.md) の server 節)。この DR は options の生成と検証の入出力の形、検査項目、失敗の形を決める。

方針: 手軽に使えてかつ十分なクオリティの passkey ライブラリにする。IF はできるだけシンプルに保ちつつ、便利機能や需要のある必要機能は妥協しない。採否は次の 4 基準で決め、各 Decision に「基準 n」で根拠を書く。

1. WebAuthn Level 3 (W3C Recommendation) §7.1 (登録) / §7.2 (認証) が RP に求める検証項目は全部持つ。RP の方針に委ねられている項目 (origin / topOrigin の期待、BE / BS の扱い、sign count の巻き戻り時の挙動) は既定を最も安全な側に置き、緩める方向は option にする
2. SimpleWebAuthn (`@simplewebauthn/server` 14) と webauthn-rs (`webauthn-rs-core` 0.6.1-dev) の両方が公開している機能は「需要あり」として持つ。片方だけのものは候補として列挙し採否を書く
3. DESIGN の譲らない点は維持: attestation は `none` 固定、UP + UV 必須 (緩める option 無し)、依存は WebCrypto のみ、状態を持たない、wire は Level 3 の `toJSON()` 形
4. IF はシンプルに: 関数の数と引数の形を増やさず option で吸収できるなら option、既定値は最も安全な側

判断の材料は [research/2026-09-24-passkey-usage-in-kawaz-repos.md](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) 表 3 (利用者の実コードが要求する形) と、上の 2 つの参照実装の公開 API。

既に決まっていて覆さないこと:

- 認証で `topOrigin` の無い `crossOrigin: true` をどう扱うかは `docs/QUESTIONS.md` PK-Q1 で裁定待ち。この DR は「既定は拒否、許可リストで通す」の形を決め、PK-Q1 の結論で option の既定を確定する
- challenge の発行・保存・消費、credential の保存と引き当て、userHandle から利用者を引くこと、credential id が未登録であることの確認 (§7.1 step 25) は呼び出し側の責務。パッケージは状態を持たないので、保存を要する検査は「期待値を渡せる option」の形で持つ

### 目的

- 利用者が「期待する challenge / origin / rpId」と「保存済みの公開鍵と sign count」を渡すだけで、登録と認証を検証できる
- 利用者が rp と user を渡すだけで、client (DR-0001) にそのまま渡せる options JSON を得られる
- どの JS runtime でも同じコードが動く (Node / Bun / Deno / edge)
- 呼び出し側が失敗の段階をログで区別できる (応答で区別するかは呼び出し側が決める)

増やしたくないもの: 検査を緩める option (UP / UV / attestation / origin 完全一致には緩める口を作らない)、パッケージが持つ状態 (challenge の保存、`CryptoKey` のキャッシュ)。

## Decision

```ts
export function registrationOptions(input: RegistrationOptionsInput): PublicKeyCredentialCreationOptionsJSON;
export function authenticationOptions(input: AuthenticationOptionsInput): PublicKeyCredentialRequestOptionsJSON;
export function verifyRegistration(response: RegistrationResponse, expected: RegistrationExpectation): Promise<RegisteredCredential>;
export function verifyAuthentication(response: AuthenticationResponse, expected: AuthenticationExpectation, credential: StoredCredential): Promise<VerifiedAuthentication>;
export function challengeOf(clientDataJSON: string): string;
export class PasskeyVerificationError extends Error { readonly reason: PasskeyVerificationReason }

type PasskeyAlgorithm = -7 | -8 | -257;

interface RegistrationOptionsInput {
  rp: { id: string; name: string };
  /** `id` は base64url (1〜64 バイト)。省略すると 32 バイトの乱数 */
  user: { id?: string; name: string; displayName?: string };
  /** base64url。省略すると 32 バイトの乱数。16 バイト未満は RangeError */
  challenge?: string;
  excludeCredentials?: { id: string; transports?: string[] }[];
  /** `pubKeyCredParams` に並べる順。既定は `[-7, -8, -257]` */
  algorithms?: PasskeyAlgorithm[];
  /** 既定は `"required"` */
  residentKey?: "required" | "preferred";
  authenticatorAttachment?: "platform" | "cross-platform";
  hints?: ("security-key" | "client-device" | "hybrid")[];
  /** ミリ秒。既定は 60000 */
  timeout?: number;
  extensions?: AuthenticationExtensionsClientInputsJSON;
}

interface AuthenticationOptionsInput {
  rpId: string;
  challenge?: string;
  allowCredentials?: { id: string; transports?: string[] }[];
  hints?: ("security-key" | "client-device" | "hybrid")[];
  timeout?: number;
  extensions?: AuthenticationExtensionsClientInputsJSON;
}

/** 読むメンバーだけの構造的部分型 (PK-Q3)。lib.dom の `RegistrationResponseJSON` / `AuthenticationResponseJSON` はそのまま代入できる */
type RegistrationResponse = { rawId: string; response: { clientDataJSON: string; attestationObject: string; transports?: string[] } };
type AuthenticationResponse = { rawId: string; response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string } };

interface PasskeyExpectation {
  challenge: string;
  /** 完全一致 (scheme / host / port)。配列ならどれか 1 つに一致 */
  origin: string | string[];
  /** SHA-256 を rpIdHash と照合。配列ならどれか 1 つに一致 */
  rpId: string | string[];
  /** 埋め込み (cross-origin iframe) から来た応答を通す親ページの origin の許可リスト。省略時は `crossOrigin: true` と `topOrigin` の存在をどちらも拒否 */
  topOrigins?: string[];
  /** `topOrigins` があるのに `topOrigin` を持たない `crossOrigin: true` (Safari の挙動) の扱い。既定は `"reject"` (PK-Q1) */
  embeddedWithoutTopOrigin?: "reject" | "allow";
}
interface RegistrationExpectation extends PasskeyExpectation {
  /** options の `pubKeyCredParams` に載せたもの。省略時は対応する 3 つ全部 */
  algorithms?: PasskeyAlgorithm[];
}
interface AuthenticationExpectation extends PasskeyExpectation {
  /** 認証前に利用者を特定している時の、その利用者の user handle (base64url)。応答に `userHandle` があれば一致を要求 */
  userHandle?: string;
}

interface RegisteredCredential {
  id: string;
  /** COSE 鍵そのままの base64url */
  publicKey: string;
  algorithm: PasskeyAlgorithm;
  signCount: number;
  /** `response.transports` の写し。無ければ `[]` */
  transports: string[];
  backupEligible: boolean;
  backupState: boolean;
  /** 一致した期待値 (配列で渡した時にどれだったか) */
  origin: string;
  rpId: string;
}
interface StoredCredential {
  publicKey: string;
  signCount: number;
  /** 登録時の BE。渡すと今回の BE との一致を要求 (§7.2 step 20) */
  backupEligible?: boolean;
}
interface VerifiedAuthentication {
  signCount: number;
  backupEligible: boolean;
  backupState: boolean;
  userHandle?: string;
  origin: string;
  rpId: string;
}
```

### 1. options の生成を持つ (`registrationOptions` / `authenticationOptions`)

参照実装は両方が持つ (基準 2: SimpleWebAuthn `generateRegistrationOptions` / `generateAuthenticationOptions`、webauthn-rs `generate_challenge_register` / `generate_challenge_authenticate` とそれを包む `start_passkey_registration` / `start_passkey_authentication`)。戻り値は Level 3 の `PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON` (基準 3 の wire) で、client の `register()` / `authenticate()` にそのまま渡せる。同期関数 (乱数は `crypto.getRandomValues`、待つものが無い)。

状態を持たない (基準 3): 生成した challenge を覚えず、返した JSON の `challenge` を呼び出し側が保存して `expected.challenge` に渡す。webauthn-rs の `RegistrationState` / `AuthenticationState` (challenge と policy を持ち回る) の形は採らない。

固定する値 (基準 3、入力に無い): `attestation: "none"`、`authenticatorSelection.userVerification: "required"` と認証の `userVerification: "required"`、`pubKeyCredParams` の `type: "public-key"`。入力で変えられる値は Decision の型のとおりで、既定は最も安全な側 (基準 4):

- `residentKey` の既定は `"required"` (passkey = discoverable credential が DESIGN のドメイン。仕様 §5.4.4 の既定は `"discouraged"` で、それは passkey でない)。`"required"` の時は L1 互換の `requireResidentKey: true` も立てる。`"discouraged"` は受けない
- `algorithms` の既定は `[-7, -8, -257]` (ES256 / EdDSA / RS256、server が検証できる 3 つ)。並び順が優先順なので、入力の順をそのまま `pubKeyCredParams` に写す
- `challenge` は省略時 32 バイトの乱数 (仕様 §13.4.3 "Challenges SHOULD therefore be at least 16 bytes long." を満たし、参照実装も両方 32 バイト)。渡された値が 16 バイト未満なら `RangeError`
- `user.id` は省略時 32 バイトの乱数、渡された値は 1〜64 バイト (仕様 §5.4.3) でなければ `RangeError`。`displayName` の既定は `""` (仕様が required なので省略できない。SimpleWebAuthn も同じ既定)
- `timeout` の既定は 60000 ミリ秒 (参照実装の既定に揃える)
- `hints` はそのまま写す (仕様 §5.8.8。SimpleWebAuthn は `preferredAuthenticatorType` から `hints` と `authenticatorAttachment` を導くが、対応表を持たず仕様の語彙で受ける)
- `excludeCredentials` / `allowCredentials` は `type: "public-key"` を足して写す。認証で `allowCredentials` を省いた時は JSON にも載せない (空配列は「どれでも」でなく「無し」と読むブラウザがある。SimpleWebAuthn も `length !== 0` の時だけ載せる)

### 2. 入力は Level 3 の形、読むメンバーだけの構造的部分型

読むのは `rawId`、`response.clientDataJSON`、`response.attestationObject` と `response.transports` (登録) / `response.authenticatorData` と `response.signature` と `response.userHandle` (認証) だけ。登録の `response.authenticatorData` / `publicKey` / `publicKeyAlgorithm` はブラウザが attestation object から派生させた写しなので信用せず、attestation object から読む。`type` / `id` / `clientExtensionResults` / `authenticatorAttachment` は検証に使わない。

入力型は読むメンバーだけの構造的部分型にする (PK-Q3 の推奨のまま)。lib.dom の `RegistrationResponseJSON` / `AuthenticationResponseJSON` は部分型に代入できるので client の `json` はそのまま渡せる一方、自前契約から写す利用者に読まれないメンバーのダミーを強いない (基準 4)。

SimpleWebAuthn は `id === rawId` と `type === "public-key"` を検査するが (片方のみ → 候補)、採らない: `id` と `type` はブラウザが `rawId` から作る写しで、検証に寄与しない。読まないメンバーを型に入れない方針と衝突する。

### 3. `publicKey` は COSE 鍵のバイト列そのままを base64url で返す

authenticator が符号化した COSE 鍵を 1 バイトも変えずに base64url 文字列で返し、認証ではそれをそのまま受け取る。JWK や SPKI に変換しない理由は、変換すると元のバイト列に戻せず、アルゴリズム識別子 (`alg`) を別に持つ必要が出るため。`algorithm` は保存の便宜と表示のために返すが、認証は COSE 鍵の中の `alg` で判断する。参照実装も両方 COSE のまま返す (SimpleWebAuthn `credential.publicKey: Uint8Array`、webauthn-rs `Credential.cred: COSEKey`)。

### 4. `verifyRegistration` は鍵の import まで行う

登録が通った鍵は WebCrypto で import できることを保証する。import できない鍵を記録すると、初回の認証まで使えないことが分からない。import した `CryptoKey` は捨てる (基準 3、状態を持たない)。

### 5. 検査項目 (§7.1 / §7.2 の全項目と RP 方針の既定)

仕様 §7.1 / §7.2 の RP 手順を上から順に当てる (基準 1)。各項目の採否と、参照実装との対応:

| 項目 (§) | 採否 | 根拠と挙動 |
|---|---|---|
| `type` が `webauthn.create` / `webauthn.get` (§7.1 step 7 / §7.2 step 11) | 採用 | 固定。SimpleWebAuthn の `expectedType` (別の type を通す option) は採らない: 仕様に他の値が無い |
| challenge 一致 (§7.1 step 8 / §7.2 step 12) | 採用 | 定数時間比較。SimpleWebAuthn の「関数で判定する `expectedChallenge`」は採らない: `challengeOf` で値を取り出して発行元に照会できる (Decision 6) |
| origin (§7.1 step 9 / §7.2 step 13、§13.4.9) | 採用、複数受け | 完全一致 (scheme / host / port)。`string \| string[]`。両参照実装が複数を受ける (SimpleWebAuthn `expectedOrigin: string \| string[]`、webauthn-rs `allowed_origins`)。§13.4.9 の「RP ID の任意サブドメインを通す」構造的一致 (webauthn-rs `allow_subdomains` / `allow_any_port`) は採らない: §13.4.8 が挙げる悪意あるサブドメインの危険があり、緩める option になる。一致した値を結果の `origin` で返す |
| `crossOrigin` / `topOrigin` (§7.1 step 10-11 / §7.2 step 14-15、§13.4.9) | 採用、許可リスト | 仕様は "verify that the Relying Party expects that this credential would have been created within an iframe that is not same-origin with its ancestors" と "Verify that the value of C.topOrigin matches the origin of a page that the Relying Party expects to be sub-framed within" の 2 段で RP の方針に委ねる。既定 (option 無し) は `crossOrigin: true` と `topOrigin` の存在をどちらも拒否 (基準 4、`crossOrigin: false` は Chromium が毎回書くので存在で判定しない)。`topOrigins: string[]` を渡すと `topOrigin` がその 1 つに完全一致する応答を通す。`topOrigins` があるのに `topOrigin` を持たない `crossOrigin: true` (Safari は `topOrigin` を送らない。SimpleWebAuthn のコード注記 "Since Safari doesn't support `topOrigin` as of May 2026, only check this when `topOrigin` is available") は `embeddedWithoutTopOrigin` で決め、既定 `"reject"`。SimpleWebAuthn は認証で `expectedTopOrigin` (許可リスト) を持ち、`topOrigin` の無い `crossOrigin: true` は通す (`"allow"` 相当)。webauthn-rs は登録だけ `crossOrigin` を拒否し (`allow_cross_origin`、既定 false)、`topOrigin` を読まない。登録と認証で同じ形の option を持つ (基準 4): 登録を top-level に限りたい利用者は登録の `expected` に `topOrigins` を渡さなければよい |
| rpIdHash (§7.1 step 13 / §7.2 step 16) | 採用、複数受け | `string \| string[]`。SimpleWebAuthn は `expectedRPID: string \| string[]`、webauthn-rs は 1 つ (`rp_id`) → 候補。採る理由は `origin` を配列で受けるなら、複数の registrable domain を持つ RP が rpId も複数持つ場面が同じ利用者に出ること。型の形は `origin` と揃う。一致した値を結果の `rpId` で返す |
| UP (§7.1 step 14 / §7.2 step 17) | 採用、固定 | 緩める option 無し (基準 3)。SimpleWebAuthn の `requireUserPresence: false` (条件付き登録用) は採らない |
| UV (§7.1 step 15 / §7.2 step 18-19) | 採用、固定 | 緩める option 無し (基準 3)。SimpleWebAuthn の `requireUserVerification` / `advancedFIDOConfig`、webauthn-rs の `UserVerificationPolicy::Preferred` は採らない |
| BE が 0 なら BS も 0 (§7.1 step 16 / §7.2 step 20) | 採用 | 両 ceremony で検査し、矛盾は `backup-state` で拒否。両参照実装が拒否する (SimpleWebAuthn `InvalidBackupFlags`、webauthn-rs `CredentialMayNotBeHardwareBound`) |
| BE / BS を返す (§7.1 step 17-18) | 採用 | 仕様の語 `backupEligible` / `backupState` で返す。SimpleWebAuthn の `credentialDeviceType: "singleDevice" \| "multiDevice"` / `credentialBackedUp` は同じ 2 bit の別名なので採らない (利用者に対応表を強いる) |
| 認証で登録時の BE と比較 (§7.2 step 20) | 採用、option | 仕様は "If credentialRecord.backupEligible is set, verify that currentBe is set. If credentialRecord.backupEligible is not set, verify that currentBe is not set." を「RP が backup state を方針に使うなら」の条件付きで書く。`StoredCredential.backupEligible` を渡した時だけ比較し、不一致は `backup-eligibility` で拒否。webauthn-rs は既定で不一致を拒否し `allow_backup_eligible_upgrade` で false → true だけ通す。SimpleWebAuthn は比較しない。仕様どおり両方向を拒否し、昇格を通す option は未決 2 |
| `alg` が `pubKeyCredParams` にある (§7.1 step 19) | 採用、option | `RegistrationExpectation.algorithms` に options で載せたものを渡す。省略時は server が検証できる 3 つ全部。外れは `algorithm` で拒否。両参照実装が持つ (SimpleWebAuthn `supportedAlgorithmIDs`、webauthn-rs `credential_algorithms`) |
| attestation `fmt` / `attStmt` (§7.1 step 20-24) | 採用、固定 | `fmt` が `none` かつ `attStmt` が空でなければ `attestation-format` で拒否 (基準 3)。参照実装が持つ packed / tpm / apple / android-key 等の検証と MDS は採らない (DESIGN の扱わないもの) |
| credential id ≤ 1023 バイト (§7.1 step 25) | 採用 | 超えたら `credential` で拒否。空も `credential` |
| credential id が未登録 (§7.1 step 26) | 呼び出し側 | 保存を要する。webauthn-rs の「`excludeCredentials` に載せた id と一致したら拒否」(OUT OF SPEC と注記) も採らない: 呼び出し側が保存を引くときに同じことが分かる |
| `rawId` と attested credential id の一致 | 採用 | 仕様の手順には無いが、`rawId` で引く記録と署名された id が同じ credential を指すことの確認。webauthn-rs も両者を比較する |
| `transports` を返す (§7.1 step 27 の credential record) | 採用 | `response.transports` の写しを `RegisteredCredential.transports` で返す (無ければ `[]`)。検証には使わず、`allowCredentials` に載せるため。両参照実装が返す。文字列の配列であることだけ確かめる |
| `allowCredentials` との照合 (§7.2 step 5) | 呼び出し側 | `rawId` で保存済み credential を引いて `StoredCredential` を渡す時点で成立する。SimpleWebAuthn も検証関数では見ない。webauthn-rs は state に持つ credential 一覧から引く (状態を持つ形) |
| userHandle (§7.2 step 6) | 採用、option | 仕様: "If the user was identified before the authentication ceremony was initiated, e.g., via a username or cookie, verify that the identified user account contains a credential record whose id equals credential.rawId. Let credentialRecord be that credential record. If response.userHandle is present, verify that it equals the user handle of the user account." `AuthenticationExpectation.userHandle` を渡すと、応答に `userHandle` がある時に一致を要求し、不一致は `user-handle` で拒否。利用者を特定していない経路 (discoverable) では、応答の `userHandle` を結果で返し、それで利用者を引くのは呼び出し側。両参照実装とも照合は呼び出し側に置く (候補) が、期待値を渡す option 1 つで仕様の手順を閉じられるので採る |
| 署名 (§7.2 step 21-22) | 採用 | ES256 / EdDSA / RS256。外れは `signature` |
| sign count (§7.2 step 23) | 採用、固定 | 仕様の形 "If authData.signCount is nonzero or credentialRecord.signCount is nonzero" で `signCount !== 0 \|\| stored !== 0` の時に `signCount <= stored` を `sign-count` で拒否。両参照実装が同じ規則 (`counter > 0 \|\| stored > 0`)。「保存値 > 0 の時だけ」の規則と結果は同じ (保存値が 0 で今回が非 0 なら必ず今回 > 保存値) だが、仕様と参照実装の書き方に揃える。仕様は巻き戻り時の扱いを RP-specific とするので既定は拒否で、通す option は持たない (基準 4) |
| 拡張出力の処理 (§7.1 step 28 / §7.2 step 24) | 呼び出し側 | `clientExtensionResults` は読まない。authenticator data の extensions (ED flag) は CBOR として読み飛ばし、返さない: Level 3 §10.2 (Authenticator Extensions) は "This section is currently empty." で RP の処理手順を持つ拡張が無く、両参照実装も `unknown` で返すだけ |
| 記録の更新 (§7.2 step 25) | 呼び出し側 | 返した `signCount` / `backupState` を保存するのは呼び出し側 |

### 6. `challengeOf` を公開する

検証の前に `clientDataJSON` から challenge を読み、それを発行した instance に消費を頼む構成 (research 表 3) のための取り出し。検証はしない (値を取り出すだけ) ので、結果を信用してよいのは続く `verify*` が通った後。SimpleWebAuthn の `expectedChallenge` に関数を渡す形 (片方のみ → 候補) と同じ用途で、こちらは検証関数の引数を増やさない (基準 4)。

### 7. 失敗は 1 つの例外クラスと `reason`

入力に起因する失敗はすべて `PasskeyVerificationError` で、`reason` は次のどれか。`message` はログ用の説明で、分岐には使わない。

| reason | 段階 |
|---|---|
| `encoding` | base64url でない値 |
| `client-data` | `clientDataJSON` が JSON object でない、または challenge が無い (`challengeOf`) |
| `type` | `type` が `webauthn.create` / `webauthn.get` でない |
| `challenge` | challenge 不一致 |
| `origin` | origin が期待のどれとも一致しない |
| `embedded` | `crossOrigin: true` または `topOrigin` があり、`topOrigins` で許されていない |
| `authenticator-data` | authenticator data が短い、または終端を越える |
| `rp-id` | rpIdHash が期待のどれとも一致しない |
| `user-present` / `user-verified` | UP / UV が立っていない |
| `backup-state` | BE が 0 なのに BS が 1 |
| `backup-eligibility` | 登録時の BE と今回の BE が違う (`StoredCredential.backupEligible` を渡した時) |
| `attestation` | attestation object が読めない、authData が無い |
| `attestation-format` | `fmt` が `none` でない、`attStmt` が空でない |
| `credential` | credential が無い、id が空、または 1023 バイトを超える |
| `credential-id` | `rawId` と attested credential id が不一致 |
| `algorithm` | 鍵の `alg` が `expected.algorithms` に無い |
| `public-key` | 未対応アルゴリズム、鍵の成分の欠け、import 失敗 |
| `user-handle` | 応答の `userHandle` が `expected.userHandle` と不一致 |
| `sign-count` | 今回値または保存値が非 0 で、今回値 <= 保存値 |
| `signature` | 署名が検証できない |

options 生成の入力誤り (challenge が短い、`user.id` の長さ、`timeout` が負) は検証の失敗ではないので `RangeError` / `TypeError`。

### 8. 依存は WebCrypto だけ

SHA-256 は `crypto.subtle.digest`、乱数は `crypto.getRandomValues`、定数時間比較は全バイトの XOR を畳み込む自前実装、base64url は `Uint8Array` ベースの自前実装。runtime 依存パッケージは無い。`node:crypto` を使わない理由は、Deno / edge runtime (Cloudflare Workers 等) で `node:` 互換層の有無や挙動に左右されず、DESIGN の「どの runtime でも動く」を import 1 つで満たすため。

### runtime 対応の実測

`packages/server/test/runtime/smoke.mjs` (build 後の `dist/index.js` を import し、ES256 / EdDSA / RS256 それぞれで登録 + 認証を 1 回通す) の実行結果 (2026-09-24):

| runtime | 結果 |
|---|---|
| Node 26.9.0 | 3 アルゴリズムとも通過 |
| Bun 1.3.13 | 3 アルゴリズムとも通過 |
| Deno 2.9.4 | 3 アルゴリズムとも通過 |
| edge runtime (Cloudflare Workers 等) | 未確認 |

## Alternatives Considered

| 項目 | 不採用案 | 不採用理由 |
|---|---|---|
| 入力 | 利用者の snake_case 契約型を入力にする | DESIGN の wire は Level 3 の `toJSON()`。snake_case は利用者の境界で写す |
| 入力 | lib.dom の `RegistrationResponseJSON` / `AuthenticationResponseJSON` そのもの | 自前契約から写す利用者が読まれないメンバー (`authenticatorData` / `publicKeyAlgorithm` 等) をダミーで埋めることになる (PK-Q3) |
| `publicKey` | JWK / SPKI で返す | COSE の `alg` を別に持つ必要が出る。元のバイト列に戻せない |
| 鍵の import | `checkPublicKey` を別関数で公開する | 呼び忘れると import できない鍵を記録できる。登録の検証に含めれば呼び忘れが起きない |
| options 生成 | 持たない (利用者が JSON を手で組む) | 両参照実装が持ち、`attestation` / `userVerification` の固定値を利用者に毎回書かせると DESIGN の譲らない点が利用者側で崩れる |
| options 生成 | webauthn-rs のように state (challenge + policy) を返し、検証で受け取る | パッケージが状態を持たないという DESIGN と、challenge の保存を呼び出し側の責務にする決定に反する |
| options 生成 | SimpleWebAuthn の `preferredAuthenticatorType` (3 値から `hints` と `authenticatorAttachment` を導く) | 仕様の語彙 `hints` / `authenticatorAttachment` をそのまま受ける方が対応表が要らない |
| origin | RP ID のサブドメインを構造的に通す (webauthn-rs `allow_subdomains`) | §13.4.8 の危険。完全一致の配列で足りる |
| 埋め込み | 登録は拒否固定、認証だけ option (PK-Q1 の a 案の形) | 登録と認証で option の形が変わる。同じ `topOrigins` を登録に渡さなければ登録は拒否固定と同じになる |
| 埋め込み | `crossOrigin` / `topOrigin` を見ない (cache-warden の形、CSP で塞ぐ前提) | 仕様 §7.1 / §7.2 の手順を落とす。CSP は利用者の責務で、パッケージが前提にできない |
| BE / BS | SimpleWebAuthn の `credentialDeviceType` / `credentialBackedUp` の名で返す | 仕様の語 (`backupEligible` / `backupState`) と 1 対 1 で、別名は対応表を強いる |
| UV | `userVerified: boolean` を結果に返す (両参照実装) | UV 必須なので常に `true`。情報が無い |
| 拡張 | authenticator extension outputs を返す (両参照実装) | Level 3 §10.2 が空で RP の処理手順を持つ拡張が無い。返すなら型が `unknown` になる |
| challenge | `expectedChallenge` に判定関数を渡せる (SimpleWebAuthn) | `challengeOf` で同じ用途を引数を増やさず満たす |
| rpId | 1 つだけ (webauthn-rs) | `origin` を配列で受けるなら rpId も同じ形が要る利用者が出る。単数 → 配列は型の union で足りる |

## Consequences

- 利用者は `registrationOptions()` / `authenticationOptions()` の戻りを client に渡し、返ってきた `json` を `verify*` に渡す。返した JSON の `challenge` を保存するのは利用者
- base64url の読み取りは `Buffer` より厳格 (アルファベット外の文字と、どの符号化でも出ない長さを拒否する。末尾 `=` は許す)
- `clientDataJSON` が JSON object でない場合 (`null` や数値) は `client-data` で拒否する
- 鍵の読み取り・import の失敗と、WebCrypto が受け付けない署名 (長さ違い等) も `PasskeyVerificationError` にまとめる (呼び出し側が `DOMException` を扱わなくてよい)
- 埋め込みで認証を通したい利用者は認証の `expected.topOrigins` に親ページの origin を渡す。Safari からの応答を通すには `embeddedWithoutTopOrigin: "allow"` も要る (PK-Q1 の結論次第で既定が変わる)
- `StoredCredential.backupEligible` を渡す利用者は、passkey が single-device から synced に昇格した時に `backup-eligibility` で拒否される (未決 2)

### 未決 (kawaz 裁定)

1. 入力型を読むメンバーだけの構造的部分型にする (PK-Q3、推奨 a のまま)
2. 認証で BE の false → true (single-device から synced への昇格) を通す option を持つか。仕様 §7.2 step 20 は両方向とも不一致を「verify」の対象にするが、webauthn-rs は `allow_backup_eligible_upgrade` を持ち "This is common on passkeys during some upgrades" と注記する。持つなら `StoredCredential.backupEligible` と対にする option になる。この DR では持たない (仕様どおり両方向拒否、`backupEligible` を渡さなければ比較しない) で書いた
3. 認証で `topOrigin` の無い `crossOrigin: true` の既定 (`embeddedWithoutTopOrigin`) — PK-Q1

### DR 改訂に伴う実装 TODO (`packages/server`、この DR では実装しない)

- `registrationOptions()` / `authenticationOptions()` を新設 (`crypto.getRandomValues`、`RangeError` の入力検査、`allowCredentials` 省略時は載せない)
- `PasskeyExpectation.origin` / `rpId` を `string | string[]` に広げ、一致した値を `RegisteredCredential` / `VerifiedAuthentication` の `origin` / `rpId` で返す (`rpId` の SHA-256 は候補ごとに計算)
- `checkClientData` に `topOrigins` / `embeddedWithoutTopOrigin` を通す。登録・認証の両方
- `RegistrationExpectation.algorithms` を受け、外れは `algorithm` で拒否
- `parseAuthenticatorData` の直後に BE = 0 ∧ BS = 1 を `backup-state` で拒否 (両 ceremony)
- `verifyAuthentication` で `credential.backupEligible` が渡された時の一致検査 (`backup-eligibility`)
- credential id の長さ上限 1023 を `credential` で拒否
- `RegisteredCredential.transports` を `response.transports` から写す (文字列配列でなければ `[]`)
- `AuthenticationExpectation.userHandle` の一致検査 (`user-handle`)
- sign count の条件を `data.signCount !== 0 || credential.signCount !== 0` に書き換える (結果は同じ、仕様の形に揃える)
- 入力型を部分型 (`RegistrationResponse` / `AuthenticationResponse`) に置き換える (未決 1 の裁定後)
- `PasskeyVerificationReason` に `backup-state` / `backup-eligibility` / `algorithm` / `user-handle` を足し、`error.ts` の説明を揃える
- `index.ts` の export と `smoke.mjs` に options 生成の経路を足す

## 関連

- [DESIGN-ja.md](../DESIGN-ja.md) server 節
- [research/2026-09-24-passkey-usage-in-kawaz-repos.md](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) 表 3
- [DR-0001](DR-0001-client-api.md) (client が出す `json` の形と、client に渡す options JSON)
- `docs/QUESTIONS.md` PK-Q1 / PK-Q3
- WebAuthn Level 3 (W3C Recommendation, 2026-08-25): §5.4.3 user id の長さ、§5.4.4 `residentKey` の既定、§5.8.8 hints、§7.1 / §7.2 RP の手順、§10.2 authenticator extensions、§13.4.3 challenge の長さ、§13.4.8 / §13.4.9 origin と topOrigin の検証
- SimpleWebAuthn `@simplewebauthn/server` 14.0.2: `generateRegistrationOptions` / `generateAuthenticationOptions` / `verifyRegistrationResponse` / `verifyAuthenticationResponse`
- webauthn-rs 0.6.1-dev: `webauthn-rs-core` の `generate_challenge_register` / `register_credential` / `generate_challenge_authenticate` / `authenticate_credential` / `origins_match`、`webauthn-rs` の `start_passkey_registration` / `finish_passkey_authentication`
