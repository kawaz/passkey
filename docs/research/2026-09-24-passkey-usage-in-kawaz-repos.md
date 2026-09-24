# kawaz のリポ群での passkey の使われ方

- Date: 2026-09-24
- Status: Concluded

## 動機

`@kawaz/passkey-client` と `@kawaz/passkey-server` の API を、既存の利用者 (ccmsg / ccmsg-webui / cache-warden / hyoui) の実コードから決めるための材料を揃える。issue `2026-09-24-survey-passkey-usage-in-kawaz-repos` の「調べる項目」をリポごとに埋め、client / server それぞれに要る物を「必須 / 一部の利用者だけ / 不要」に分ける。

## 調査範囲

- 対象: 4 リポの `main` ワークツリー (`~/.local/share/repos/github.com/kawaz/<repo>/main/`)。TS / JS / Rust / md / html を `command grep -rn -i 'webauthn\|navigator.credentials\|PublicKeyCredential\|passkey'` (Rust 側は `prf` / `ASAuthorization` も追加) で洗い、当たったファイルのうち実装と DR を読んだ
- server 実装の比較 (ライブラリとの機能差・bundle サイズ) は ccmsg の `docs/research/2026-09-24-webauthn-own-vs-libraries.md` を正とし、ここでは転記しない
- 読み方の区分: **事実** = このファイルで自分がコードを読んで確かめたもの。**仮定** = DR / コメントの記述、または推測。表のセルの出典は `repo:path:symbol` または `repo:path:L行`
- 業務先の固有名詞は出てこなかった

## 調査メモ

### 2026-09-24: 4 リポの構成

| リポ | client (ブラウザ側) | server (検証側) | 言語 |
|---|---|---|---|
| ccmsg | 無し (options はページが組む。事実: `ccmsg:src/` に `navigator.credentials` の呼び出しが 0 件) | 自前 `src/auth/webauthn.ts` + `src/auth/cbor.ts`、呼び出し側 `src/auth/auth.ts` | TS (Bun) |
| ccmsg-webui | `src/auth/client.ts`、状態は `src/state.ts`、画面は `src/ui/SignIn.tsx` / `Enrolment.tsx` / `Reauth.tsx` | 無し (ccmsg の instance に送る) | TS (Preact、bundle あり) |
| hyoui | `crates/hyoui-web/assets/auth.js` (素の JS、`window.hyouiAuth` に載せる IIFE) | `crates/hyoui-web/src/auth/webauthn.rs` が `webauthn-rs-core =0.6.1-dev` を包む、経路は `auth/routes.rs` | Rust + 素の JS |
| cache-warden | daemon バイナリに埋め込んだ 1 枚のページ `crates/cache-warden-cli/src/daemon/ceremony/page.rs:PAGE` (CSP nonce 付きインライン script) | 自前 crate `crates/cache-warden-webauthn/src/lib.rs` (ciborium / p256 / ed25519-dalek / sha2)、呼び出し側 `daemon/ceremony/mod.rs` | Rust + インライン JS |

事実として、**server 側を持つ 3 リポのうち TS は ccmsg だけで、hyoui と cache-warden は Rust**。client 側を持つ 3 リポ (ccmsg-webui / hyoui / cache-warden) はいずれもブラウザの JS だが、bundle の有無と CSP の制約が違う。

### 2026-09-24: ccmsg-webui (client)

