---
title: client-distribution-forms
status: open
category: design
created: 2026-09-24T14:57:43+09:00
last_read:
open_entered: 2026-09-24T14:57:43+09:00
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

# client-distribution-forms

## 概要

`@kawaz/passkey-client` の配布形を決める。利用者 3 つの取り込み方が違う: ccmsg-webui は bundler 経由の ESM、hyoui は bundler を通さず `window.*` に載せる素の script (IIFE)、cache-warden は CSP `script-src 'nonce-…'` / `default-src 'none'` 下でページに埋め込むインライン script 1 本 (外部 script を読めない)。

DR-0001 (client API) は配布形を扱わず、API 側に「top-level の副作用を持たない、外部依存を持たない、動的 import を使わない」の制約だけ課している。

## 背景

出典: `docs/research/2026-09-24-passkey-usage-in-kawaz-repos.md` 論点 11 と表 2、`docs/decisions/DR-0001-client-api.md` の Alternatives「配布形」と Consequences。DR-0001 accept 後、client 実装と同時期に着手する想定。

## 決めること

- [ ] (1) dist に ESM のほかに IIFE を出すか
- [ ] (2) cache-warden 向けに「ソース文字列として取り込める」形 (例: build 成果物の文字列 export、または Rust の `include_str!` で読める単一ファイル) を出すか
- [ ] (3) それらを justfile の build にどう組み込むか

## 受け入れ条件

- [ ] 上記 3 点それぞれについて方針が決まり、DR または実装 issue に反映されている
