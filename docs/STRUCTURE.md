# リポジトリ物理構造

```
passkey/
  README.md / README-ja.md
  LICENSE
  package.json              # bun workspaces のルート (private、公開しない)
  bun.lock
  tsconfig.json             # 全パッケージ共通の型設定 (typecheck はここから全体を見る)
  .oxlintrc.json / .oxfmtrc.json
  justfile                  # task runner (kawaz/bump-semver の justfile が canonical)
  packages/
    client/                 # @kawaz/passkey-client (ブラウザ側)
      package.json          # version の正本。ESM のみ、exports は dist/
      tsconfig.build.json   # dist/ (JS + 型定義) を出す設定
      src/index.ts
      test/                 # (予定) bun test
    server/                 # @kawaz/passkey-server (検証側、WebCrypto だけ)
      package.json
      tsconfig.build.json
      src/index.ts
      test/                 # (予定) bun test
  docs/
    DESIGN-ja.md / DESIGN.md
    STRUCTURE.md
    ROADMAP.md
    QUESTIONS.md            # 裁定・確認待ち
    decisions/INDEX.md      # DR 一覧
    issue/INDEX.md          # issue 一覧 (claude-local-issue plugin の形式)
```

version はパッケージごとに持ち、`just bump-version <client|server> [patch|minor|major]` で上げる。`just push` はパッケージごとに `src/` か型設定が `main@origin` から変わっていれば version が上がっていることを確かめる。
