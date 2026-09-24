# ロードマップ

将来検討項目のリスト。確定した予定ではなく、検討中のアイデアを集める場所。

## 短期 (= 直近着手候補)

- `@kawaz/passkey-client` の API を決めて ([client-api-from-three-webuis](./issue/2026-09-24-client-api-from-three-webuis.md)、[DR-0001](./decisions/DR-0001-client-api.md) 裁定待ち) 実装する
- `@kawaz/passkey-server` の API 裁定 ([DR-0002](./decisions/DR-0002-server-api.md)) と、認証時の埋め込み拒否の扱い ([QUESTIONS.md](./QUESTIONS.md) PK-Q1)
- client の配布形 (ESM bundle / `window.*` に載せる素の script / CSP nonce 下のインライン) を決める (DR-0001 が別 issue に切り出した項目)
- ccmsg 側の移行 (ccmsg の `docs/issue/2026-09-24-replace-webauthn-with-passkey-server.md`)

## 中期 (= 構想中)

- npm への公開と、ccmsg / webui 側をパッケージ利用へ切り替える
- 公開の CI (release workflow、provenance)

## 長期 / アイデア (= 検討初期)

- `none` 以外の attestation を必要とする利用者が出た時の扱い (今は対象外)

## 関連

- [decisions/INDEX.md](./decisions/INDEX.md) — 確定した設計判断
- [issue/](./issue/) — 具体的な TODO / 受領依頼
