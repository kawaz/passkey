# DR-0001: `@kawaz/passkey-client` の公開 API

- Status: Accepted (2026-09-28、未実装)
- Date: 2026-09-24

## Context

client はブラウザの差 (`toJSON()` / `parse*OptionsFromJSON()` / `getClientCapabilities()` の有無、条件付き UI の対応) と、iframe / PWA での制約を吸収する層。この DR は issue `client-api-from-three-webuis` の「決めること」5 項目 (登録 / 認証の入出力と失敗の区別、条件付き UI、可否判定、iframe / PWA、`toJSON()` 不在時の整形範囲) を決める。

方針: 手軽に使えてかつ十分なクオリティの passkey ライブラリにする。IF はできるだけシンプルに保ちつつ、便利機能や需要のある必要機能は妥協しない。採否は次の 4 基準で決め、各 Decision に「基準 n」で根拠を書く。

1. WebAuthn Level 3 (W3C Recommendation) が client / RP に求める処理は全部持つ。client 側の該当は §5.1.8 / §5.1.9 (options JSON の展開は拡張入力にも及ぶ)、§5.1 (`toJSON()` の形)、§5.1.7 / §5.8.7 (capability の語彙)、§5.9 / §5.10 (permissions policy と iframe)
2. SimpleWebAuthn (`@simplewebauthn/browser` 13) と webauthn-rs (0.6.1-dev、client 側は `webauthn-rs-proto`) の両方が公開している機能は「需要あり」として持つ。片方だけのものは候補として列挙し採否を書く
3. DESIGN の譲らない点は維持: wire は Level 3 の `toJSON()` 形 (camelCase)。options の中身を決める既定値 (rp / user / アルゴリズム / residentKey) は relying party の責務で client は持たない
4. IF はシンプルに: 関数の数と引数の形を増やさず option で吸収できるなら option、既定値は最も安全な側

判断の材料は [research/2026-09-24-passkey-usage-in-kawaz-repos.md](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) の表 2 と論点 2 / 7 / 9 / 10 / 11 / 13 / 14 (利用者の実コードが要求する形) と、上の 2 つの参照実装の公開 API。

既に決まっていて覆さないこと:

- server の埋め込み (`crossOrigin` / `topOrigin`) の扱いは [DR-0002](DR-0002-server-api.md) が決める。client は iframe 内の `get()` を事前に塞がない
- ブラウザの対応状況 (裏取り済み): `getAuthenticatorData()` / `getPublicKey()` / `getPublicKeyAlgorithm()` は Chrome 85 / Firefox 119 / Safari 16。passkey 自体が Safari 16 / Chrome 108 以降なので、passkey は使えるが getter が無い環境は無い。`toJSON()` / `parse*OptionsFromJSON()` は Chrome 129 / Firefox 119 / Safari 18.4 で、iOS 16〜18.3 と Chrome 108〜128 は passkey が使えるが無い。`getClientCapabilities()` は Chrome 133 / Firefox 135 / Safari 17.4

### 目的

- 利用者が別々に持つ base64url 化、options の JSON からの展開、結果の整形、失敗の分類を、1 つの関数群に置き換えられる
- wire の JSON は server が検証に使うものだけを運び、ページの外に出してはならない値 (PRF 出力) を混ぜない
- ブラウザが Level 3 の JSON API を持つかどうかで、利用者から見える入出力の形が変わらない
- 呼ぶ前に分かる事実 (何が使えるか、どんな文脈で動いているか) を、呼んだ後の失敗と別に取れる

増やしたくないもの: options の中身を決める既定値 (基準 3)、利用者の画面遷移や DOM を client が勝手に触る振る舞い (条件付き UI と明示ボタンの直列化、`<input autocomplete>` の検査)。

### 前提条件

- 実行環境は secure context のブラウザ。`navigator.credentials` と `PublicKeyCredential` が無い場合 `register()` / `authenticate()` は `kind: "failed"` で失敗し、`capabilities()` は全部 `false` を返す
- 利用者は options を Level 3 の JSON 形 (`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`) で用意する。server が返すならそのまま (DR-0002 の `registrationOptions()` / `authenticationOptions()` はこの形を返す)、ページで組むなら base64url 文字列で組む
- `AuthenticatorAttestationResponse` の `getAuthenticatorData()` / `getPublicKey()` / `getPublicKeyAlgorithm()` / `getTransports()` を持たないブラウザは対象外 (`failed`)。理由は Context のブラウザ対応状況: passkey が使える環境には必ずある

