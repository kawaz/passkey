---
title: "kawaz のリポ群で passkey がどう使われているかを洗う"
status: open
category: task
created: 2026-09-24T13:52:35+09:00
last_read:
open_entered: 2026-09-24T13:52:35+09:00
wip_entered:
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered:
discard_reason:
pending_reason:
close_reason:
blocked_by:
origin: 自リポ TODO
---

# kawaz のリポ群で passkey がどう使われているかを洗う

## 概要

ccmsg / ccmsg-webui / cache-warden / hyoui で passkey をどう使っているかを洗い、`@kawaz/passkey-client` と `@kawaz/passkey-server` に要る物を列挙する。

## 背景

2 パッケージの API は既存の利用者の形から決める。推測で API を先に立てると、移行時に写しの層が要るか、どこかの利用者の要件が落ちる。

## 調べる項目

リポごとに:

- client の呼び出し: `navigator.credentials.create` / `get` の options (rp / user / pubKeyCredParams / authenticatorSelection / extensions / timeout / hints / mediation)、結果をどう整形して送っているか、`toJSON()` を使っているか
- 条件付き UI (autofill) の有無と、開始・中断の流れ
- 可否判定: どの API で、どの時点で判定し、使えない時に何を出すか
- iframe / PWA (standalone) で動かす場面があるか、そこでの失敗をどう扱っているか
- server の検証: どこで、何の実装で (自前 / ライブラリ)、何を検査しているか (attestation、アルゴリズム、UP / UV、origin / rpId、crossOrigin / topOrigin、sign count、BE / BS)
- wire の形: 登録・認証で client から server へ送る JSON の命名 (camelCase / snake_case) と中身
- cache-warden は DR-0034 の vault ceremony で passkey をどう使うか (他と違う用途なら、その違いが API に何を要求するか)

## 受け入れ条件

- [ ] 4 リポの上記項目を表にしたもの (出典はファイルとシンボル)
- [ ] client API に要る物の列挙 (必須 / 一部の利用者だけ / 不要 の区分付き)
- [ ] server API に要る物の列挙 (同上)
- [ ] 記録先: `docs/research/YYYY-MM-DD-passkey-usage-in-kawaz-repos.md`

## 解決時の記録先

- 調査結果は `docs/research/`、そこから出る API の判断は `decisions/DR-NNNN-...md`
