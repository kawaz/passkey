---
title: "3 つの webui の使い方から @kawaz/passkey-client の API を決める"
status: resolved
category: task
created: 2026-09-24T13:52:35+09:00
last_read:
open_entered: 2026-09-24T13:52:35+09:00
wip_entered: 2026-09-24T14:35:40+09:00
blocked_entered:
pending_entered:
discarded_entered:
resolved_entered: 2026-09-28T15:19:01+09:00
discard_reason:
pending_reason:
close_reason: ["dr/DR-0001","implemented"]
blocked_by:
origin: 自リポ TODO
---

# 3 つの webui の使い方から @kawaz/passkey-client の API を決める

## 概要

ccmsg-webui / cache-warden / hyoui の 3 つの webui の使い方から `@kawaz/passkey-client` の API を決める。対象は登録、認証、条件付き UI、可否判定、iframe と PWA での制約の 5 つ。

## 背景

client はブラウザの差 (`toJSON()` / `parseCreationOptionsFromJSON()` の有無、`getClientCapabilities()` の有無、条件付き UI の対応) と埋め込み・standalone 表示の制約を吸収する層。3 つの webui がそれぞれ個別に抱えている処理を 1 か所にまとめる。

## 決めること

- 登録 / 認証: 入力は Level 3 の options JSON、出力は Level 3 の response JSON で揃えるか。キャンセル (`NotAllowedError`) と失敗をどう区別して返すか (例外 / 判別可能な結果型)
- 条件付き UI: 開始・中断 (`AbortSignal`) の形、明示の認証ボタンとの切り替え
- 可否判定: 返す情報の粒度 (単一の bool でなく、何が使えて何が使えないか)
- iframe / PWA: permissions policy が無い埋め込み、standalone 表示での制約を、呼ぶ前に分かる形で返すか、呼んだ時の失敗として返すか
- ブラウザに `toJSON()` が無い時の自前整形の範囲

## 受け入れ条件

- [ ] 前提として `survey-passkey-usage-in-kawaz-repos` の列挙がある
- [ ] 上の各項目の判断を DR に記録する
- [ ] 3 つの webui がこの API に乗り換えた時に落ちる要件が無いことを、調査の表と突き合わせて確認する