## Decision

API は 4 つの関数と 1 つの例外クラス。型名は本リポの TypeScript (lib.dom) にある Level 3 の型をそのまま使う。

```ts
// 型はすべて lib.dom のグローバル (PublicKeyCredentialCreationOptionsJSON /
// PublicKeyCredentialRequestOptionsJSON / RegistrationResponseJSON /
// AuthenticationResponseJSON / AuthenticationExtensionsClientOutputs /
// PublicKeyCredentialClientCapabilities)。client が同名の型を定義し直さない

export function register(
  options: PublicKeyCredentialCreationOptionsJSON,
  controls?: { signal?: AbortSignal },
): Promise<RegistrationResult>;

export function authenticate(
  options: PublicKeyCredentialRequestOptionsJSON,
  controls?:
    | { mediation?: undefined; signal?: AbortSignal }
    | { mediation: "conditional"; signal: AbortSignal },
): Promise<AuthenticationResult>;

export interface RegistrationResult {
  /** wire に載せる形。`clientExtensionResults.prf.results` は含まない */
  json: RegistrationResponseJSON;
  /** `getClientExtensionResults()` そのもの (ArrayBuffer のまま)。ページの中で使う値はここから取る */
  extensions: AuthenticationExtensionsClientOutputs;
}

export interface AuthenticationResult {
  json: AuthenticationResponseJSON;
  extensions: AuthenticationExtensionsClientOutputs;
}

export class PasskeyError extends Error {
  readonly kind: "declined" | "excluded" | "aborted" | "failed";
  /** ブラウザが投げた元の例外 (DOMException / TypeError)。`null` 応答と `PublicKeyCredential` 不在は client 自身の Error */
  override readonly cause: unknown;
}

export function capabilities(): Promise<PublicKeyCredentialClientCapabilities>;

export interface PasskeyContext {
  /** `window.top !== window.self` */
  embedded: boolean;
  /** `matchMedia("(display-mode: standalone)")` が真 (PWA としてインストールされて開かれている) */
  standalone: boolean;
  /** permissions policy が `publickey-credentials-create` / `-get` を許すか。`document.permissionsPolicy` が無いブラウザではキーごと無い (不明) */
  allowed: { create?: boolean; get?: boolean };
}

export function context(): PasskeyContext;
```

### 1. 登録 / 認証の入出力と、失敗の区別

入力は Level 3 の options JSON、出力は Level 3 の response JSON。options の JSON から `BufferSource` への展開 (`challenge` / `user.id` / `allowCredentials[].id` / `excludeCredentials[].id` / 拡張入力の Decision 5 の表にあるメンバー) と、結果の base64url 化は client が行う。`options` に無い項目 (timeout / hints / rpId / attestation / authenticatorSelection) を client が補わない (基準 3)。

参照実装との対応 (基準 2): SimpleWebAuthn の `startRegistration({ optionsJSON })` / `startAuthentication({ optionsJSON })` と、webauthn-rs の `RegisterPublicKeyCredential` / `PublicKeyCredential` (serde で JSON から読む) がどちらも同じ入出力の形を採る。

失敗は `PasskeyError` を throw し、`kind` で 4 つに分ける:

| `kind` | 元の事象 | 意味 |
|---|---|---|
| `declined` | `NotAllowedError`、`create()` / `get()` の `null` 応答 | passkey が提示されなかった。利用者の取り消しと、この origin の passkey が無いことと、埋め込みで permissions policy に拒まれたことを、ブラウザは同じ名前で返す (仕様 §5.1.3 / §5.1.4 の catch-all)。区別は利用者側が `context()` と組み合わせて行う |
| `excluded` | 登録の `InvalidStateError` | `excludeCredentials` に載せた credential を持つ authenticator が選ばれた (仕様 §5.1.3 の excludeCredentials 一致)。仕様 §7.1 step 2 が「別の authenticator を使うよう案内する」例として挙げる唯一の失敗で、利用者が文言を分けるべき失敗 |
| `aborted` | `AbortError` | 利用者側が渡した `signal` で止めた。条件付き UI を画面の unmount で畳む時に出る |
| `failed` | それ以外 (`SecurityError` / `NotSupportedError` / `ConstraintError` / `TypeError` / `EncodingError` / client 自身の展開失敗 / `PublicKeyCredential` 不在) | options か環境の問題。利用者には `message` を見せる |

