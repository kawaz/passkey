# Issue INDEX

active な issue の一覧。close 済みは archive/ にあり、ここには載せない。

| date | category | status | slug | 概要 |
|---|---|---|---|---|
| 2026-09-24 | task | wip | [extract-server-from-ccmsg](./2026-09-24-extract-server-from-ccmsg.md) | kawaz/ccmsg の検証実装を `@kawaz/passkey-server` に移す。入力の形を Level 3 の `toJSON()` (camelCa… |
| 2026-09-24 | task | wip | [client-api-from-three-webuis](./2026-09-24-client-api-from-three-webuis.md) | ccmsg-webui / cache-warden / hyoui の 3 つの webui の使い方から `@kawaz/passkey-client` の API … |

<!--
INDEX の列構成・canonical 順序・行形式の唯一の正本:

- 列構成は固定 (= 上記 5 列、列名と順序を変えない)
- 行の {{rows}} は active issue の行に置換する
- canonical 順序:
  1. status 優先順: idea → open → wip → blocked → pending-sublimation
  2. 同 status 内は date 降順 (= 新しい起票が上)
- 各行: `| YYYY-MM-DD | <category> | <status> | [<slug>](./YYYY-MM-DD-<slug>.md) | <本文 1 行目から 80 文字以内> |`
- 概要は 80 文字を超えたら末尾を「…」で省略
-->
