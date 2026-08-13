#!/bin/sh
# 禁止直推 origin/main。改走功能分支开 PR。
# --no-verify 能绕过本 hook；远端真正锁死要靠 PraiseZhu 开分支保护。

set -eu

url="${2:-}"
current="$(git rev-parse --abbrev-ref HEAD)"

case "$url" in
  *project-gameweb*|"") ;;
  *) exit 0 ;;
esac

if [ "$current" = "main" ]; then
  echo "拒绝直推 main。请开功能分支再提 PR："
  echo "  git switch -c feat/<简短说明>"
  echo "  git push -u origin HEAD"
  echo "然后在 GitHub 开向 main 的 PR。"
  exit 1
fi

# 即使当前不在 main，也不允许把本地 main 推到远端 main
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "${remote_ref:-}" ] && continue
  case "$remote_ref" in
    refs/heads/main)
      echo "拒绝更新远端 main（$local_ref -> $remote_ref）。请开 PR。"
      exit 1
      ;;
  esac
done

exit 0
