#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

[[ $# == 2 ]] || fail "使い方: bash scripts/rebuild-personal.sh <upstream main の OID> <personal の OID>"
upstream=$(git rev-parse --verify "$1^{commit}")
personal=$(git rev-parse --verify "$2^{commit}")
[[ "$1" == "$upstream" && "$2" == "$personal" ]] || fail "入力にはコミットの完全な OID が必要です"
[[ $(git rev-parse HEAD) == "$personal" ]] || fail "personal のスナップショットから実行してください"
if git symbolic-ref -q HEAD >/dev/null; then
  fail "detached HEAD で実行してください"
fi
status=$(git status --porcelain)
[[ -z "$status" ]] || fail "作業ツリーに変更があります"

# candidate に切り替える前に、現在の personal から構成を読み取る。
feature_list=$(git show "$personal:.github/personal-features.txt")
declare -a features=()
declare -A tips=()
while IFS= read -r feature; do
  [[ -n "$feature" ]] || continue
  [[ "$feature" == feat/* ]] && git check-ref-format "refs/heads/$feature" ||
    fail "機能ブランチの指定が不正です: $feature"
  [[ ! -v tips[$feature] ]] || fail "機能ブランチが重複しています: $feature"
  tips[$feature]=$(git rev-parse --verify "refs/remotes/origin/$feature^{commit}") ||
    fail "機能ブランチを取得できません: $feature"
  features+=("$feature")
done <<< "$feature_list"

history=$(git rev-list --first-parent --exclude-first-parent-only --reverse "$personal" "^$upstream")
declare -a old_features=() personal_commits=()
declare -A old_tips=()
base=$personal
if [[ -n "$history" ]]; then
  while IFS= read -r commit; do
    parents=$(git show -s --format=%P "$commit")
    read -r -a parent <<< "$parents"
    if [[ "$base" == "$personal" ]]; then
      [[ ${#parent[@]} -ge 1 ]] || fail "upstream main と personal の共通の第一親が見つかりません"
      base=${parent[0]}
    fi
    case ${#parent[@]} in
      1)
        personal_commits+=("$commit")
        ;;
      2)
        [[ ${#personal_commits[@]} == 0 ]] ||
          fail "個人用コミットの後にマージがあります: $commit"
        # 自動同期を入れる前に作った 2 件にはトレーラーがない。
        case "$commit" in
          5d729823745429d0c16a71481658afb68e1f94f4) feature=feat/posts-per-author ;;
          6fb558fda42ee311cb83a5b78aecd6b3507fe2c9) feature=feat/hover-card-toggle ;;
          *) feature=$(git show -s --format='%(trailers:key=Streets-Personal-Feature,valueonly,unfold)' "$commit") ;;
        esac
        [[ "$feature" == feat/* ]] && git check-ref-format "refs/heads/$feature" ||
          fail "機能ブランチを識別できないマージがあります: $commit"
        [[ ! -v old_tips[$feature] ]] || fail "機能ブランチのマージが重複しています: $feature"
        old_features+=("$feature")
        old_tips[$feature]=${parent[1]}

        # マージの手修正は作り直すと失われるため、再現できる場合だけ進む。
        merged_tree=$(git merge-tree --write-tree "${parent[0]}" "${parent[1]}") ||
          fail "マージを自動で再現できません: $commit"
        [[ "$merged_tree" == "$(git rev-parse "$commit^{tree}")" ]] ||
          fail "マージに手修正が含まれています: $commit"
        ;;
      *)
        fail "想定外の親を持つコミットがあります: $commit"
        ;;
    esac
  done <<< "$history"
fi

unchanged=false
if [[ "$base" == "$upstream" && ${#features[@]} == "${#old_features[@]}" ]]; then
  unchanged=true
fi
for index in "${!features[@]}"; do
  feature=${features[index]}
  old_tip=${old_tips[$feature]-}
  if [[ -n "$old_tip" ]] && ! git merge-base --is-ancestor "$old_tip" "${tips[$feature]}"; then
    fail "機能ブランチの履歴が書き換わっています: $feature"
  fi
  if [[ "${old_features[index]-}" != "$feature" || "$old_tip" != "${tips[$feature]}" ]]; then
    unchanged=false
  fi
done
if [[ "$unchanged" == true ]]; then
  printf '%s\n' "upstream main と機能ブランチに変更はありません"
  exit 0
fi

git switch --detach "$upstream"
for feature in "${features[@]}"; do
  tip=${tips[$feature]}
  if git merge-base --is-ancestor "$tip" HEAD; then
    fail "すでに取り込まれている機能ブランチを一覧から外してください: $feature"
  fi
  git -c rerere.enabled=false merge --no-ff --no-edit \
    -m "$feature を取り込む" -m "Streets-Personal-Feature: $feature" "$tip" ||
    fail "機能ブランチを取り込めません: $feature"
done
for commit in "${personal_commits[@]}"; do
  git -c rerere.enabled=false cherry-pick --empty=keep "$commit" ||
    fail "個人用コミットを適用できません: $commit"
done
