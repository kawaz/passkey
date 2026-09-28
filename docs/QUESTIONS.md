# 裁定・確認待ち一覧 (ユーザ用)

## 運用規約

<details>
<summary>ゼロコンテキストエージェント向け（本セクションは消さない）</summary>

- 裁定/確認待ち項目を 1項目=1ラベル=1セクション で記載
- ラベル形式: XX-Q1（XX は 2-3 文字、バッチやセッション内で一意、Qn単独の使い回し禁止、長期一意性は不要)
- 依頼形式: 「👺XX-Q1 の裁定お願いします」（参照用途ではラベルに👺を付けない。誤陽性がユーザのハイライト/アラームを汚す）
- チャット提示と同一ターンで本ファイルに記録 + path 指定 commit (push はリリース窓に同乗)
- 裁定が下りたら該当セクションを即削除し、内容は正規の記録先 (DR / issue / journal / close_reason) へ反映。本ファイルは常に「現在待ち」だけを持つ
- 参照は[]()で提示（リポ内は相対、リポ外はフルパス）
- 初版質問/依頼は長文で書かない（ユーザが説明を求めらたら本ファイルに説明を追加し、チャットで👺ラベルで再依頼）
- **選択肢・確認項目は `- [ ] a: …` 形式（チェックボックス + ラベル）で書く**。Q / C で記法を分けない。回答は「チェックを付ける」でも「XX-Q1a」と言葉で返すでも通る（複数まとめてチェックし「チェックしたよ」の一言で済ませる運用を想定）

</details>

## 裁定待ち

### 👺PK-Q4: `@kawaz/passkey-server` / `@kawaz/passkey-client` を npm に 0.1.0 で公開するか (時期含む)

ccmsg 側の置き換え (ccmsg の issue `replace-webauthn-with-passkey-server`) はローカルの file 参照で進めているが、ccmsg の CI / Publish は `bun install --frozen-lockfile` なので、ccmsg を push するには passkey-server が npm (または GitHub Release の tarball) で参照できる必要がある。両パッケージは DR-0001 / DR-0002 の全項目を実装済 (`just ci` 緑)。前提作業: passkey リポの未 push commit の push、release workflow (npm publish + provenance) の整備 (ROADMAP 中期の項目を前倒し)。

- [ ] a (推奨): 両パッケージを 0.1.0 で公開する。release CI を先に整え、`just push` → tag → npm publish の流れで出す (公開作業自体は kawaz の npm token が要るので手順を用意して依頼)
- [ ] b: server だけ先に 0.1.0 で公開 (client は配布形 DR-0003 の裁定後)
- [ ] c: まだ公開しない (ccmsg 側の push は待つ)

### 👺PK-Q5: DR-0003 (`@kawaz/passkey-client` の配布形) を accept するか

[DR-0003](./decisions/DR-0003-client-distribution.md): ESM + 型 (tsc、現状どおり) に加えて、専用 entry `src/iife.ts` から `bun build --format=iife` で単一ファイルを出す。hyoui は `<script src>` で `window.passkeyClient`、cache-warden は同じファイルを `include_str!` で CSP nonce 付きインラインに埋める。文字列 export の module は出さない。

- [ ] a (推奨): global 名 `passkeyClient`、minify なし + `.min.js` (sourcemap 付き) の 2 本、exports サブパスは `./iife` / `./iife.min` で accept
- [ ] b: min 1 本だけにする
- [ ] c: global 名を変える (チャットで名前を)
- [ ] d: その他 (チャットで)

## 確認待ち

(なし)