`message` は元の例外の `message` をそのまま持ち、`cause` に元の例外を持たせる。`kind` より細かい判断は `cause.name` から行う。

`kind` の粒度 (基準 2、片方のみ → 候補として採否): SimpleWebAuthn の `WebAuthnError.code` は 12 値 (`ERROR_CEREMONY_ABORTED` / `ERROR_INVALID_DOMAIN` / `ERROR_INVALID_RP_ID` / `ERROR_INVALID_USER_ID_LENGTH` / `ERROR_MALFORMED_PUBKEYCREDPARAMS` / `ERROR_AUTHENTICATOR_GENERAL_ERROR` / `ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT` / `ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT` / `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` / `ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG` / `ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE` / `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY`) で、webauthn-rs は client 側の分類を持たない。12 値のうち利用者が画面の分岐に使えるのは `PREVIOUSLY_REGISTERED` (= `InvalidStateError`) だけで、これを `excluded` として採る。残りは options の誤り (`INVALID_*` / `MALFORMED_*` / `NO_SUPPORTED_*`) と authenticator の能力不足 (`MISSING_*`、`ConstraintError` の推測) で、どちらも利用者に見せるのは `message` であり分岐しない。しかも SimpleWebAuthn の分類は options の中身から推測する heuristic で、同じ `ConstraintError` が 3 つの code に散る。`cause.name` を見れば同じ判断ができるので、`kind` には足さない。

`null` 応答を `declined` に畳む理由: 仕様 §5.1.3 / §5.1.4 は `null` を「credential が得られなかった」の意味でしか返さず、`NotAllowedError` と利用者から見た意味が同じ。

### 2. 条件付き UI の開始・中断と、明示ボタンとの切り替え

条件付き UI は `authenticate()` の `controls` に `{ mediation: "conditional", signal }` を渡す。別関数にしない (options も結果の形も同じで、違いは `mediation` だけ。基準 4)。`signal` は型で必須にする: 条件付き UI の要求は画面より長生きし (仕様 §5.1.4 で lifetimeTimer が無限)、止める手段が無いと畳めない。

参照実装との対応 (基準 2): SimpleWebAuthn は `startAuthentication({ useBrowserAutofill: true })`、webauthn-rs は `start_discoverable_authentication()` が `mediation: Conditional` を options に載せる。両方が持つので採る。

明示ボタンとの切り替えは利用者側の責務で、client は直列化しない。SimpleWebAuthn は `WebAuthnAbortService` で「新しい ceremony を始めたら前の ceremony を abort する」を内側で行うが (片方のみ → 候補)、採らない: 条件付き UI を立てたまま明示ボタンの経路を並走させる使い方 (ccmsg-webui `state.ts:offerPasskey` と `signIn`) では、client が畳むとボタンを押した瞬間に条件付き UI の promise が `aborted` で落ち、利用者側の握りつぶしに依存する。利用者は `signal` を持っているので、直列化したければ自分の `AbortController` で行える (基準 4: 既定は何もしない側)。

SimpleWebAuthn の `verifyBrowserAutofillInput` (`<input autocomplete="… webauthn">` の存在検査) も採らない: DOM の検査は client の責務でなく、無いときの挙動は仕様上「条件付き UI が出ない」だけで例外にならない。

呼ぶ前の判定は `capabilities()` の `conditionalGet` (仕様 §5.1: `isConditionalMediationAvailable()` が true と等価)。

