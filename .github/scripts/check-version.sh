#!/usr/bin/env bash
# Usage: check-version.sh <package>   (package = packages/ 配下のディレクトリ名、例: client)
#
# packages/<package>/package.json の version を正本として、その version を release すべきか判定する。
# tag / release 名は "<package>-v<version>" (例: client-v0.1.0)。
# 結果は GITHUB_OUTPUT (未設定なら stdout) に current=<version> と changed=true|false を書く。
#   - 現 version が同パッケージの既存 tag / release のいずれよりも大 → changed=true
#   - 現 version が既存の最大と等しい (= version を上げない package.json 変更) → changed=false, exit 0
#   - 現 version が既存の最大より小 → exit 1 (設定ミス)
#
# 要: bump-semver, gh (GH_TOKEN / REPO を env で渡す)。git tag を読むので checkout は fetch-depth: 0。
#
# Design rationale: bump-semver の `vcs get latest-tag` / `latest-release` は tag 全体が SemVer として
# parse できるものだけを扱い、prefix 付きの "client-v0.1.0" は対象外になる。そのためパッケージごとの
# 最大 version はここで prefix を剥がして bump-semver compare で求める。両 source (git tag と GH release)
# を見る理由は ccmsg と同じで、`gh release create` が作る tag は checkout 済みの git ref に乗らないことがあるため。
set -euo pipefail

pkg="${1:?usage: check-version.sh <package>}"
prefix="${pkg}-v"
out="${GITHUB_OUTPUT:-/dev/stdout}"

current=$(bump-semver get "packages/${pkg}/package.json" --no-hint)
echo "current=${current}" >>"$out"

# stdin から "<prefix><version>" を読み、SemVer として最大の version を出す (無ければ空)
max_version() {
  local max="" name v
  while IFS= read -r name; do
    [[ "$name" == "$prefix"* ]] || continue
    v="${name#"$prefix"}"
    [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+].*)?$ ]] || continue
    if [[ -z "$max" ]] || bump-semver compare gt "$v" "$max" -qq; then
      max="$v"
    fi
  done
  echo "$max"
}

latest_tag=$(git tag -l "${prefix}*" | max_version)
latest_release=$(gh release list --repo "${REPO:?}" --limit 1000 --exclude-drafts --json tagName -q '.[].tagName' | max_version)

fail=0
skip=0
check_axis() {
  local label="$1" latest="$2"
  if [[ -z "$latest" ]]; then
    echo "${label}: (none yet); bootstrap"
    return
  fi
  echo "${label}: ${latest}"
  if bump-semver compare gt "$current" "$latest" -qq; then
    :
  elif bump-semver compare eq "$current" "$latest" -qq; then
    skip=1
  else
    echo "::error::${pkg} v${current} is less than ${label} v${latest}"
    fail=1
  fi
}
check_axis "latest-tag" "$latest_tag"
check_axis "latest-release" "$latest_release"

if [[ "$fail" == 1 ]]; then
  echo "changed=false" >>"$out"
  exit 1
fi
if [[ "$skip" == 1 ]] || gh release view "${prefix}${current}" --repo "$REPO" >/dev/null 2>&1; then
  echo "changed=false" >>"$out"
  echo "${pkg} v${current} is already released; skip"
  exit 0
fi
echo "changed=true" >>"$out"
echo "${pkg}: new version v${current}"
