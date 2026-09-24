# DR-0001: `@kawaz/passkey-client` の公開 API

- Status: Proposed (kawaz 裁定待ち)
- Date: 2026-09-24

## Context

client はブラウザの差 (`toJSON()` / `parse*OptionsFromJSON()` / `getClientCapabilities()` の有無、条件付き UI の対応) と、iframe / PWA での制約を吸収する層。3 つの webui (ccmsg-webui / hyoui / cache-warden) が個別に抱えている処理を 1 か所にまとめる。この DR は issue `client-api-from-three-webuis` の「決めること」5 項目 (登録 / 認証の入出力と失敗の区別、条件付き UI、可否判定、iframe / PWA、`toJSON()` 不在時の整形範囲) を決める。

判断の材料は [research/2026-09-24-passkey-usage-in-kawaz-repos.md](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) の表 2 (client に要る物) と論点 2 / 7 / 9 / 10 / 11 / 13 / 14。表 2 に無い要件は発明せず、推測で足すものは「候補」と明示する。

既に決まっていて覆さないこと:

- wire は Level 3 の `toJSON()` (camelCase)。利用者の snake_case は利用者側の境界で写す ([DESIGN-ja.md](../DESIGN-ja.md))
- server が認証で `crossOrigin` を拒否するかは `docs/QUESTIONS.md` PK-Q1 で裁定待ち。この DR はそれに依存せず、client は iframe 内の `get()` を事前に塞がない (hyoui が iframe 内で認証を試みる要件を持つ)

### 目的

- 3 client が別々に持つ base64url 化、options の JSON からの展開、結果の整形、失敗の分類を、1 つの関数群に置き換えられる
- wire の JSON は server が検証に使うものだけを運び、ページの外に出してはならない値 (PRF 出力) を混ぜない
- ブラウザが Level 3 の JSON API を持つかどうかで、利用者から見える入出力の形が変わらない

増やしたくないもの: options の中身を決める既定値 (rp / user / アルゴリズム / residentKey)。これは relying party の責務で、3 client で値が違う (research 論点 12 / 13)。client は options を JSON 形で受けて渡すだけにする。

### 前提条件

- 実行環境は secure context のブラウザ (`navigator.credentials` と `PublicKeyCredential` がある)。無い場合 `register()` / `authenticate()` は `kind: "failed"` で失敗し、`capabilities()` は全部 `false` を返す
- 利用者は options を Level 3 の JSON 形 (`PublicKeyCredentialCreationOptionsJSON` / `PublicKeyCredentialRequestOptionsJSON`) で用意できる。server が返すならそのまま、ページで組むなら base64url 文字列で組む (ccmsg-webui は challenge と user id を base64url 文字列で受けているので、`bufferOf` で開いていた箇所をそのまま文字列で置くだけで組める)
- ブラウザは `AuthenticatorAttestationResponse` の `getAuthenticatorData()` / `getPublicKey()` / `getPublicKeyAlgorithm()` / `getTransports()` を持つ。持たない場合の扱いは Decision 5 の未決点

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
  readonly kind: "declined" | "aborted" | "failed";
  /** ブラウザが投げた元の例外 (DOMException / TypeError)。`null` 応答と `PublicKeyCredential` 不在は client 自身の Error */
  override readonly cause: unknown;
}

export function capabilities(): Promise<PublicKeyCredentialClientCapabilities>;