条件付き登録 (`create()` の `mediation: "conditional"`、仕様 §5.1.3 の conditionalCreate) は採らない。SimpleWebAuthn は `startRegistration({ useAutoRegister: true })` で持つが webauthn-rs は持たない (片方のみ → 候補)。不採用の決め手は基準 3 の DESIGN との衝突: 仕様 §5.1.3 は "The client MUST set BOTH requireUserPresence and requireUserVerification to FALSE when options.mediation is set to conditional unless they may be explicitly performed during the ceremony." と定め、§7.1 も conditional の時は UP の検証を省くよう書く。server が UP + UV を必須にし緩める option を持たない以上、条件付き登録で作った credential は server の検証を通らない。server の方針が変わる時に、`register()` の `controls` に `mediation` を足す形で入れられる (今の `controls` の形はそれを妨げない)。

### 3. 可否判定の粒度

`capabilities()` は仕様 §5.1.7 の `getClientCapabilities()` と同じ語彙 (`record<DOMString, boolean>`、キーは §5.8.7 `ClientCapability` の列挙値 `conditionalCreate` / `conditionalGet` / `hybridTransport` / `passkeyPlatformAuthenticator` / `userVerifyingPlatformAuthenticator` / `relatedOrigins` / `signalAllAcceptedCredentials` / `signalCurrentUserDetails` / `signalUnknownCredential` と `extension:<識別子>`) で返す。意味も仕様のまま: `true` は使える、`false` は使えない、キーが無いのは不明 (基準 1)。

ブラウザ差の吸収:

- `getClientCapabilities()` があればその結果をそのまま返す
- 無ければ `conditionalGet` を `isConditionalMediationAvailable()` から、`userVerifyingPlatformAuthenticator` を `isUserVerifyingPlatformAuthenticatorAvailable()` から作る。メソッド自体が無いキーは `false` (仕様 §5.1 の注記: `isConditionalMediationAvailable()` が無いなら条件付き UI は使えない)。他のキーは入れない (不明)
- `PublicKeyCredential` が無ければ `ClientCapability` の全キーを `false` で返す (何も使えないことは分かっている)

参照実装との対応 (基準 2): SimpleWebAuthn の `browserSupportsWebAuthn()` / `platformAuthenticatorIsAvailable()` / `browserSupportsWebAuthnAutofill()` は、それぞれ「全部 `false` かどうか」/ `userVerifyingPlatformAuthenticator` / `conditionalGet` に対応する。webauthn-rs は client 側の可否判定を持たない (Rust の RP ライブラリなので該当なし)。SimpleWebAuthn の 3 関数を別名で持たない理由: 仕様の語彙が既にあり、独自名は利用者に対応表を強いる。`PublicKeyCredential` の有無だけを返す同期関数 (`browserSupportsWebAuthn()` 相当) は、`register()` / `authenticate()` が `failed` で答えるのと `capabilities()` の全 `false` で足りるので持たない (基準 4)。

### 4. iframe / PWA の制約

呼ぶ前に分かる事実は `context()` で返し、呼んだ時の失敗は Decision 1 の `declined` に畳む。両方を持つ理由: permissions policy に拒まれた失敗は `NotAllowedError` で、利用者の取り消しと名前で区別できない (仕様 §5.9 と §5.1.4)。だから「埋め込まれているか」「許されているか」は呼ぶ前の事実として別に出す。参照実装はどちらも持たない (基準 2 の候補) が、基準 1 の §5.9 / §5.10 が client 側に課す前提 (cross-origin iframe では既定で無効、`allow` 属性で開く) を利用者が知る手段として採る。`context()` は同期関数 1 つで、キーを足す形で広がる (基準 4)。

- `embedded`: `window.top !== window.self`。登録を top-level に限るか、認証で「別タブで開く」を併記するかは利用者 (と server) の判断で、client は `embedded` が true でも `register()` / `authenticate()` を塞がない。認証は embedder が `allow="publickey-credentials-get"` を付けていれば通るし、通らなくても `declined` で返る
- `allowed.create` / `allowed.get`: `document.permissionsPolicy.allowsFeature("publickey-credentials-create")` / `("publickey-credentials-get")`。`document.permissionsPolicy` が無いブラウザではキーごと省く (不明)。`allowsFeature()` が例外を投げた場合も省く。`embedded` が false なら top-level なので、policy の既定 (`self`) により両方 `true` になるはずだが、その推測は client がせず API の答えをそのまま返す
- `standalone`: `matchMedia("(display-mode: standalone)").matches`。PWA (インストールして standalone 表示) は主な利用形態として扱う。standalone で WebAuthn の可否や挙動 (条件付き UI の表示、hybrid transport の QR、iOS の `NotAllowedError` の出方) が変わるかは実測がまだ無く、困った事象が出た時に実測して `context()` の説明に足す (先回りの実測はしない)。`matchMedia` が無い環境では `false`