- `create()` (事実、`ccmsg-webui:src/auth/client.ts:registerPasskey` L141-161): `rp: { id: location.hostname, name: "ccmsg" }`、`user: { id: bufferOf(claims.user), name: displayName, displayName }`、`pubKeyCredParams` は -7 / -8 / -257、`authenticatorSelection: { residentKey: "preferred", userVerification: "required" }`、`attestation: "none"`。extensions / timeout / hints / excludeCredentials は無い。options は **ページが組む** (server から options を受け取らない。受け取るのは `AuthChallenge { challenge, issuer, expires_at }` だけ、`ccmsg:node_modules/@ccmsg/protocol/src/common/auth.ts:AuthChallenge` L98-107)
- `get()` (事実、`client.ts:getAssertion` L216-220): `publicKey: { challenge, userVerification: "required" }` のみ。rpId / allowCredentials は指定しない (discoverable 前提)。`mediation` と `signal` を呼び出し側から渡せる
- 結果の整形 (事実、`client.ts:registrationCredential` L100-108 / `assertionCredential` L181-191): `toJSON()` は使わず手で base64url 化し、**snake_case** の契約型 (`id` / `raw_id` / `client_data_json` / `attestation_object`、認証は `raw_id` / `client_data_json` / `authenticator_data` / `signature` / `user_handle?`) に写す。`type` / `clientExtensionResults` / `authenticatorAttachment` / `transports` / `publicKey` は送らない。送信時は credential の横に受け取った `challenge` オブジェクト全体と `token` / `code` / `device_label` / `display_name` を並べる (`client.ts:registerPasskey` L163-172、`assertPasskey` L231-234)
- 条件付き UI (事実、`src/state.ts:offerPasskey` L1255-1281、`src/ui/SignIn.tsx` L25 / L52): 画面の mount で `canOfferPasskey()` を確かめてから `mediation: "conditional"` + `AbortController.signal` で `get()` を立て、画面の unmount で `abort()`。input は `autoComplete="username webauthn"`。conditional の失敗・中断は握りつぶし、ボタン経路 (`signIn`) は別に残る
- 可否判定 (事実、`client.ts:canOfferPasskey` L241-251): `PublicKeyCredential.isConditionalMediationAvailable` の有無と結果だけ。`isUserVerifyingPlatformAuthenticatorAvailable` / `getClientCapabilities` / `PublicKeyCredential` 自体の存在確認は無い。失敗の扱いは `src/auth/session.ts:isSignInDeclined` L124-131 で `NotAllowedError` / `AbortError` / `get()` の null を「この端末に passkey が無い」扱いにし、登録 URL を貰う案内を出す (`SignIn.tsx` L30-40)
- iframe / PWA (事実): ccmsg-webui 自身が iframe 内で WebAuthn を走らせる経路は無い。逆に **hyoui を iframe に埋め込む側** で、`src/ui/TerminalPanel.tsx` L37 の `allow="clipboard-read; clipboard-write"` に `publickey-credentials-get` が無い (hyoui 側から追加依頼、`docs/issue/2026-09-17-request-hyoui-iframe-allow-publickey-credentials-get.md`、status open)。PWA manifest は `test/manual/pwa-popups/` の手動検証用だけで、passkey の standalone 対応コードは無い
- server 側の用途の違い (事実): 同じ assertion を「サインイン」(`assert`) と「instance の受け取り」(`enroll`、`client.ts:enrolInstance` L264-283) の 2 経路で使い、後者は登録 URL を開いた時に取った challenge を再利用する (`getAssertion` の `challenge` option)

### 2026-09-24: ccmsg (server)

検査項目は ccmsg の比較調査 §2 / §6 と一致することを `ccmsg:src/auth/webauthn.ts` で確かめた。この調査で新たに読んだのは呼び出し側との責務分担。

- 事実: `verifyRegistration(credential, { challenge, origin, rpId })` / `verifyAssertion(credential, known: { publicKey, signCount? }, { challenge, origin, rpIds[] })` (`webauthn.ts` L151 / L205)。challenge は呼び出し側が `clientDataJSON` から先に読み (`auth.ts:challengeIn` L1554、呼び出し L646)、検証が通った後に消費する (`auth.ts` L665 `#spendStated`)。これは challenge を発行 instance に転送して消費する LB 構成のため (仮定: DR-0001 §2.11 の理由)
- 事実: `userHandle` の照合は検証関数の外 (`auth.ts:#asserted` L943-946)。credential の引き当ても外 (`records.credential(credential.raw_id)` L933)
- 事実: `checkPublicKey` を登録直後に別に呼び、import できない鍵を記録しない (`auth.ts` L657、`webauthn.ts:checkPublicKey` L255)
- 事実: sign count は検証関数と、記録を書く直前 (`auth.ts:#used` / `advances` L980 / L1455) の 2 か所で同じ規則を当てる (待ちの間に別の assertion が先に書いた場合の対策)
- 事実: 検証関数は WebCrypto の `crypto.subtle` で署名を検証するが、SHA-256 と定数時間比較と base64url は `node:crypto` (`createHash` / `timingSafeEqual`) と `Buffer` を使う (`webauthn.ts` L1 / L23-33 / L393-407)
- 事実: origin は 1 つ、rpId は `hostOf(origin)` で origin のホストに固定 (`auth.ts:hostOf` L1505、呼び出し L651 / L957)
- テスト (事実、`command grep -c`): `test/webauthn.test.ts` 9、`test/cbor.test.ts` 7、`test/webauthn-library-grade.test.ts` 12 の test / it。SoftAuthenticator は `test/authenticator.ts`

### 2026-09-24: hyoui (client + server)

