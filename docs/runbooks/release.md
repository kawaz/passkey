# Runbook: npm へのリリース

- Last Updated: 2026-09-28

## 適用ケース

`@kawaz/passkey-client` / `@kawaz/passkey-server` の新しい version を npm に公開し、GitHub Release を作るとき。

- パッケージが npm にまだ無い (初回) → 「初回 bootstrap」
- それ以降 → 「通常リリース」

## 前提

- version は `packages/<package>/package.json` が正本で、パッケージごとに独立に上がる
- tag / GitHub Release 名は `<package>-v<version>` (例: `client-v0.1.0`)。release は `.github/workflows/publish.yml` が作る
- publish は npm の trusted publishing (OIDC) だけで行い、npm token は GitHub に置かない
- 初回 bootstrap のみ: npmjs.com の `kawaz` アカウントでローカルの `npm login` 済み、`gh` が `kawaz/passkey` に書ける

## 初回 bootstrap

trusted publisher はパッケージが npm に存在しないと設定できないため、初回だけローカルから publish する。

1. **main を push してから build する** (手順 3 の release は push 済みの main を指す)
   ```bash
   just push
   just ci
   ```
   期待結果: push が通り、lint / typecheck / test / build も通って `packages/*/dist/` ができる

2. **各パッケージをローカルから publish する**
   ```bash
   (cd packages/client && npm publish --access public)
   (cd packages/server && npm publish --access public)
   ```
   期待結果: npmjs.com に `@kawaz/passkey-client` / `@kawaz/passkey-server` が現 version で出る

3. **初版の GitHub Release を作る** (workflow が同じ version を再 publish しようとして失敗するのを防ぐ。workflow はこの release を見て skip する)
   ```bash
   for p in client server; do
     v=$(bump-semver get "packages/$p/package.json" --no-hint)
     gh release create "$p-v$v" --repo kawaz/passkey --title "@kawaz/passkey-$p v$v" --target main --generate-notes
   done
   ```

4. **npmjs.com で Trusted Publisher を登録する** (パッケージごとに 1 回)
   各パッケージの Settings → Trusted Publisher → GitHub Actions で、Organization or user `kawaz` / Repository `passkey` / Workflow filename `publish.yml` を登録する。
   期待結果: 以降の publish は workflow からだけで通る

## 通常リリース

1. **version を上げる** (パッケージごと、Release commit ができる)
   ```bash
   just bump-version client minor   # client | server、patch (既定) | minor | major
   ```
   期待結果: `Release @kawaz/passkey-client v<version>` の commit

2. **push する**
   ```bash
   just push
   ```
   期待結果: `packages/*/package.json` の変更で `Publish` workflow が起動し、CI green の後、version が上がったパッケージだけ npm publish + `<package>-v<version>` の GitHub Release (tarball 添付) ができる。上がっていないパッケージは skip

workflow 自体を直した後に再走させる場合は、GitHub の Actions 画面から `Publish` を `workflow_dispatch` で起動する (既に release 済みの version は skip される)。

## 失敗時の切り分け

| 症状 | 原因 | 対処 |
|---|---|---|
| `check-version` が `is less than latest-tag` / `latest-release` で失敗 | package.json の version が既存 release より小さい | 正しい version に bump し直して push |
| `npm publish` が 404 / `ENEEDAUTH` | npmjs.com の Trusted Publisher 未登録、または owner / repo / workflow 名の不一致 | パッケージの Settings → Trusted Publisher を確認 (workflow filename は `publish.yml`) |
| `npm publish` が `cannot publish over the previously published versions` | npm に既にある version で GitHub Release が無い (bootstrap 手順 3 の漏れ等) | 該当 version の release を `gh release create <package>-v<version>` で作って再走、または version を上げる |
| npm には出たが release が無い | `Create release` step の失敗 | job を re-run せず `gh release create <package>-v<version> --target <commit>` を手で打つ (re-run すると publish で重複エラー) |
| publish は通ったが dist が空 / 古い | build 未実行の tarball | `Build` step のログを確認。ローカルで `just build && (cd packages/<package> && npm pack --dry-run)` で中身を確認 |

## 関連

- `.github/workflows/publish.yml`、`.github/scripts/check-version.sh`
- `justfile` の `bump-version` / `push` / `check-version-bumped`
