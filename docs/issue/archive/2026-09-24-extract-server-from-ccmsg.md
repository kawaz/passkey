---
title: "ccmsg の WebAuthn 検証を @kawaz/passkey-server に移す"
status: resolved
category: task
created: 2026-09-24T13:52:35+09:00
last_read:
open_entered: 2026-09-24T13:52:35+09:00
wip_entered: 2026-09-24T14:46:57+09:00
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered: 2026-09-24T14:57:22+09:00
discard_reason:
pending_reason:
close_reason: ["implemented", "dr/DR-0002", "done:packages/server に移植完了 (commit aec1fd11)", "done:just ci 緑、Node/Bun/Deno 実機確認を DESIGN に反映", "done:DR-0002 を Proposed で起票 (PK-Q3 裁定待ち)", "done:ccmsg 側の移行は ccmsg の docs/issue/2026-09-24-replace-webauthn-with-passkey-server.md に起票済み"]
blocked_by:
origin: 自リポ TODO
---

# ccmsg の WebAuthn 検証を @kawaz/passkey-server に移す

## 概要

kawaz/ccmsg の検証実装を `@kawaz/passkey-server` に移す。入力の形を Level 3 の `toJSON()` (camelCase) に変え、ccmsg 側は自分の契約の snake_case を境界で写してパッケージを使う。

## 移す物

- `src/auth/webauthn.ts` (登録・認証の検証、公開鍵の検査、ES256 / EdDSA / RS256)
- `src/auth/cbor.ts` (CBOR の読み取り)
- `test/webauthn.test.ts` / `test/webauthn-library-grade.test.ts` / `test/cbor.test.ts` / `test/authenticator.ts` (テスト用の authenticator)
- 差分テストが使う `@simplewebauthn/server` は devDependency のまま持ってくる (runtime 依存にしない)

## 背景

ccmsg の実装は WebCrypto だけで動き、`none` attestation、UV + UP 必須、埋め込み (crossOrigin / topOrigin) 拒否という方針がこのリポの DESIGN と一致する。自前実装とライブラリの比較は ccmsg の `docs/research/2026-09-24-webauthn-own-vs-libraries.md` にある (規模・機能・実行環境・適合と、自前を続ける条件)。

## 受け入れ条件

- [ ] `@kawaz/passkey-server` が Level 3 の `RegistrationResponseJSON` / `AuthenticationResponseJSON` を受け取り、期待値 (challenge / origin / rpId、認証では保存済みの公開鍵と sign count) と照合して結果を返す
- [ ] ccmsg の既存テストが同じ検査項目のまま新パッケージで通る (入力の形の変更に伴う書き換え以外で assert を緩めない)
- [ ] 差分テスト (`@simplewebauthn/server` との突き合わせ) が動く
- [ ] ccmsg 側の移行 (境界での snake_case → camelCase の写し、`src/auth/webauthn.ts` / `cbor.ts` の削除) は ccmsg の `docs/issue/` に別途起票する
- [ ] Node / Bun / Deno のどれで動くかを実機で確認して DESIGN に書く