- options は **server が組む** (事実、`hyoui:crates/hyoui-web/src/auth/routes.rs` L286-308、`webauthn.rs:Rp::start_registration` L126-152 / `start_authentication` L176-190)。client は `decodeOptions` で base64url を ArrayBuffer に開いてそのまま渡す (`assets/auth.js:decodeOptions` L52-67、呼び出し L209-211 / L250-252)。`parse*OptionsFromJSON()` は使わない
- 登録の options (事実、`webauthn.rs` L134-148): `attestation: none`、アルゴリズム ES256 / RS256 / EdDSA、`residentKey: required`、`userVerification: required`、`authenticatorAttachment` なし、rp.id = endpoint の hostname。認証は record の credential を `allowCredentials` に並べる (`routes.rs` L288-301)。timeout は crate の既定 (`CHALLENGE_TIMEOUT` 600 秒、`webauthn.rs` L32)。mediation / hints / extensions はページ側で足さない
- 結果の整形 (事実、`auth.js:encodeCredential` L70-94): `toJSON()` は使わず手で組むが、形は **Level 3 `toJSON()` に近い camelCase** (`id` / `rawId` / `type` / `response.{clientDataJSON, attestationObject | authenticatorData, signature, userHandle}`)。ただし拡張結果のキーは `clientExtensionResults` ではなく `extensions`、`authenticatorAttachment` / `response.transports` / `response.publicKey` などは送らない。外側の封筒は snake_case (`challenge_id` / `jwt` / `code` / `device_label` / `endpoint`、`auth.js` L107 / L213-216 / L254-260)。server は `webauthn-rs-core` の `RegisterPublicKeyCredential` / `PublicKeyCredential` に serde で読む (`routes.rs` L570)
- 条件付き UI: 無い (事実、`auth.js` に `mediation` の出現なし)。サインインは 401 を受けて overlay のボタンを押した時だけ (`auth.js:signIn` L204-227、`createOverlay().promptSignIn` L370-405)
- 可否判定: 無い (事実、`auth.js` に `PublicKeyCredential` / `isUserVerifying*` / `isConditional*` / `getClientCapabilities` の出現なし)。失敗は例外 message をそのまま overlay に出す (`auth.js` L398-402)
- iframe (事実): ccmsg-webui の Terminal タブに埋め込まれて動く前提。登録は client 側で `window.top !== window.self` なら走らせず「別タブで開く」を出す (`auth.js:runRegistration` L243-247、`showTopLevelNotice` L464-474)。認証は iframe 内でも試み、併せて「別タブで開く」リンクを出す (`auth.js` L380-388)。server は **登録だけ** `crossOrigin: true` を拒否し (`webauthn.rs:finish_registration` L164、crate 側 `webauthn-rs-core-0.6.1-dev/src/core.rs` L498 も登録経路で拒否)、**認証では `crossOrigin` も `topOrigin` も見ない** (`webauthn.rs` L192-200 のコメント、crate に `top_origin` の参照が 0 件)。理由は仮定: Chrome が cross-origin iframe の `get()` で `crossOrigin: true` を送るため (DR-0036 W2-0 gate 3 の記述)
- PWA (事実): `assets/manifest.webmanifest` があり、`index.js` L192 / `session.js` L1986 に standalone 用の全ページリロードがある。passkey の経路で standalone を区別するコードは無い
- server の検証 (事実、crate の実装を読んだ範囲): origin は endpoint の origin 1 つの完全一致 (subdomain / 任意 port 不許可、`webauthn.rs:build` L106-115)。UP 必須 (`core.rs` L536 / L840)、UV は `UserVerificationPolicy::Required`。**attestation は `none` を要求するが fmt を `none` に限定しない** (crate は packed / tpm / apple / android-key を検証して通す、`core.rs` L615-632)。counter は `counter > 0 || stored > 0` の時 `counter <= stored` を拒否 (`core.rs` L1153-1170)。**BE が登録時と変わったら拒否、BS ⇒ BE の矛盾も拒否** (`core.rs` L877-894)。`userHandle` は crate が見ないので hyoui が照合 (`webauthn.rs:finish_authentication` L207-215)。record は counter / BE / BS を認証ごとに更新 (`record.rs:record_use` L124-141)
- challenge (事実): server が `challenge_id` で保存し、1 回だけ消費、endpoint と purpose に束縛 (`record.rs` L586-610、`routes.rs` L570-590)

### 2026-09-24: cache-warden (DR-0034 の vault ceremony)

