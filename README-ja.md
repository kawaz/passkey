# passkey

> [English](./README.md) | 日本語

TypeScript 向けの passkey (WebAuthn) ライブラリ。ブラウザ側と検証側を 1 リポの 2 パッケージとして提供する。

**現状は骨組みだけで、まだ API はない。** 中身は [kawaz/ccmsg](https://github.com/kawaz/ccmsg) の WebAuthn 実装を移して作る (計画は [ROADMAP.md](./docs/ROADMAP.md) と [docs/issue/](./docs/issue/INDEX.md))。

## パッケージ

| パッケージ                                    | 役割                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@kawaz/passkey-client`](./packages/client/) | ブラウザ側。`navigator.credentials` を呼び、結果を WebAuthn Level 3 の `toJSON()` の形に整えて返す。条件付き UI (autofill)、passkey が使えるかの判定、iframe / PWA での制約の扱いを受け持つ |
| [`@kawaz/passkey-server`](./packages/server/) | 検証側。WebCrypto だけで登録と認証を検証する。attestation は `none`、署名アルゴリズムは ES256 / EdDSA / RS256                                                                               |

2 つの間を流れるデータは Level 3 の `toJSON()` の形 (camelCase の JSON) で、どちらのパッケージも相手の実装に依存しない。

## インストール

未公開。npm への公開は API が入ってから行う。

## ドキュメント

- [DESIGN-ja.md](./docs/DESIGN-ja.md) — 設計 (パッケージの境界、wire の形、検証の方針)
- [STRUCTURE.md](./docs/STRUCTURE.md) — リポジトリ物理構造
- [ROADMAP.md](./docs/ROADMAP.md) — 将来検討項目

## ライセンス

MIT License, Yoshiaki Kawazu (@kawaz)
