# passkey
#
# kawaz/* リポの共通テンプレ (kawaz/bump-semver justfile が canonical) に揃えてある。
# 言語依存箇所 (lint/typecheck/test/build) のみカスタム。VCS 操作と翻訳鮮度チェックは bump-semver vcs サブコマンドに委譲する。
# ---------- settings ----------

set unstable
set guards
set lazy
set shell := ["bash", "-eu", "-o", "pipefail", "-c"]
set script-interpreter := ["bash", "-eu", "-o", "pipefail"]

# ---------- variables ----------
# 公開するパッケージ。version は各 package.json が正本で、bump と bump 済み判定はパッケージごとに行う。

packages := "client server"

# ---------- default ----------

# レシピ一覧を表示
default:
    @just --list

# ---------- main entries ----------

# push (バージョン bump 済みを前提、全 gate 通過後に push)
push: check-on-default-branch ensure-clean ci check-translations check-version-bumped
    bump-semver vcs push --branch main --jj-bookmark-auto-advance

# 指定パッケージの version を bump して Release commit を作成 (push は別途 `just push`)
[script]
bump-version package bump="patch": ensure-clean
    file=packages/{{ package }}/package.json
    new_version=$(bump-semver {{ bump }} "$file" --write --no-hint)
    bump-semver vcs commit -m "Release @kawaz/passkey-{{ package }} v${new_version}" "$file"

# CI 単一エントリ (lint→typecheck→test→build を依存重複排除で1回ずつ保証)
ci: lint typecheck test build

# 各パッケージの現在の version を表示
[script]
version:
    for p in {{ packages }}; do
        echo "@kawaz/passkey-$p $(bump-semver get "packages/$p/package.json" --no-hint)"
    done

# ---------- dev recipes ----------

# lint (justfile フォーマット確認 + oxlint (type-aware) + oxfmt の整形確認)
lint:
    just --fmt --check --unstable
    bun x oxlint
    bun x oxfmt --check

# 型チェック
typecheck: lint
    bun x tsc --noEmit

# テスト
[script]
test: lint typecheck
    test_tmpdir=$(mktemp -d /tmp/passkey-test.XXXXXX)
    trap 'rm -rf "$test_tmpdir"' EXIT
    TMPDIR="$test_tmpdir" bun test --pass-with-no-tests

# 各パッケージの dist/ (ESM + 型定義) を生成
[script]
build: lint typecheck
    for p in {{ packages }}; do
        rm -rf "packages/$p/dist"
        bun x tsc -p "packages/$p/tsconfig.build.json"
    done

# ---------- check recipes (push の sanity 検証) ----------

# 現在の bookmark/branch が default (= main) 上にあるか確認
[private]
[script]
check-on-default-branch:
    if ! bump-semver vcs is on-default-branch; then
        bn=$(bump-semver vcs get default-branch)
        printf >&2 "⚠ default branch (%s) に合流してから push してください\n  1. just sync\n  2. just promote\n  3. %s ワークスペースに移動して just push\n" "$bn" "$bn"
        exit 1
    fi

# 現在の worktree を default branch に rebase
sync:
    bump-semver vcs sync --onto $(bump-semver vcs get default-branch)@origin

# default branch を現在の commit に forward (push しない)
promote:
    bump-semver vcs promote

# ワーキングコピーがクリーン (jj は @ が empty、git は porcelain 空)
ensure-clean: lint
    bump-semver vcs is clean

# 翻訳ペア (NAME-ja.md / NAME.md) の整合性チェック
check-translations: ensure-clean check-translation-freshness (_check-translation-headers "README") (_check-translation-headers "docs/DESIGN")

# 翻訳ペアの鮮度: en の最終 commit timestamp >= ja
[private]
check-translation-freshness:
    bump-semver vcs outdated 'glob:**/*-ja.md' '$1/$2.md'

# 相互リンクヘッダの確認 (vcs outdated は timestamp のみ検証するので grep は別途)
[private]
[script]
_check-translation-headers name:
    base=$(basename {{ name }})
    head -5 {{ name }}-ja.md | grep -qF "](./${base}.md)"
    head -5 {{ name }}.md | grep -qF "](./${base}-ja.md)"

# パッケージごとに、実装 (src/) か型設定が変わっていれば package.json の version が main@origin より bump 済か検証
[private]
[script]
check-version-bumped:
    for p in {{ packages }}; do
        dir=packages/$p
        rc=0
        bump-semver vcs diff -q main@origin -- "$dir/src/" "$dir/tsconfig.build.json" tsconfig.json || rc=$?
        case "$rc" in
          0) continue ;;
          1) ;;
          *) echo "ERROR: bump-semver vcs diff failed (rc=$rc). main@origin が track されていない可能性" >&2; exit 1 ;;
        esac
        # main@origin にまだ無いパッケージは初版として通す (diff が通った時点で main@origin は track 済み)
        if ! bump-semver get "vcs:main@origin:$dir/package.json" --no-hint >/dev/null 2>&1; then
            continue
        fi
        if bump-semver compare gt "$dir/package.json" "vcs:main@origin:$dir/package.json" --no-hint; then
            continue
        fi
        echo "ERROR: $dir の実装が変わってるが version 未 bump。\"just bump-version $p\" を実行してください" >&2
        exit 1
    done