- 用途 (事実、`cache-warden:crates/cache-warden-webauthn/src/lib.rs` の module doc L29-38、`daemon/ceremony/mod.rs` の module doc L6-24): 目的は人の認証ではなく **PRF 出力で vault の鍵を開くこと**。WebAuthn の検証は「この daemon が許した ceremony か」の gate で、機密性の境界は PRF 出力 (HKDF で KEK を導く、仮定: draft-DR-0034 §2 の記述)
- 登録の options (事実、`mod.rs:begin` L298-321): server が JSON で返す。`rp: { id: config の rp_id, name: "cache-warden" }`、`user: { id: "cache-warden-vault" の base64url, name: "vault", displayName: "cache-warden vault" }` (固定値、利用者は 1 人)、アルゴリズム -7 / -8 のみ (RS256 なし)、`residentKey: "preferred"`、`userVerification: "required"`、`attestation: "none"`、**`extensions: { prf: {} }`**、`timeout: 120000`
- 登録は 2 段 (事実、`page.rs:register` L127-150 / `evaluatePrf` L153-168): `create()` の `getClientExtensionResults().prf.enabled` を確かめ、偽なら「PRF 非対応の passkey では vault を開けない」で止める。続けて `/register/evaluate` で別の challenge を取り、その credential だけを `allowCredentials` にして `extensions.prf.eval.first = salt` で `get()` し、PRF 出力を得てから登録を送る
- unlock (事実、`page.rs:unlock` L170-200、`mod.rs` L333-381): server が全 passkey slot の credential を `allowCredentials` に、slot ごとの salt を `salts` に返し、ページが `extensions.prf.evalByCredential` を組む
- 結果の整形 (事実): `toJSON()` は使わず、**snake_case** (`credential_id` / `client_data_json` / `attestation_object` / `authenticator_data` / `signature`) に **`prf_output`** を並べて送る (`page.rs` L144-149 / L193-199)。`user_handle` / `type` / 拡張結果の全体は送らない
- 条件付き UI・可否判定: 無い (事実、`page.rs` に `mediation` / `isConditional*` / `isUserVerifying*` / `getClientCapabilities` の出現なし)。PRF 非対応は `create()` の後に拡張結果で分かる
- iframe / PWA (事実): ページは CSP `frame-ancestors 'none'` で埋め込み自体を禁じる (`page.rs:csp` L40-45)。listener は loopback に限定 (`mod.rs` L145-147、既定 `127.0.0.1:10002`、`config.rs:DEFAULT_CEREMONY_LISTEN` L178) で、TLS 終端は外の reverse proxy (仮定: draft-DR-0034 §10)。PWA は無い
- 制約 (事実、`page.rs` の module doc L9-23 とテスト L271-288): インライン script は nonce 付きで、外部 script は CSP で読めない。`localStorage` / `console.` / `indexedDB` などの語がページに現れないことをテストで固定している
- server の検証 (事実、`lib.rs`): `type` / challenge (base64url 文字列の完全一致) / origin (設定した一覧との完全一致) / rpIdHash / UP / UV を検査 (L214-256)。**attestation の fmt / attStmt は見ない** (L261-263、authData だけ読む)。**crossOrigin / topOrigin は見ない** (`check_client_data` に該当なし、埋め込みは CSP で塞ぐ)。**sign count は検査せず返すだけ** (`Assertion` の doc L166-173)。**BE / BS は読まない**。assertion の credential id と期待 credential の一致を検査 (L327-329)、登録の attested credential id と送られた `credential_id` の一致は呼び出し側で検査 (`mod.rs` L462)。アルゴリズムは ES256 / Ed25519 (`cose.rs`)
- DR と実装 (事実): draft-DR-0034 は `Status: Draft (kawaz accept 待ち)` だが ceremony は実装済み。draft-DR-0032 は「assertion 検証は webauthn-rs」と書く (`docs/decisions/draft-DR-0032-remote-approval-web-passkey.md` L155) が、実装は自前 crate `cache-warden-webauthn`
- ブラウザ外の経路 (仮定): `docs/findings/2026-08-14-passkey-prf-native-macos.md` が macOS ネイティブ API での PRF を調べているが、Rust / Swift の実装に `ASAuthorization` の出現は無く (事実)、ネイティブ経路は未実装

## 暫定的な結論

### 表 1: 4 リポ × 調べる項目

