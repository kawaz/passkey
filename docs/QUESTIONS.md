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

### 👺PK-Q1: server は認証 (assertion) で埋め込み (`crossOrigin` / `topOrigin`) をどう扱うか

[DR-0002](./decisions/DR-0002-server-api.md) Decision 5 の形: 既定は拒否、`expected.topOrigins: string[]` (許可する親ページの origin) に一致する `topOrigin` なら通す (SimpleWebAuthn の `expectedTopOrigin` と同型、仕様 §7.2 の「RP が期待する埋め込み元か検証」に沿う)。残る裁定は Safari が `topOrigin` を送らない場合の既定。

- [ ] a (推奨): `embeddedWithoutTopOrigin` の既定は `"reject"`。hyoui のように Safari の iframe でも通したい利用者だけ `"allow"` を明示 (その時の埋め込み元の検証は `origin` + `rpIdHash` だけ)
- [ ] b: 既定 `"allow"` (現行 hyoui と同じ緩さが既定になる)
- [ ] c: 登録・認証とも拒否固定、option 無し (hyoui の iframe 内サインインは対象外)

### 👺PK-Q2: DR-0001 (`@kawaz/passkey-client` の公開 API) を accept するか

[DR-0001](./decisions/DR-0001-client-api.md) を「使っていない機能を削らず、仕様 §7 と SimpleWebAuthn / webauthn-rs の共通機能は持つ」基準で改訂済み。未決 2 点。

- [ ] a (推奨): 未決 2 点とも DR のとおり (`kind` に `excluded` を足す / `context().allowed` で permissions policy を事前に読む) で accept
- [ ] b: `excluded` は足さない (3 値のまま、`cause.name` で見る)
- [ ] c: `context().allowed` は持たない
- [ ] d: その他 (チャットで)

条件付き登録 (conditionalCreate) は仕様が UP / UV 無しを前提にするため、DESIGN の UV 必須と衝突し不採用にしている。UV 必須を緩めない限り持てないので、ここは基準 3 (譲らない点) の帰結として了承してほしい。

### 👺PK-Q3: DR-0002 (`@kawaz/passkey-server` の公開 API) を accept するか

[DR-0002](./decisions/DR-0002-server-api.md) を同じ基準で改訂済み (options 生成 2 関数の追加、origin / rpId の複数受け、`topOrigins`、BE / BS の整合検査、`algorithms`、`userHandle` 照合 option、`transports` 返却)。実装は改訂前の範囲で入っており、差分は DR 末尾の「実装 TODO」。未決は PK-Q1 のほかに 2 点。

- [ ] a (推奨): 入力型は読むメンバーだけの部分型、BE の false → true 昇格は仕様どおり拒否 (option 無し) で accept
- [ ] b: BE の昇格を通す option (`allowBackupEligibleUpgrade` 相当) を持つ
- [ ] c: 入力型は lib.dom の Level 3 型そのまま
- [ ] d: その他 (チャットで)

## 確認待ち

(なし)
