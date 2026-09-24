# Decision Records 一覧

Status は各 DR ファイルの `Status:` 行が正本。ここに載るのは今立っている DR だけ。

状態は絵文字とラベルだけ。日付・Phase・裁定の内訳は各 DR 本文に書く。

- `💭 提案`: Decision がまだ裁定されていない。実装に着手しない (本文の `Status: Proposed`)
- `✅ 実装済`: Decision の全部に実装エビデンスがある
- `🟡 部分実装`: 一部のみ実装
- `⬜ 未実装`: 裁定済みで設計のみ、実装エビデンスなし (着手してよい)
- `🚧 進行中`: 実装の途中
- `N/A`: 実装対象でない (命名・思想・プロセス等)
- `❌ 撤退`: 撤退判断済

| DR | 状態 | 説明 |
|---|---|---|
| [DR-0001](DR-0001-client-api.md) | 💭 提案 | `@kawaz/passkey-client` の公開 API: Level 3 JSON の入出力、失敗の 4 区分 (`declined` / `excluded` / `aborted` / `failed`)、条件付き UI は `mediation` + 必須 `signal`、可否は `getClientCapabilities()` の語彙、`context()` は `embedded` / `standalone` / `allowed` (permissions policy)、整形は常に自前で §10 の 5 拡張を展開し `prf.results` を wire に載せない |
| [DR-0002](DR-0002-server-api.md) | 💭 提案 | `@kawaz/passkey-server` の公開 API: `registrationOptions` / `authenticationOptions` で Level 3 の options JSON を生成 (状態なし)、`verifyRegistration` / `verifyAuthentication` / `challengeOf` は §7.1 / §7.2 の全項目 (origin / rpId 複数受け、`topOrigins` 許可リスト、BE / BS 整合、alg、credential id 長、userHandle 照合、transports) を持ち、`publicKey` は COSE 鍵そのままの base64url、失敗は `PasskeyVerificationError` の `reason`、依存は WebCrypto だけ (Node / Bun / Deno 実測済) |