| 項目 | ccmsg (server) + ccmsg-webui (client) | hyoui | cache-warden |
|---|---|---|---|
| options を組む側 | ページ (`ccmsg-webui:src/auth/client.ts:registerPasskey` / `getAssertion`)。server は challenge だけ返す | server (`hyoui:crates/hyoui-web/src/auth/webauthn.rs:Rp::start_registration` / `start_authentication`) | server (`cache-warden:crates/cache-warden-cli/src/daemon/ceremony/mod.rs:begin` L298-381) |
| rp | `{ id: location.hostname, name: "ccmsg" }` (`client.ts` L144)。get は rpId 省略 | endpoint の hostname、name "hyoui" (`webauthn.rs:build` L106-108) | config の rp_id、name "cache-warden" (`mod.rs` L306 / L376) |
| user | `id` = 契約の UserId (16 byte)、`name` = `displayName` = 人が入れた名前 (`client.ts` L145-152) | `user_id` 16 byte、name / displayName = `sub` (`webauthn.rs` L136) | 固定 `"cache-warden-vault"` / `"vault"` (`mod.rs` L297 / L307) |
| pubKeyCredParams | -7 / -8 / -257 (`client.ts` L153-157) | ES256 / RS256 / EdDSA (`webauthn.rs` L139-143) | -7 / -8 (`mod.rs` L309-312) |
| authenticatorSelection | `residentKey: "preferred"`、UV required (`client.ts` L158) | `residentKey: required`、UV required、attachment なし (`webauthn.rs` L146-148) | `residentKey: "preferred"`、UV required (`mod.rs` L313-316) |
| attestation | `"none"` (`client.ts` L159) | none (`webauthn.rs` L138) | `"none"` (`mod.rs` L317) |
| extensions | なし | なし (client は結果を `extensions` として送るだけ、`auth.js` L79-81) | **登録 `prf: {}`、評価 `prf.eval.first`、unlock `prf.evalByCredential`** (`mod.rs` L318、`page.rs` L160 / L183) |
| timeout | なし | crate 既定 (600 秒、`webauthn.rs` L32) | 120000 (`mod.rs` L319 / L380 / L410) |
| hints | なし | なし | なし |
| allowCredentials | なし (discoverable) | endpoint の record 全部 (`routes.rs` L288-301) | 評価は 1 つ、unlock は全 slot (`page.rs` L159、`mod.rs` L362) |
| mediation | 既定 + `"conditional"` (`state.ts:offerPasskey`) | 既定のみ | 既定のみ |
| `toJSON()` | 使わない (`client.ts:registrationCredential`) | 使わない (`auth.js:encodeCredential`) | 使わない (`page.rs` L144-149) |
| 条件付き UI | あり。mount で開始、unmount で `AbortController.abort()` (`state.ts` L1255-1281、`SignIn.tsx` L25) | なし | なし |
| 可否判定 | `isConditionalMediationAvailable()` のみ、条件付き UI を出すかの判断に使う (`client.ts:canOfferPasskey`) | なし | なし (PRF 非対応は `create()` 後の `prf.enabled` で判定、`page.rs` L133-138) |
| 使えない時の表示 | `NotAllowedError` / `AbortError` / null を「この端末に passkey が無い」扱いにし登録の案内 (`session.ts:isSignInDeclined`、`SignIn.tsx` L30-40) | 例外 message をそのまま overlay に (`auth.js` L398-402) | 例外 message をそのまま (`page.rs` L214-217) |
| iframe | webui 自身は埋め込まれない。hyoui を埋め込む側で `publickey-credentials-get` 未付与 (`TerminalPanel.tsx` L37) | 埋め込まれる前提。登録は top-level のみ (client `auth.js` L243、server `webauthn.rs` L164)、認証は iframe 内も許す + 「別タブで開く」(`auth.js` L380-388) | CSP `frame-ancestors 'none'` で禁止 (`page.rs:csp`) |
| PWA (standalone) | passkey 経路での扱いなし | manifest あり、passkey 経路での区別なし (`assets/manifest.webmanifest`、`auth.js` に該当なし) | なし |
| 検証の実装 | 自前 TS (`ccmsg:src/auth/webauthn.ts`) | `webauthn-rs-core =0.6.1-dev` + 2 点の補い (`webauthn.rs`) | 自前 Rust (`cache-warden-webauthn/src/lib.rs`) |
| attestation の検査 | `fmt == "none"` かつ `attStmt` が空 (`webauthn.ts:verifyRegistration` L166-172) | fmt を限定しない (crate が packed / tpm / apple 等を検証して通す、`core.rs` L615-632) | 見ない (`lib.rs` L261-263) |
| アルゴリズム | ES256 / EdDSA / RS256 (`webauthn.ts:SUPPORTED_ALGORITHMS`) | ES256 / RS256 / EdDSA | ES256 / Ed25519 (`cose.rs`) |
| UP / UV | 両方必須 (`webauthn.ts:checkAuthenticator`) | 両方必須 (`core.rs` L536 / L840、`UserVerificationPolicy::Required`) | 両方必須 (`lib.rs:check_authenticator_data`) |
| origin / rpId | origin 1 つ完全一致、rpId は origin のホスト。認証の rpIds は配列 (`webauthn.ts:checkClientData` / `checkAuthenticator`、`auth.ts:hostOf`) | origin 1 つ完全一致、rpId = hostname (`webauthn.rs:build`) | origin は一覧との完全一致、rpId 1 つ (`lib.rs:check_client_data` L233-236) |
| crossOrigin / topOrigin | 登録・認証とも `crossOrigin: true` か `topOrigin` ありを拒否 (`webauthn.ts` L114) | 登録だけ `crossOrigin: true` を拒否、認証は見ない。topOrigin は見ない (`webauthn.rs` L164 / L192-200) | 見ない (`lib.rs:check_client_data`) |
| sign count | 保存値 > 0 で今回 ≤ 保存値を拒否 (`webauthn.ts` L224-227、`auth.ts:advances`) | `counter > 0 || 保存値 > 0` で今回 ≤ 保存値を拒否 (`core.rs` L1153-1170) | 検査しない、返すだけ (`lib.rs:Assertion`) |
| BE / BS | 登録時に読んで返す、判断に使わない (`webauthn.ts` L199-200) | 認証時に BE の変化と BS ⇒ BE の矛盾を拒否、record を毎回更新 (`core.rs` L877-894、`record.rs:record_use`) | 読まない |
| userHandle | 検証関数の外で record の user と照合、無ければ照合しない (`auth.ts:#asserted` L943-946) | 必須で record と照合 (`webauthn.rs:finish_authentication` L207-215) | 見ない (送られない) |
| credential id の結び付き | 登録: authData の id と `raw_id` を照合 (`webauthn.ts` L192)。認証: `raw_id` で record を引く (`auth.ts` L933) | crate が扱う | 登録: attested id と送信 `credential_id` を照合 (`mod.rs` L462)。認証: 期待 id と一致を検査 (`lib.rs` L327) |
| challenge の管理 | 呼び出し側。clientData から読み、検証後に発行 instance へ消費を頼む (`auth.ts:challengeIn` / `#spendStated`) | server が `challenge_id` で保存・1 回消費・endpoint と purpose に束縛 (`record.rs` L586-610) | server (`ceremony/challenge.rs`)、purpose 別 |
| wire の命名 | snake_case 契約型 `raw_id` / `client_data_json` / `attestation_object` / `authenticator_data` / `signature` / `user_handle` (`@ccmsg/protocol:src/common/auth.ts` L256-356) | credential は camelCase の toJSON 近似 (`extensions` 名だけ違う)、封筒は snake_case (`auth.js:encodeCredential` / `createClient`) | snake_case `credential_id` / `client_data_json` / `attestation_object` / `authenticator_data` / `signature` + `prf_output` (`page.rs` L144-149 / L193-199) |
| wire に並ぶ credential 以外 | `challenge` オブジェクト、`token`、`code`、`device_label`、`display_name` | `challenge_id`、`jwt`、`code`、`device_label`、`endpoint` | `prf_output` |
| 失敗の型 | `WebAuthnError` 1 クラス、message は log 用 (`webauthn.ts` L10) | `WebauthnFailure` enum 4 値 (`webauthn.rs` L39-48) | `Refusal` enum 13 値、ブラウザには出さない (`lib.rs` L90-131) |

