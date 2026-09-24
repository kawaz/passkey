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

### 👺PK-Q1: server は認証 (assertion) でも `crossOrigin` / `topOrigin` を拒否するか

- [ ] a (推奨): 登録は拒否固定、認証は既定で拒否しつつ `allowEmbedded` 相当の option で通せるようにする
- [ ] b: DESIGN のまま登録・認証とも拒否固定 (hyoui は `@kawaz/passkey-server` の対象外として扱う)
- [ ] c: 認証は crossOrigin を見ない (hyoui の決定 6 に揃える)

[DESIGN-ja.md](./DESIGN-ja.md) の server 節は「登録・認証とも埋め込みを拒否、緩める option を持たない」だが、hyoui の DR-0036 決定 6 は ccmsg-webui の Terminal タブ (cross-origin iframe) 内でのサインインを通すため認証で `crossOrigin` を見ない (`hyoui:crates/hyoui-web/src/auth/webauthn.rs:finish_authentication` のコメント。Chrome は cross-origin iframe の `get()` で `crossOrigin: true` を送る)。出典は [research](./research/2026-09-24-passkey-usage-in-kawaz-repos.md) 論点 3。a を推す理由: 登録の top-level 限定は「credential の作成元を保証する」責務で崩さず、認証は rpIdHash + origin 一致で「この RP のページで get が走った」を担保できるので、iframe 認証を要する利用者が明示 opt-in する形なら DESIGN の「厳しい既定」を保てる。b は hyoui が将来 TS 化しても乗れない、c は既定が緩む。

## 確認待ち

(なし)
