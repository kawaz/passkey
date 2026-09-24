# ロードマップ

将来検討項目のリスト。確定した予定ではなく、検討中のアイデアを集める場所。

## 短期 (= 直近着手候補)

- kawaz のリポ群 (ccmsg / ccmsg-webui / cache-warden / hyoui) で passkey がどう使われているかを洗う ([survey-passkey-usage-in-kawaz-repos](./issue/2026-09-24-survey-passkey-usage-in-kawaz-repos.md))
- ccmsg の検証実装を `@kawaz/passkey-server` に移し、入力を Level 3 の `toJSON()` 形にする ([extract-server-from-ccmsg](./issue/2026-09-24-extract-server-from-ccmsg.md))
- 3 つの webui の使い方から `@kawaz/passkey-client` の API を決める ([client-api-from-three-webuis](./issue/2026-09-24-client-api-from-three-webuis.md))

## 中期 (= 構想中)

- npm への公開と、ccmsg / webui 側をパッケージ利用へ切り替える
- 公開の CI (release workflow、provenance)

## 長期 / アイデア (= 検討初期)

- `none` 以外の attestation を必要とする利用者が出た時の扱い (今は対象外)

## 関連

- [decisions/INDEX.md](./decisions/INDEX.md) — 確定した設計判断
- [issue/](./issue/) — 具体的な TODO / 受領依頼