### 5. `toJSON()` が無いブラウザでの自前整形の範囲

整形は常に client 自身が行い、ブラウザの `toJSON()` / `parse*OptionsFromJSON()` は使わない。出力は Level 3 の `RegistrationResponseJSON` / `AuthenticationResponseJSON` の全メンバー:

| メンバー | 出所 |
|---|---|
| `id` / `rawId` / `type` / `authenticatorAttachment` | `PublicKeyCredential` の属性。`authenticatorAttachment` は `null` なら省く |
| `response.clientDataJSON` / `attestationObject` / `authenticatorData` (認証) / `signature` | `response` の属性を base64url 化 |
| `response.userHandle` | `null` なら省く (仕様の optional) |
| `response.authenticatorData` (登録) / `publicKey` / `publicKeyAlgorithm` / `transports` | `getAuthenticatorData()` / `getPublicKey()` (`null` なら省く。仕様 §5.1 の注記どおり、ブラウザが知らないアルゴリズムでは無い) / `getPublicKeyAlgorithm()` / `getTransports()`。メソッドが無いブラウザは `failed` (前提条件) |
| `clientExtensionResults` | `getClientExtensionResults()` を再帰的に base64url 化 (`ArrayBuffer` / `ArrayBufferView` を文字列に、それ以外はそのまま)。ただし `prf.results` は落とす (下記) |

自前 1 経路に固定する理由: passkey が使えるのに `toJSON()` / `parse*OptionsFromJSON()` が無いブラウザ (iOS 16〜18.3、Chrome 108〜128) が現に対象なので、自前の展開・整形は必須。native があるブラウザでそちらを優先すると経路が 2 本になり、ブラウザごとの `toJSON()` の差 (含めるメンバー、拡張出力の扱い) が利用者に見える。`prf.results` を落とす後処理はどちらにせよ要る。自前だけにすれば経路が 1 つになり、テストと挙動が 1 つになる。参照実装 (基準 2) も SimpleWebAuthn は自前で整形し (`toJSON()` を使わない)、webauthn-rs の wasm 側も serde で自前に組む。

`clientExtensionResults.prf.results` を wire の JSON から落とす。仕様 §10.1.4 は `results` について "For some use cases, for example if PRF outputs are used to derive encryption keys to use only on the client side, it may be necessary to omit this results output if the PublicKeyCredential is sent to a remote server, for example to perform the procedures in § 7 WebAuthn Relying Party Operations. Note in particular that the RegistrationResponseJSON and AuthenticationResponseJSON returned by PublicKeyCredential.toJSON() will include this results output if present." と、`toJSON()` がこれを含めることと、鍵導出に使う場合は送る前に省く必要があることの両方を書いている。server の検証 (§7) は PRF 出力を使わない。だから wire の形 (`json`) には載せず、ページの中で使う値は `extensions` (生の `getClientExtensionResults()`) から取る。`prf.enabled` は残す (鍵素材ではなく、登録時に PRF 対応を確かめる材料)。これは「wire は `toJSON()` の形」からの唯一の逸脱で、仕様が省略を求める場面そのもの (基準 3 の範囲内)。

options JSON の展開は、Level 3 §10 が JSON 形を定義する拡張全部に及ぶ (基準 1: §5.1.8 / §5.1.9 "This conversion MUST also apply to any client extension inputs processed by the client.")。§10 で `AuthenticationExtensionsClientInputsJSON` / `OutputsJSON` の partial dictionary を定義している拡張は 5 つで、client が開く・畳むメンバーは次のとおり:

| 拡張 (§) | 入力で base64url → `BufferSource` に開くもの | 出力で `ArrayBuffer` → base64url に畳むもの |
|---|---|---|
| `appid` (§10.1.1) | 無し (`DOMString`) | 無し (`boolean`) |
| `appidExclude` (§10.1.2) | 無し (`DOMString`) | 無し (`boolean`) |
| `credProps` (§10.1.3) | 無し (`boolean`) | 無し (`{ rk?: boolean }`) |
| `prf` (§10.1.4) | `eval.first` / `eval.second` / `evalByCredential[<credential id>].first` / `.second` | `results.first` / `results.second` (畳んだ上で `json` からは落とす) |
| `largeBlob` (§10.1.5) | `write` | `blob` |

これ以外の拡張 (IANA 登録の識別子で §10 に無いもの) は、§5.1.8 が "AuthenticationExtensionsClientInputsJSON MAY include extensions registered in the IANA "WebAuthn Extension Identifiers" registry but not defined in § 9 WebAuthn Extensions." と認めるとおり入力は JSON のまま渡し、出力は再帰的 base64url 化の一般規則で畳む。どの文字列がバッファかは拡張ごとに違うので、知らない拡張の入力を client が推測で開かない。参照実装 (基準 2): SimpleWebAuthn は `extensions` を素通し (展開しない)、webauthn-rs は `credProtect` / `credProps` / `minPinLength` / `hmacCreateSecret` / `appid` / `uvm` / `hmacGetSecret` を型で持つ。両方が持つのは `appid` / `credProps` で、上の表はそれを含む。

## Alternatives Considered

| 項目 | 不採用案 | 不採用理由 |
|---|---|---|
| 1 失敗の形 | 判別可能な結果型 `{ ok: true, ... } \| { ok: false, kind }` を返す | `await` + `try/catch` で書く利用者に分岐を強いる。throw なら `catch` の中で `kind` を見るだけで済む。参照実装も両方 throw |
| 1 失敗の形 | `declined` を `null` 戻り値で返し、例外は失敗だけにする | 利用者が `null` 検査と `catch` の両方を書くことになる |
| 1 失敗の形 | `kind` を SimpleWebAuthn の 12 値に揃える | 画面の分岐に使えるのは `PREVIOUSLY_REGISTERED` だけで、残りは heuristic (同じ `ConstraintError` が 3 code に散る)。`cause.name` で同じ判断ができる |
| 2 条件付き UI | `offerConditional(options): () => void` のような別関数 | options と結果の形が同じで、違いは `mediation` だけ。別関数にすると失敗の形と結果の形を 2 つ持つ (基準 4) |
| 2 条件付き UI | client が条件付き UI の `AbortController` を内側に持ち、明示経路を呼んだら先に畳む (SimpleWebAuthn `WebAuthnAbortService`) | 並走させる使い方を壊す。利用者は `signal` を持っているので直列化は自分でできる |
| 2 条件付き登録 | `register()` の `controls` に `mediation: "conditional"` を持つ (SimpleWebAuthn `useAutoRegister`) | 仕様 §5.1.3 で UP / UV が必ず立たない。server の UP + UV 必須 (DESIGN) と衝突する |
| 3 可否判定 | `browserSupportsWebAuthn()` / `platformAuthenticatorIsAvailable()` / `browserSupportsWebAuthnAutofill()` の 3 関数 (SimpleWebAuthn の形) | 仕様に同じ意味の語彙 (`ClientCapability`) があり、独自名は利用者に対応表を強いる。`getClientCapabilities()` がある環境ではそのまま返せる方が差が出ない。`extension:prf` のような問いも同じ形で答えられる |
| 3 可否判定 | 単一の `canUsePasskey(): Promise<boolean>` | 「条件付き UI を出すか」と「passkey が使えるか」を 1 つの bool に混ぜる |
| 4 iframe | `embedded` が true なら `register()` を client が塞ぐ | 登録を top-level に限るかは relying party の判断。塞ぐと `declined` と区別する新しい `kind` も要る |
| 4 iframe | 事実を返さず、呼んだ時の `declined` だけにする | permissions policy の拒否と利用者の取り消しが同じ名前なので、「別タブで開く」を出す判断ができなくなる |
| 4 PWA | `standalone` を返さない | PWA は主な利用形態。制約の実測が無いのは「返さない」理由にならず、事実が出た時に利用者が分岐できる形を先に置く |
| 5 整形 | ブラウザの `toJSON()` / `parse*OptionsFromJSON()` があれば使い、無い時だけ自前 | 出力がブラウザによって変わる (2 経路)。`prf.results` を落とす後処理はどちらにも要る。自前 1 経路の方がテストと挙動が 1 つになる |
| 5 整形 | `clientExtensionResults` / `authenticatorAttachment` / `transports` / `publicKey` を出さず、server が読む最小だけ出す | wire を Level 3 の形に固定した決定に反する。server を別実装に替えた時に足りなくなる |
| 5 整形 | getter (`getAuthenticatorData()` 等) の無いブラウザ向けに `attestationObject` を client で CBOR 読みして埋める、または出力型で optional にする | passkey が使える環境には getter が必ずある (Context)。無いブラウザは対象外で `failed` |
| 5 PRF | `prf.results` も `json` に含め、落とすのは利用者の責務にする | 仕様が `toJSON()` の挙動として明記する通り、含めると `JSON.stringify(json)` でそのまま鍵素材が出る |
| 5 PRF | `extensions` を返さず、`register()` / `authenticate()` が生の `PublicKeyCredential` を返して整形は別関数 | 利用者が全員 2 段で書くことになる。読まないフィールドが 1 つ増えるだけで済む |
| 5 拡張 | 展開する拡張を `prf` だけにする | 仕様 §5.1.8 は拡張入力全部の展開を client に求める。`largeBlob.write` を開かないと利用者が自分で開くことになり、JSON 形で受ける意味が無い |
| 入力経路 | ページで組む経路用に `rp` / `user` / アルゴリズムを補う builder を client に持つ | options の既定値は relying party の責務 (基準 3)。server 側の DR-0002 が `registrationOptions()` / `authenticationOptions()` を持つので、ページで組む利用者は JSON 形を文字列で組める |
| 配布形 | この DR で ESM / 素の script / CSP nonce 下のインラインを決める | 扱わない。配布形は API の形を変えないので issue `client-distribution-forms` で決める。API 側に課す制約だけ Consequences に書く |