export function context(): { embedded: boolean };
```

### 1. 登録 / 認証の入出力と、失敗の区別

入力は Level 3 の options JSON、出力は Level 3 の response JSON。options の JSON から `BufferSource` への展開 (`challenge` / `user.id` / `allowCredentials[].id` / `excludeCredentials[].id` / `extensions.prf` の `eval` と `evalByCredential` の `first` / `second`) と、結果の base64url 化は client が行う。`options` に無い項目 (timeout / hints / rpId / attestation) を client が補わない。

失敗は `PasskeyError` を throw し、`kind` で 3 つに分ける:

| `kind` | 元の事象 | 意味 |
|---|---|---|
| `declined` | `NotAllowedError`、`create()` / `get()` の `null` 応答 | passkey が提示されなかった。利用者の取り消しと、この origin の passkey が無いことと、埋め込みで permissions policy に拒まれたことを、ブラウザは同じ名前で返す (仕様 §5.1.3 / §5.1.4 の catch-all)。区別は利用者側が `context()` と組み合わせて行う |
| `aborted` | `AbortError` | 利用者側が渡した `signal` で止めた。条件付き UI を画面の unmount で畳む時に出る |
| `failed` | それ以外 (`SecurityError` / `NotSupportedError` / `ConstraintError` / `InvalidStateError` / `TypeError` / client 自身の展開失敗 / `PublicKeyCredential` 不在) | options か環境の問題。利用者には `message` を見せる |

`message` は元の例外の `message` をそのまま持つ (hyoui / cache-warden は message を画面に出しているので、その使い方が変わらない)。`cause` に元の例外を持たせ、`kind` より細かい判断はそこから行う。

`kind` を 3 つに絞る理由: 3 client が分岐に使っているのは「提示されなかった (登録の案内を出す)」(ccmsg-webui `session.ts:isSignInDeclined`) と「それ以外 (message を出す)」の 2 つで、条件付き UI の経路では「自分で止めた」が加わる (ccmsg-webui `state.ts:offerPasskey` は握りつぶすが、自分で止めた失敗を message に出さないための区別が要る)。これ以上の分類 (非対応 / 設定誤り / 登録済み) は利用者が使っていないので `cause` に残す。

`null` 応答を `declined` に畳む理由: ccmsg-webui は `null` を `NotAllowedError` と同じ扱いにしている (`client.ts` L162 / L221 → `AuthError("aborted")` → `isSignInDeclined`)。hyoui も `null` を「キャンセル」の message にしている (`auth.js` L212 / L253)。

### 2. 条件付き UI の開始・中断と、明示ボタンとの切り替え

条件付き UI は `authenticate()` の `controls` に `{ mediation: "conditional", signal }` を渡す。別関数にしない (options も結果の形も同じで、違いは `mediation` だけ)。`signal` は型で必須にする: 条件付き UI の要求は画面より長生きし (仕様 §5.1.4 で lifetimeTimer が無限)、止める手段が無いと畳めない。`signal` を持たない `{ mediation: "conditional" }` は型で弾く。

明示ボタンとの切り替えは利用者側の責務で、client は直列化しない。ccmsg-webui はボタン経路 (`state.ts:signIn`) を条件付き UI の要求を abort せずに並走させている (`SignIn.tsx` L25 の `offerPasskey` は unmount まで立ったまま)。client が「条件付き UI を持っている間は明示経路を拒む / 先に畳む」を勝手に行うと、この使い方を壊す。

呼ぶ前の判定は `capabilities()` の `conditionalGet` (仕様 §5.1: `isConditionalMediationAvailable()` が true と等価)。

`create()` の `mediation: "conditional"` (conditionalCreate) は扱わない。使う利用者が無く、`register()` の `controls` に `mediation` を持たない (目的の「表 2 に無い要件は発明しない」)。

### 3. 可否判定の粒度

`capabilities()` は仕様 §5.1.7 の `getClientCapabilities()` と同じ語彙 (`record<DOMString, boolean>`、キーは `ClientCapability` の列挙値と `extension:<識別子>`) で返す。意味も仕様のまま: `true` は使える、`false` は使えない、キーが無いのは不明。

ブラウザ差の吸収:

- `getClientCapabilities()` があればその結果をそのまま返す
- 無ければ `conditionalGet` を `isConditionalMediationAvailable()` から、`userVerifyingPlatformAuthenticator` を `isUserVerifyingPlatformAuthenticatorAvailable()` から作る。メソッド自体が無いキーは `false` (仕様 §5.1 の注記: `isConditionalMediationAvailable()` が無いなら条件付き UI は使えない)。他のキーは入れない (不明)
- `PublicKeyCredential` が無ければ `ClientCapability` の全キーを `false` で返す (何も使えないことは分かっている)

単一の bool にしない理由: 実利用は `conditionalGet` 1 つ (ccmsg-webui `client.ts:canOfferPasskey`) だが、それは「条件付き UI を出すか」の判断であって「passkey が使えるか」ではない。1 つの bool にすると、この 2 つを混ぜることになる。独自の型 (`{ conditional: boolean, platform: boolean }` 等) にしない理由: 仕様の語彙が既にあり、`extension:prf` のように将来の問い (cache-warden が「PRF が使えるか」を `create()` の前に知りたくなった時) も同じ形で答えられる。

`PublicKeyCredential` の有無だけを返す同期関数は持たない。`register()` / `authenticate()` が `failed` で答えるのと、`capabilities()` の全 `false` で足りる。

### 4. iframe / PWA の制約

呼ぶ前に分かる事実は `context()` で返し、呼んだ時の失敗は Decision 1 の `declined` に畳む。両方を持つ理由: permissions policy に拒まれた失敗は `NotAllowedError` で、利用者の取り消しと名前で区別できない (仕様 §5.9 と §5.1.4)。だから「埋め込まれているか」は呼ぶ前の事実として別に出す。

`context().embedded` は `window.top !== window.self`。hyoui がこの判定で登録を top-level に限り (`auth.js` L243)、認証では「別タブで開く」を併記している (`auth.js` L380) ので、その判断を client が代わりに行わず、事実だけ返す。client は `embedded` が true でも `register()` / `authenticate()` を塞がない: 認証は embedder が `allow="publickey-credentials-get"` を付けていれば通るし、通らなくても `declined` で返る。登録を top-level に限るかは利用者 (と server) の判断。

PWA (standalone 表示) は扱わない。3 client のどれも passkey の経路で standalone を区別しておらず (research 表 1 の PWA 行)、standalone で WebAuthn の可否が変わるという事実が無い。事実が出たら `context()` にキーを足す (この形なら追加で壊れない)。DESIGN の client 節に「PWA (standalone 表示) での制約」とあるのは、この DR の裁定後に本節の内容へ書き換える。

候補 (出典なし、未決): `document.permissionsPolicy.allowsFeature("publickey-credentials-get")` で埋め込み先の許可を呼ぶ前に読む。実装しているブラウザが限られ、無いブラウザでは「不明」しか返せないため、入れるなら `allowed: { create?: boolean; get?: boolean }` の形になる。どの利用者も呼ぶ前に判定していない (research 表 2 の候補行) ので、この DR では入れない。

### 5. `toJSON()` が無いブラウザでの自前整形の範囲

整形は常に client 自身が行い、ブラウザの `toJSON()` / `parse*OptionsFromJSON()` は使わない。出力は Level 3 の `RegistrationResponseJSON` / `AuthenticationResponseJSON` の全メンバー:

| メンバー | 出所 |
|---|---|
| `id` / `rawId` / `type` / `authenticatorAttachment` | `PublicKeyCredential` の属性。`authenticatorAttachment` は `null` なら省く |
| `response.clientDataJSON` / `attestationObject` / `authenticatorData` (認証) / `signature` | `response` の属性を base64url 化 |
| `response.userHandle` | `null` なら省く (仕様の optional)。hyoui は `null` を明示して送っているが、Level 3 の形では省略が正 |
| `response.authenticatorData` (登録) / `publicKey` / `publicKeyAlgorithm` / `transports` | `getAuthenticatorData()` / `getPublicKey()` (`null` なら省く) / `getPublicKeyAlgorithm()` / `getTransports()` |
| `clientExtensionResults` | `getClientExtensionResults()` を再帰的に base64url 化 (`ArrayBuffer` / `ArrayBufferView` を文字列に、それ以外はそのまま)。ただし `prf.results` は落とす (下記) |

`clientExtensionResults.prf.results` を wire の JSON から落とす。仕様 §10.1.4 は `toJSON()` がこれを含めることと、鍵導出に使う場合は server へ送る前に省く必要があることの両方を書いている。cache-warden は PRF 出力を vault の鍵素材として扱い、wire では別フィールド `prf_output` で 1 回だけ送る (`page.rs` L148 / L198)。server の検証は PRF 出力を使わない (research 表 3)。だから wire の形 (`json`) には載せず、ページの中で使う値は `extensions` (生の `getClientExtensionResults()`) から取る。`prf.enabled` は残す (鍵素材ではなく、登録時に PRF 対応を確かめる材料。cache-warden `page.rs` L134)。

自前に統一する理由 (ブラウザの `toJSON()` を優先しない): 出力を 1 つのコード経路で作ると、ブラウザごとの `toJSON()` の差 (含めるメンバー、拡張出力の扱い) が利用者に見えない。`prf.results` を落とす後処理はどちらにせよ要る。展開側も同じで、`parse*OptionsFromJSON()` は無いブラウザで自前が要り、自前だけにすれば経路が 1 つになる。コストは小さい (3 client が既に同じ処理を持っている)。

自前の展開が知っている拡張は `prf` だけ (仕様 §5.1.8: 展開は拡張入力にも及ぶが、どの文字列がバッファかは拡張ごとに違う)。他の拡張の入力は JSON のまま渡す。使う利用者が出たらその拡張を足す。

PRF の入力は options JSON の `extensions.prf` (Level 3 の `AuthenticationExtensionsPRFInputsJSON`: `eval.first` / `eval.second` / `evalByCredential[<base64url の credential id>].first`)。cache-warden の 3 経路 (登録 `prf: {}`、評価 `eval.first`、unlock `evalByCredential`) はこの形で表せる。

## Alternatives Considered

| 項目 | 不採用案 | 不採用理由 |
|---|---|---|
| 1 失敗の形 | 判別可能な結果型 `{ ok: true, ... } \| { ok: false, kind }` を返す | 3 client とも `await` + `try/catch` で書かれ、hyoui / cache-warden は message をそのまま表示する。結果型にすると分岐しない利用者にも分岐を強いる。throw なら `catch` の中で `kind` を見るだけで済む |
| 1 失敗の形 | `declined` を `null` 戻り値で返し、例外は失敗だけにする | ccmsg-webui が `null` を例外 (`AuthError("aborted")`) に揃えている方向と逆で、利用者が `null` 検査と `catch` の両方を書くことになる |
| 1 失敗の形 | `kind` を 5 つ以上に分ける (非対応 / 設定誤り / 登録済み 等) | 使う利用者が無い。`cause` に元の例外があるので、要る時に利用者が見られる |
| 2 条件付き UI | `offerConditional(options): () => void` のような別関数 | options と結果の形が同じで、違いは `mediation` だけ。別関数にすると失敗の形と結果の形を 2 つ持つ |
| 2 条件付き UI | client が条件付き UI の `AbortController` を内側に持ち、明示経路を呼んだら先に畳む | ccmsg-webui はボタン経路を条件付き UI と並走させている。client が畳むと、ボタンを押した瞬間に条件付き UI の promise が `aborted` で落ち、利用者側の握りつぶしに依存する |
| 3 可否判定 | `canOfferPasskey(): Promise<boolean>` (ccmsg-webui の形) だけ | 「条件付き UI を出すか」と「passkey が使えるか」を 1 つの bool に混ぜる。UVPA や `extension:prf` を後から足せない |
| 3 可否判定 | 独自の型 `{ conditional, platform, prf }` | 仕様に同じ意味の語彙があり、独自名は利用者に対応表を強いる。`getClientCapabilities()` がある環境ではそのまま返せる方が差が出ない |
| 4 iframe | `embedded` が true なら `register()` を client が塞ぐ | 登録を top-level に限るかは relying party の判断 (hyoui は client と server の両方で限っているが、ccmsg-webui は埋め込まれない前提でそもそも判定しない)。塞ぐと `declined` と区別する新しい `kind` も要る |
| 4 iframe | 事実を返さず、呼んだ時の `declined` だけにする | permissions policy の拒否と利用者の取り消しが同じ名前なので、hyoui の「別タブで開く」を出す判断ができなくなる |
| 5 整形 | ブラウザの `toJSON()` / `parse*OptionsFromJSON()` があれば使い、無い時だけ自前 | 出力がブラウザによって変わる (2 経路)。`prf.results` を落とす後処理はどちらにも要る。自前 1 経路の方がテストと挙動が 1 つになる |
| 5 整形 | `clientExtensionResults` / `authenticatorAttachment` / `transports` / `publicKey` を出さず、server が読む最小 (`clientDataJSON` + `attestationObject` / `authenticatorData` + `signature`) だけ出す | wire を Level 3 の形に固定した決定に反する。server を別実装に替えた時に足りなくなる |
| 5 PRF | `prf.results` も `json` に含め、落とすのは利用者の責務にする | 仕様が `toJSON()` の挙動として明記する通り、含めると `JSON.stringify(json)` でそのまま鍵素材が出る。cache-warden の「PRF 出力は 1 回 post して参照を捨てる」規則を client が壊す |
| 5 PRF | `extensions` を返さず、`register()` / `authenticate()` が生の `PublicKeyCredential` を返して整形は別関数 | 利用者が全員 2 段で書くことになる。cache-warden 以外は `extensions` を読まないが、読まないフィールドが 1 つ増えるだけで済む |
| 入力経路 | ページで組む経路 (ccmsg-webui) 用に `rp` / `user` / アルゴリズムを補う builder を持つ | 3 client で値が違い、client が既定を持つとどれかに寄る (research 論点 12 / 13)。JSON 形は文字列で組めるので builder 無しで組める |
| 配布形 | この DR で ESM / 素の script / CSP nonce 下のインラインを決める | 扱わない。配布形は API の形を変えない (同じ関数群を ESM でも IIFE でも文字列でも出せる) ので、build の話として別 issue に切る。API 側に課す制約だけ Consequences に書く |

## Consequences

- 利用者側の境界で写す作業: ccmsg-webui と cache-warden は camelCase の `json` から自分の snake_case 契約へ写す (決定済みの方針)。hyoui は `clientExtensionResults` を `extensions` の名で受けているので、名前の違いと `userHandle` が `null` でなく省略で来ることを hyoui 側で吸収する
- `prf.results` は `json` に無い。PRF を使う利用者は `extensions.prf?.results?.first` から取り、wire に載せるなら自分の別フィールドで送る
- 拡張の展開は `prf` だけ。他の拡張を JSON 形で渡す利用者が出たら、展開規則をこの DR に足す
- 配布形の DR / issue に対して API が課す制約: top-level の副作用を持たない、外部依存を持たない、動的 import を使わない (CSP nonce 下のインライン 1 本と `window.*` の IIFE の両方をこの 1 つのソースから出せるように)
- server 側 (PK-Q1) がどう裁定されても client は変わらない。`context().embedded` の事実と `declined` の失敗だけを返し、埋め込みでの認証を通すかは server と利用者が決める
- DESIGN の client 節は「可否判定」を `capabilities()` の語彙に、「PWA での制約」を「扱わない」に書き換える (裁定後)

### 未決 (kawaz 裁定)

1. `getAuthenticatorData()` / `getPublicKeyAlgorithm()` / `getTransports()` を持たないブラウザで、`RegistrationResponseJSON` の必須メンバー `response.authenticatorData` / `publicKeyAlgorithm` / `transports` をどうするか。案 a: `attestationObject` を client で最小限 CBOR 読みして埋める (client に CBOR が入る)。案 b: 省き、client の出力型でこれらを optional にする (Level 3 の型から逸脱。server の検証は `attestationObject` から読むので検証は通る)。案 c: そのブラウザを対象外として `failed` にする。推奨は b。理由: 3 server とも `attestationObject` から読み、これらのメンバーを消費していない (research 表 3 に該当行なし)。`transports` は `[]` で埋められるので b でも省くのは 2 つ
2. `clientExtensionResults.prf.results` を wire の `json` から落とす (Decision 5)。「wire は `toJSON()` の形」からの唯一の逸脱で、仕様が省略を認める根拠を挙げたが、決定の例外として承認が要る
3. PWA (standalone) を「扱わない」でよいか。DESIGN の client 節が挙げている項目を落とすことになる
4. `context()` に permissions policy の事前読み取り (Decision 4 の候補) を入れるか。この DR では入れない案で書いた
5. 整形を常に自前にし、ブラウザの `toJSON()` / `parse*OptionsFromJSON()` を使わない (Decision 5)。「有無というブラウザ差を吸収する」を「使わないことで吸収する」と解釈した。ブラウザ実装を優先したい場合は Alternatives の「5 整形」1 行目 (あれば使い、無い時だけ自前) に戻す

## 受け入れ条件の突き合わせ: research 表 2 × 採用案

| 表 2 の要る物 | 区分 | 採用案でどう満たすか |
|---|---|---|
| `create()` / `get()` の呼び出しと結果の base64url 化 | 必須 | `register()` / `authenticate()` が行い、`json` に Level 3 の形で出す |
| JSON 形の options を ArrayBuffer に開く | 必須 | 入力を Level 3 の options JSON に固定し、`challenge` / `user.id` / `allowCredentials[].id` / `excludeCredentials[].id` / `extensions.prf` を client が開く |
| options をページ側で組む経路 (server は challenge だけ返す) | ccmsg-webui | 同じ JSON 形をページで組む。challenge と user id は既に base64url 文字列なのでそのまま置ける。builder は持たない |
| `mediation: "conditional"` と `AbortSignal` による開始・中断 | ccmsg-webui | `authenticate(options, { mediation: "conditional", signal })`。unmount で `signal` を abort すると `aborted` |
| `isConditionalMediationAvailable()` による可否判定 | ccmsg-webui | `capabilities()` の `conditionalGet` |
| `null` と `NotAllowedError` / `AbortError` を「中断・passkey 無し」として区別できる形 | ccmsg-webui | `PasskeyError.kind` の `declined` (`null` + `NotAllowedError`) と `aborted`。ccmsg-webui の `isSignInDeclined` は `kind !== "failed"` に置き換わる |
| 拡張 (PRF) の入力と `getClientExtensionResults()` の生の値の受け渡し | cache-warden | 入力は options JSON の `extensions.prf` (`eval` / `evalByCredential`)。生の値は `RegistrationResult.extensions` / `AuthenticationResult.extensions`。`json` には `prf.results` を含めないので、`prf_output` を別フィールドで送る現行の運用がそのまま成り立つ |
| 登録を top-level に限るための「今 iframe 内か」の判定 | hyoui | `context().embedded` |
| 結果の `userHandle` を載せる | ccmsg-webui (任意) / hyoui (必須) | `json.response.userHandle` (非 `null` の時)。hyoui は `null` 明示から省略に変わるので、hyoui 側の serde で optional として受ける |
| 結果の拡張結果 (`clientExtensionResults`) を載せる | hyoui | `json.clientExtensionResults` (`prf.results` 以外)。hyoui は `extensions` の名で受けているので、hyoui 側で名前を写す |
| Level 3 `toJSON()` 形 (camelCase) で出す | hyoui が近似 | `json` は Level 3 の形。ccmsg-webui と cache-warden は境界で snake_case に写す (決定済み) |
| CSP nonce 下のインライン script として埋め込める配布形 | cache-warden | この DR では扱わない (別 issue)。API 側は副作用・外部依存・動的 import を持たない制約を課す |
| bundler を通さない素の script (`window.*`) | hyoui | 同上 |
| `isUserVerifyingPlatformAuthenticatorAvailable()` / `getClientCapabilities()` | 候補 | `capabilities()` が両方を仕様の語彙に畳む |
| iframe の permissions policy / PWA standalone の事前判定 | 候補 | `context().embedded` のみ。permissions policy の読み取りは未決 4、PWA は扱わない (未決 3) |
| `hints` / `timeout` の指定 | 不要 | options JSON に入っていればそのまま渡る。client は補わない |
| `parseCreationOptionsFromJSON()` / `toJSON()` のネイティブ API | 不要 | 使わない (Decision 5) |

## 関連

- [research/2026-09-24-passkey-usage-in-kawaz-repos.md](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) — 表 2 と論点 2 / 7 / 9 / 10 / 11 / 13 / 14
- [DESIGN-ja.md](../DESIGN-ja.md) — wire の形と client / server の責務
- [QUESTIONS.md](../QUESTIONS.md) PK-Q1 — server が認証で `crossOrigin` を拒否するか (この DR は依存しない)
- WebAuthn Level 3 (W3C Recommendation, 2026-08-25): §5.1 `toJSON()` / `isConditionalMediationAvailable()`、§5.1.7 `getClientCapabilities()`、§5.1.8 / §5.1.9 `parse*OptionsFromJSON()`、§5.9 / §5.10 permissions policy と iframe、§10.1.4 prf 拡張