### 表 2: `@kawaz/passkey-client` に要る物

| 要る物 | 区分 | 根拠 (利用者の実コード) |
|---|---|---|
| `create()` / `get()` の呼び出しと、結果の base64url 化 | 必須 | 3 client 全部が同じ base64url ヘルパを持つ (`ccmsg-webui:src/auth/base64url.ts`、`hyoui:assets/auth.js` L35-48、`cache-warden:page.rs` L93-100) |
| JSON 形の options を ArrayBuffer に開く (`challenge` / `user.id` / `allowCredentials[].id` / `excludeCredentials[].id`) | 必須 | hyoui と cache-warden は server が options を JSON で返す (`auth.js:decodeOptions`、`page.rs` L128-130 / L172-176)。ccmsg-webui も challenge と user id を開く (`bufferOf`) |
| options をページ側で組む経路 (server は challenge だけ返す) | 一部の利用者だけ | ccmsg-webui だけ (`client.ts:registerPasskey` L141-161) |
| `mediation: "conditional"` と `AbortSignal` による開始・中断 | 一部の利用者だけ | ccmsg-webui だけ (`state.ts:offerPasskey`) |
| `isConditionalMediationAvailable()` による可否判定 | 一部の利用者だけ | ccmsg-webui だけ (`client.ts:canOfferPasskey`) |
| `get()` / `create()` の null と `NotAllowedError` / `AbortError` を「中断・passkey 無し」として区別できる形 | 一部の利用者だけ | ccmsg-webui (`session.ts:isSignInDeclined`)。hyoui / cache-warden は message をそのまま出す |
| 拡張 (PRF) の入力 (`prf: {}`、`prf.eval`、`prf.evalByCredential`) と、`getClientExtensionResults()` の結果の生のバイト列の受け渡し | 一部の利用者だけ | cache-warden だけ (`page.rs` L133 / L160-167 / L183-189)。PRF 出力は JSON wire に乗せる前に呼び出し側が掴む必要がある (`prf_output` として別フィールドで送る) |
| 登録を top-level に限るための「今 iframe 内か」の判定 | 一部の利用者だけ | hyoui (`auth.js` L243 / L380 の `window.top !== window.self`) |
| 結果の `userHandle` を載せる | 一部の利用者だけ | ccmsg-webui (任意)、hyoui (必須)。cache-warden は送らない |
| 結果の拡張結果 (`clientExtensionResults`) を載せる | 一部の利用者だけ | hyoui が `extensions` 名で送る (`auth.js` L79-81)。server 側で読んでいる箇所は見つからなかった |
| Level 3 `toJSON()` 形 (camelCase) で出す | 一部の利用者だけ (形の近い利用者は hyoui だけ) | hyoui が近似形 (`extensions` 名の差あり)。ccmsg-webui と cache-warden は snake_case に写している |
| CSP nonce 下のインライン script として埋め込める配布形 (外部 script を読まない) | 一部の利用者だけ | cache-warden (`page.rs:csp` の `script-src 'nonce-…'`、`default-src 'none'`) |
| bundler を通さない素の script (`window.*` に載せる) として読める配布形 | 一部の利用者だけ | hyoui (`auth.js` は IIFE で `window.hyouiAuth` に載せる、L20 / L492) |
| `isUserVerifyingPlatformAuthenticatorAvailable()` / `getClientCapabilities()` | 候補 (出典なし) | どの利用者も使っていない。DESIGN の client 節が挙げる |
| iframe の permissions policy / PWA standalone の事前判定 | 候補 (出典なし) | どの利用者も呼ぶ前に判定していない。hyoui は失敗の後に「別タブで開く」を出すだけ |
| `hints` / `timeout` の指定 | 不要 (ページ側で指定する利用者なし) | timeout は cache-warden が server の options に入れるだけで、client は素通し |
| `parseCreationOptionsFromJSON()` / `toJSON()` のネイティブ API | 不要 (使う利用者なし) | 3 client とも手で開く・組む |