## Consequences

- 利用者側の境界で写す作業: camelCase の `json` から自分の契約 (snake_case 等) へ写すのは利用者の責務 (決定済みの方針)。`userHandle` は `null` でなく省略で来る
- `prf.results` は `json` に無い。PRF を使う利用者は `extensions.prf?.results?.first` から取り、wire に載せるなら自分の別フィールドで送る
- 拡張の展開は §10 の 5 つ。IANA 登録だけの拡張を JSON 形で渡す利用者が出たら、その拡張の展開規則をこの DR の表に足す
- `excluded` を受けた画面は「この authenticator は登録済み」の文言を出せる。`declined` と分けない利用者は `kind !== "failed"` で今までどおり畳める
- 配布形の issue に対して API が課す制約: top-level の副作用を持たない、外部依存を持たない、動的 import を使わない (CSP nonce 下のインライン 1 本と `window.*` の IIFE の両方をこの 1 つのソースから出せるように)
- server 側の埋め込み方針 (DR-0002) に client は依存しない。`context().embedded` / `allowed` の事実と `declined` の失敗だけを返し、埋め込みでの認証を通すかは server と利用者が決める
- PWA (standalone) で困った事象が出たら、その時に条件付き UI の表示 / hybrid transport (QR) / `NotAllowedError` の出方 / `allowed` の値を実機で表にして `context()` の説明に反映する
- DESIGN の client 節は「可否判定」を `capabilities()` の語彙に、「iframe と PWA での制約」を `context()` の 3 キーに書き換える (裁定後)

### 裁定済み (2026-09-28)

`PasskeyError.kind` の `excluded` と `context().allowed` はどちらも採用で確定。

## 受け入れ条件の突き合わせ: research 表 2 × 採用案

