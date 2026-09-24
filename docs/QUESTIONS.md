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

### 👺PK-Q2: DR-0001 (`@kawaz/passkey-client` の公開 API) を accept するか

[DR-0001](./decisions/DR-0001-client-api.md) は `Status: Proposed`。本文「未決 (kawaz 裁定)」5 点の推奨で accept するなら a にチェック。個別に変えるなら b 以降で指定。

- [ ] a (推奨): 未決 5 点とも DR の推奨どおり (1: getter の無いブラウザは該当メンバーを省く / 2: `prf.results` は wire から落とす / 3: PWA standalone は扱わない / 4: permissions policy の事前読み取りは入れない / 5: 整形は常に自前) で accept
- [ ] b: 未決 1 を a 案 (client に最小 CBOR を入れて埋める) にする
- [ ] c: 未決 5 を「ブラウザの `toJSON()` があれば使う」にする
- [ ] d: その他 (チャットで)

統括の評価: 5 項目とも 3 client の実コードから導かれ、発明は無い。`prf.results` を落とすのは仕様 §10.1.4 が省略を求める場面そのもので、DESIGN の「wire は toJSON の形」の例外として妥当。整形の自前一本化はテスト経路が 1 つになる利点が大きい。

### 👺PK-Q3: DR-0002 (`@kawaz/passkey-server` の公開 API) を accept するか

[DR-0002](./decisions/DR-0002-server-api.md)。実装は `packages/server` に入っており `just ci` 緑、Node 26 / Bun 1.3 / Deno 2.9 で登録+認証を実機確認済み。未決は入力型 1 点。

- [ ] a (推奨): 入力型を「読むメンバーだけの構造的部分型」にして accept (Level 3 の `json` はそのまま渡せる。ccmsg の境界でダミー値が要らない)
- [ ] b: 入力型を lib.dom の `RegistrationResponseJSON` / `AuthenticationResponseJSON` そのままにして accept
- [ ] c: その他 (チャットで)

## 確認待ち

(なし)
