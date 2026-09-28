# DR-0003: `@kawaz/passkey-client` の配布形

- Status: Proposed
- Date: 2026-09-28

## Context

`@kawaz/passkey-client` の利用者 3 つは取り込み方が違う (research 論点 11 と表 2)。

| 利用者 | 取り込み方 | 要る配布形 |
|---|---|---|
| ccmsg-webui | bundler を通す | ESM と型定義 |
| hyoui | bundler を通さず、`window.*` に載った関数を素の script から呼ぶ | 単一ファイルの IIFE |
| cache-warden | CSP `default-src 'none'` / `script-src 'nonce-…'` のページにインライン script 1 本として埋める。外部 script は読めない | ページに文字列として埋められる単一ファイル |

DR-0001 は配布形を扱わず、API 側に「top-level の副作用を持たない、外部依存を持たない、動的 import を使わない」の制約を課した。この DR はその 1 つのソースから 3 利用者向けの成果物をどう出すかを決める。

今の build は `just build` の `bun x tsc -p packages/<p>/tsconfig.build.json` だけで、`dist/` に ESM (`.js` + `.d.ts`) を出す。

手元の bun 1.3.13 で確かめた事実:

- `bun build --format=iife` は `(() => { ... })();` を出すが、global 名を指定するオプションが無い。`src/index.ts` を entry に直接 bundle すると export は捨てられ (外から触れない)、相対 import の `./ceremony.js` 等が bundle に入らず `__require` の呼び出しとして残る
- global への代入だけを書いた entry (`import * as m from "./index.ts"; globalThis.passkeyClient = m;`) を entry にすると 6 module が 1 ファイルに入り 12.16 KB、`require(` は 0 件。`new Function("globalThis", src)(w)` で評価すると `w.passkeyClient` に `register` / `authenticate` / `capabilities` / `context` / `PasskeyError` が載り、`register` は function
- 使えるオプションは `--target=browser`、`--format=esm|cjs|iife`、`--minify`、`--sourcemap=linked|inline|external|none`、`--outfile`、`--banner` / `--footer`

比較対象: SimpleWebAuthn `@simplewebauthn/browser` は npm の ESM に加えて `dist/bundle/index.umd.min.js` (UMD、minify 済み、global `SimpleWebAuthnBrowser`) を出し、CDN の `<script>` 利用を想定している。

## Decision

### 1. dist の出力形: ESM と IIFE の 2 つ

- ESM は今のまま `bun x tsc` で `dist/index.js` と `dist/*.d.ts` (npm の `exports["."]`、bundler 利用者向け)
- IIFE を `bun build` で追加する。entry は専用の `src/iife.ts` で、中身は `import * as passkeyClient from "./index.js"; globalThis.passkeyClient = passkeyClient;` の 2 行だけ。global への代入という副作用は IIFE 用 entry だけに置き、`index.ts` 以下は DR-0001 の制約 (top-level の副作用なし) を保つ
- global 名は `passkeyClient` (提案、未決 1)。値は名前空間オブジェクトなので lowerCamel (`PasskeyClient` はクラスに見える)。npm scope の `kawaz` を名前に入れないのは、利用者が 1 ページに別の passkey client を並べる状況が無く、短さを優先するため
- 出力は `dist/passkey-client.iife.js` (minify なし) と `dist/passkey-client.iife.min.js` (`--minify`) の 2 つ。minify なしはインラインで埋めた時にページのソース上で読める・CSP 違反や例外の位置を追える用、min は転送量を気にする利用者用。どちらも `--target=browser`
- sourcemap は min にだけ `--sourcemap=linked` で `dist/passkey-client.iife.min.js.map` を付ける。minify なしは sourcemap 不要 (ソースがほぼそのまま読める)。インライン利用ではページ側に map の URL が解決できないので、インライン埋め込みには minify なしを勧める

### 2. CSP nonce 下のインライン利用: IIFE のファイルをそのまま文字列として取り込めば足りる

文字列を export する module は出さない。IIFE の単一ファイルは外部参照を持たない自己完結の script なので、利用者が自分の build で文字列として読み、`<script nonce="…">` の中身に置けば動く。取り込み方は利用者側の道具に任せる。

- Rust (cache-warden): npm から取った `dist/passkey-client.iife.js` をリポに vendoring し `include_str!` で読む
- TS / Bun: `import src from "@kawaz/passkey-client/iife" with { type: "text" };`

埋め込み時の注意 (README に書く): 文字列に `</script` が含まれないことを `just ci` で検査する。含まれるとインライン script がそこで切れる。