### 表 3: `@kawaz/passkey-server` に要る物

前提 (事実): TS の server 利用者は ccmsg だけ。hyoui (`webauthn-rs-core`) と cache-warden (自前 Rust crate) は Rust で、TS パッケージをそのまま取り込めない。下の区分は「3 つの server のうち何が要求しているか」で付け、TS で取り込めるのが ccmsg だけであることは論点に回す。

| 要る物 | 区分 | 根拠 |
|---|---|---|
| clientData の `type` / challenge / origin の完全一致 | 必須 | 3 server 全部 (`ccmsg:webauthn.ts:checkClientData`、hyoui は crate、`cache-warden:lib.rs:check_client_data`) |
| rpIdHash の照合 | 必須 | 3 server 全部 |
| UP と UV の両方を必須 | 必須 | 3 server 全部 |
| ES256 と EdDSA | 必須 | 3 server 全部 |
| RS256 | 一部の利用者だけ | ccmsg / hyoui。cache-warden は持たない |
| 登録で authData の credential id と送られた id を照合 | 必須 | ccmsg (`webauthn.ts` L192)、cache-warden (`mod.rs` L462)、hyoui は crate |
| 認証で期待 credential id と一致を検査 (または id で引いた鍵を渡す) | 必須 | ccmsg は呼び出し側で引く、cache-warden は `lib.rs` L327、hyoui は crate |
| 期待 challenge を「値」で渡せる (保存・消費は呼び出し側) | 必須 | ccmsg は発行 instance への転送のため検証後に消費 (`auth.ts` L646-665)。cache-warden も期待値を渡す形 (`lib.rs:verify_registration` の `expected_challenge`) |
| 検証前に clientData から challenge を取り出す手段 | 一部の利用者だけ | ccmsg (`auth.ts:challengeIn`)。hyoui / cache-warden は challenge id / 状態で引く |
| origin を複数受ける | 一部の利用者だけ | cache-warden (`RelyingParty.allowed_origins`)。ccmsg / hyoui は 1 つ |
| rpId を複数受ける (認証) | 一部の利用者だけ | ccmsg の型が配列 (`verifyAssertion` の `rpIds`)、ただし呼び出しは常に 1 要素 (`auth.ts` L957) |
| attestation `none` 固定 (fmt / attStmt を検査) | 一部の利用者だけ | ccmsg だけ。hyoui は fmt を限定しない、cache-warden は見ない |
| 登録で `crossOrigin: true` / `topOrigin` を拒否 | 一部の利用者だけ | ccmsg (両方)、hyoui (`crossOrigin` のみ)。cache-warden は見ない (CSP で埋め込みを塞ぐ) |
| 認証で `crossOrigin: true` / `topOrigin` を拒否 | 一部の利用者だけ | ccmsg だけ。**hyoui は逆に通す必要がある** (ccmsg-webui の iframe 内でのサインイン、`webauthn.rs` L192-200) |
| sign count の巻き戻り拒否 | 一部の利用者だけ | ccmsg (保存値 > 0 の時)、hyoui (crate、今回 > 0 の時も)。cache-warden は検査しない。規則が 2 通りある |
| 今回の sign count を返す | 必須 | 3 server 全部が返す (cache-warden も返すだけはする、`lib.rs:Assertion`) |
| 登録時に BE / BS を返す | 一部の利用者だけ | ccmsg、hyoui。cache-warden は読まない |
| 認証時に BE / BS を返す、BE の変化・BS ⇒ BE の矛盾を拒否 | 一部の利用者だけ | hyoui だけ (crate、`core.rs` L877-894、`record.rs:record_use`) |
| userHandle の照合 | 一部の利用者だけ | ccmsg (任意、呼び出し側)、hyoui (必須、ラッパ側)。どちらも検証関数の外で行っている |
| 登録直後に公開鍵が import できるかの確認 | 一部の利用者だけ | ccmsg (`checkPublicKey`)。他 2 つは登録検証の中で COSE を読むので一体 |
| 失敗を段階別に区別できる形 (外には出さない) | 一部の利用者だけ | cache-warden は 13 値の enum を log に出す (`lib.rs:Refusal`)、hyoui は 4 値。ccmsg は 1 クラス + message |
| options の生成 | 一部の利用者だけ | hyoui (crate の builder)、cache-warden (JSON を手で組む)。ccmsg は持たない |
| PRF 出力の扱い | 不要 (server の検証範囲外) | cache-warden でも PRF 出力は assertion の外を通り、`lib.rs` は触らない (module doc L31-34) |
| attestation の機種検証 (packed / tpm / apple) | 不要 | 要求する利用者なし (hyoui の crate が通すのは副作用で、hyoui の要件は `none`、`webauthn.rs` L124-125) |
| 依存を WebCrypto だけにする | 候補 (出典なし) | DESIGN の方針。ccmsg の現行実装は `node:crypto` と `Buffer` も使っている (`webauthn.ts` L1 / L23-33) |