| 表 2 の要る物 | 区分 | 採用案でどう満たすか |
|---|---|---|
| `create()` / `get()` の呼び出しと結果の base64url 化 | 必須 | `register()` / `authenticate()` が行い、`json` に Level 3 の形で出す |
| JSON 形の options を ArrayBuffer に開く | 必須 | 入力を Level 3 の options JSON に固定し、`challenge` / `user.id` / `allowCredentials[].id` / `excludeCredentials[].id` / §10 の拡張入力を client が開く |
| options をページ側で組む経路 (server は challenge だけ返す) | 一部の利用者 | 同じ JSON 形をページで組む。challenge と user id は base64url 文字列でそのまま置ける。builder は client に持たず、server 側の `registrationOptions()` を使う経路もある |
| `mediation: "conditional"` と `AbortSignal` による開始・中断 | 一部の利用者 | `authenticate(options, { mediation: "conditional", signal })`。unmount で `signal` を abort すると `aborted` |
| `isConditionalMediationAvailable()` による可否判定 | 一部の利用者 | `capabilities()` の `conditionalGet` |
| `null` と `NotAllowedError` / `AbortError` を「中断・passkey 無し」として区別できる形 | 一部の利用者 | `PasskeyError.kind` の `declined` (`null` + `NotAllowedError`) と `aborted`。登録済みは `excluded` |
| 拡張 (PRF) の入力と `getClientExtensionResults()` の生の値の受け渡し | 一部の利用者 | 入力は options JSON の `extensions.prf` (`eval` / `evalByCredential`)。生の値は `RegistrationResult.extensions` / `AuthenticationResult.extensions`。`json` には `prf.results` を含めない |
| 登録を top-level に限るための「今 iframe 内か」の判定 | 一部の利用者 | `context().embedded`、許可の有無は `context().allowed` |
| 結果の `userHandle` を載せる | 一部の利用者 | `json.response.userHandle` (非 `null` の時) |
| 結果の拡張結果 (`clientExtensionResults`) を載せる | 一部の利用者 | `json.clientExtensionResults` (`prf.results` 以外) |
| Level 3 `toJSON()` 形 (camelCase) で出す | 一部の利用者 | `json` は Level 3 の形 |
| CSP nonce 下のインライン script として埋め込める配布形 | 一部の利用者 | issue `client-distribution-forms`。API 側は副作用・外部依存・動的 import を持たない制約を課す |
| bundler を通さない素の script (`window.*`) | 一部の利用者 | 同上 |
| `isUserVerifyingPlatformAuthenticatorAvailable()` / `getClientCapabilities()` | 候補 | `capabilities()` が両方を仕様の語彙に畳む |
| iframe の permissions policy / PWA standalone の事前判定 | 候補 | `context().allowed` と `context().standalone` |
| `hints` / `timeout` の指定 | 不要 | options JSON に入っていればそのまま渡る。client は補わない |
| `parseCreationOptionsFromJSON()` / `toJSON()` のネイティブ API | 不要 | 使わない (Decision 5) |

## 関連

- [research/2026-09-24-passkey-usage-in-kawaz-repos.md](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) — 表 2 と論点 2 / 7 / 9 / 10 / 11 / 13 / 14
- [DESIGN-ja.md](../DESIGN-ja.md) — wire の形と client / server の責務
- [DR-0002](DR-0002-server-api.md) — server 側 (`registrationOptions()` / `authenticationOptions()` が返す options JSON の形)
- issue `client-distribution-forms` — 配布形
- WebAuthn Level 3 (W3C Recommendation, 2026-08-25): §5.1 `toJSON()` / `isConditionalMediationAvailable()`、§5.1.3 conditionalCreate、§5.1.7 `getClientCapabilities()`、§5.1.8 / §5.1.9 `parse*OptionsFromJSON()`、§5.8.7 `ClientCapability`、§5.9 / §5.10 permissions policy と iframe、§7.1 step 2 (`InvalidStateError` の案内)、§10.1.1〜§10.1.5 拡張の JSON 形
- SimpleWebAuthn `@simplewebauthn/browser` 13: `startRegistration` / `startAuthentication` / `browserSupportsWebAuthn` / `platformAuthenticatorIsAvailable` / `browserSupportsWebAuthnAutofill` / `WebAuthnError` / `WebAuthnAbortService`
- webauthn-rs 0.6.1-dev: `webauthn-rs-proto` の `RequestRegistrationExtensions` / `RequestAuthenticationExtensions` / `Mediation`、`Webauthn::start_discoverable_authentication`