### 3. package.json の `exports` / `files`

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
  "./iife": "./dist/passkey-client.iife.js",
  "./iife.min": "./dist/passkey-client.iife.min.js"
}
```

- `files` は今の `["dist"]` のままで IIFE と map も入る
- `sideEffects` は `false` から `["./dist/passkey-client.iife*.js"]` に変える (IIFE は global への代入が本体。ESM 側は副作用なしのまま)
- CDN 配信 (jsdelivr / unpkg) は npm 公開すれば追加作業なしで `https://cdn.jsdelivr.net/npm/@kawaz/passkey-client@<ver>/dist/passkey-client.iife.min.js` として届くので想定に入れる。README に version 固定の URL と SRI (`integrity`) の付け方を載せる。CDN 向けの `jsdelivr` / `unpkg` フィールドは足さない (パスを明示する方が version 固定と SRI の案内と揃う)

### 4. build の実行主体と `just ci` での検証

`build` recipe で client の時だけ 2 段目を足す。

1. `bun x tsc -p packages/<p>/tsconfig.build.json` (今のまま、全パッケージ)
2. client だけ `bun build packages/client/src/iife.ts --target=browser --format=iife --outfile=packages/client/dist/passkey-client.iife.js` と、同じ引数に `--minify --sourcemap=linked` を足して `.iife.min.js`

`src/iife.ts` は `tsconfig.build.json` の include に入るので tsc も `dist/iife.js` / `dist/iife.d.ts` を出す。これは `exports` に載せないので利用者から見えないが、紛らわしいので `tsconfig.build.json` の `exclude` に `src/iife.ts` を入れる。

検証は bun test に置く (`just ci` の `test` は `build` より前に走るので、検証 test は自分で `Bun.build` を呼んで IIFE を作る。`build` の成果物に依存させない):

- `new Function("globalThis", src)(fake)` で評価し、`fake.passkeyClient` の `register` / `authenticate` / `capabilities` / `context` が function、`PasskeyError` が class であること。評価時に `navigator` 等に触れない (top-level の副作用なし) ことも、`fake` 以外を渡さない評価が例外なく通ることで兼ねる
- 出力に `require(` / `import(` / `</script` が含まれないこと (外部依存なし・動的 import なし・インライン埋め込み可)
- minify あり・なしの両方で上の 2 つ

### 5. 不採用の案

- UMD (SimpleWebAuthn の形): AMD / CommonJS の分岐は、ESM を持つ bundler 利用者と素の script 利用者の 2 経路には不要。bun は UMD を出せず、自前のラッパを書くと IIFE より分岐が増えるだけ
- CJS: 3 利用者に CJS の消費者がいない。Node で client を動かす用途も無い (ブラウザ API 前提)
- `<script type="module">` だけで済ませる (IIFE を出さない): hyoui は bundler を通さず、既存の素の script から `window.*` の関数を呼ぶ形なので、module script から global に載せ直すラッパを利用者に書かせることになる。cache-warden のインライン 1 本も、module の `import` 文は外部取得を伴い CSP `default-src 'none'` で読めない。ESM を bundle した単一 module ファイルならインラインにできるが、その場合も export を外から触る手段が無く、結局 global への代入が要る
- 文字列を export する module (`export default "…"`): 利用者の道具 (`include_str!` / `with { type: "text" }`) で IIFE ファイルを直接読めるので、二重に持つ意味が無い

## Alternatives Considered

- global 名 `PasskeyClient`: 不採用。class でないものに UpperCamel を付けると `new` できそうに見える
- global 名 `kawazPasskey`: 不採用。衝突回避の効果が乏しく、server 側を含む名前に見える
- `--footer` で `globalThis.passkeyClient = …` を足す (entry ファイルを増やさない): 不採用。bun の IIFE は export を外に出さないので footer から参照する名前が無い
- minify ありだけを出す: 不採用。インライン埋め込みで map が効かず、ページで起きた例外の位置を追えない

## Consequences

- client の `build` は tsc と bun build の 2 段になり、`dist/` に IIFE 2 本と map 1 本が増える
- `src/iife.ts` は global への代入だけを持つ唯一の副作用ファイルになる。他のファイルに top-level の副作用を足すと IIFE の評価 test で検出する
- cache-warden は IIFE を vendoring するので、client の version を上げた時は利用者側で取り直す必要がある
- IIFE の中身は ESM と同じソースなので API の変更は両方に同時に反映される。型定義は ESM 側だけで、素の script 利用者には型が付かない

## 未決 (kawaz 裁定)

1. global 名: `passkeyClient` でよいか
2. minify なしと min の 2 本を出すか、min だけにするか (インライン利用で読める方を残したいかどうか)
3. `exports` のサブパス名: `./iife` / `./iife.min` でよいか

## 関連

- [DR-0001](DR-0001-client-api.md) — Consequences の「配布形の issue に対して API が課す制約」
- [research/2026-09-24-passkey-usage-in-kawaz-repos.md](../research/2026-09-24-passkey-usage-in-kawaz-repos.md) — 論点 11 と表 2
- issue `client-distribution-forms`
- bun build (bun 1.3.13 の `bun build --help`): `--format`、`--target`、`--minify`、`--sourcemap`、`--outfile`
- SimpleWebAuthn `@simplewebauthn/browser` 13: ESM と `dist/bundle/index.umd.min.js`