### API 設計上の論点 (列挙のみ、判断しない)

1. **server の利用者の言語**: TS で取り込めるのは ccmsg だけで、hyoui と cache-warden は Rust。server パッケージを TS だけで出すか、Rust 版を持つか、TS は ccmsg 専用として割り切るか
2. **wire の命名**: DESIGN は Level 3 `toJSON()` (camelCase)。実際の 3 client のうち camelCase に近いのは hyoui だけで、ccmsg (契約 `@ccmsg/protocol`) と cache-warden は snake_case。DESIGN のとおり「使う側の境界で写す」なら ccmsg-webui / ccmsg / cache-warden の 3 か所に写しの層が要る
3. **認証での埋め込み拒否**: DESIGN は登録・認証とも `crossOrigin` / `topOrigin` を拒否し「緩める option は持たない」。hyoui は認証で iframe 内 (ccmsg-webui の Terminal タブ) を通す必要があり、この方針のままでは hyoui の要件が落ちる
4. **attestation `none` 固定の強さ**: ccmsg は fmt を検査、hyoui は限定せず、cache-warden は見ない。固定にすると hyoui / cache-warden は今より厳しくなる (packed 等を返す authenticator が拒否される)
5. **sign count の規則**: ccmsg (保存値 > 0 の時だけ) と hyoui の crate (今回 > 0 の時も) で違い、cache-warden は検査しない。DESIGN は ccmsg の規則
6. **BE / BS**: DESIGN は「登録時に返す、判断に使わない」。hyoui は認証時にも更新し、BE の変化を拒否している
7. **userHandle の照合をパッケージの中に入れるか**: ccmsg も hyoui も検証関数の外で照合している。hyoui は必須、ccmsg は任意
8. **challenge の受け渡し**: 期待値を渡す形は全員に合うが、ccmsg は検証前に clientData から challenge を読む必要がある (転送のため)。この取り出しを API に含めるか
9. **options の生成を server に置くか**: hyoui と cache-warden は server が options を返し、ccmsg はページが組む。client は両方の経路を受ける必要があるか
10. **PRF**: cache-warden だけが要る。client が拡張の入力と `getClientExtensionResults()` の生の値を通すか、それとも拡張は呼び出し側が options に足して結果を自分で読む形にするか。PRF 出力を wire の JSON に混ぜない配慮 (cache-warden は別フィールド) をどう扱うか
11. **client の配布形**: ccmsg-webui は bundle、hyoui は素の script (`window.*`)、cache-warden は CSP nonce 下のインライン 1 本。ESM だけで出すと hyoui と cache-warden はそのまま使えない
12. **RS256**: cache-warden は持たない。DESIGN は 3 アルゴリズム固定で、それ自体は cache-warden を壊さない (受けるだけ)。pubKeyCredParams を client が決めるなら利用者ごとに違う
13. **residentKey**: ccmsg と cache-warden は `preferred`、hyoui は `required` (userHandle を必須にするため)。client が既定を持つならどちらか
14. **可否判定**: DESIGN の client 節が挙げる 4 つ (`PublicKeyCredential` の有無 / UVPA / conditional / capabilities) のうち、実際に使われているのは `isConditionalMediationAvailable()` だけ

## 関連

- issue: `docs/issue/2026-09-24-survey-passkey-usage-in-kawaz-repos.md`
- 本リポの方針: `docs/DESIGN-ja.md`
- server 実装とライブラリの比較: ccmsg `docs/research/2026-09-24-webauthn-own-vs-libraries.md`
- ccmsg DR-0001 §2.11 (自前実装の理由)、hyoui DR-0036 (web endpoint の passkey 認証)、cache-warden draft-DR-0034 §2 / §10 (vault の鍵導出と ceremony 経路)、draft-DR-0032 (daemon 配信のページと passkey)
- ccmsg-webui issue `2026-09-17-request-hyoui-iframe-allow-publickey-credentials-get` (iframe の permissions policy)
