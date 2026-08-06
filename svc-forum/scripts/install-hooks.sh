#!/usr/bin/env bash
# install-hooks.sh — 安装 commit-msg hook 到本地 .git/hooks/
# 入版本管理：新开发者 clone 后运行一次即可（AC5：安装脚本纳入版本管理）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 向上查找 .git（支持 git worktree：.git 可能是文件而非目录）
GIT_DIR=""
CANDIDATE="$REPO_ROOT"
while [[ "$CANDIDATE" != "/" ]]; do
  if [[ -d "$CANDIDATE/.git" || -f "$CANDIDATE/.git" ]]; then
    GIT_DIR="$CANDIDATE/.git"
    break
  fi
  CANDIDATE="$(dirname "$CANDIDATE")"
done

if [[ -z "$GIT_DIR" ]]; then
  echo "❌ 找不到 .git 目录（从 $REPO_ROOT 向上查找失败）" >&2
  exit 1
fi

# git worktree 的 hooks 目录在公共 git 目录下（.git 文件指向它）
if [[ -f "$GIT_DIR" ]]; then
  GIT_COMMON_DIR="$(git -C "$REPO_ROOT" rev-parse --git-common-dir)"
  HOOKS_DIR="$GIT_COMMON_DIR/hooks"
else
  HOOKS_DIR="$GIT_DIR/hooks"
fi

HOOK_SRC="$SCRIPT_DIR/commit-msg.hook"
HOOK_DST="$HOOKS_DIR/commit-msg"

if [[ ! -f "$HOOK_SRC" ]]; then
  echo "❌ 找不到 hook 源文件: $HOOK_SRC" >&2
  exit 1
fi

mkdir -p "$HOOKS_DIR" 2>/dev/null || true

# 优先用符号链接（源文件更新自动生效），失败则复制
if ln -sf "$HOOK_SRC" "$HOOK_DST" 2>/dev/null; then
  echo "✅ commit-msg hook 已安装（符号链接）: $HOOK_DST"
else
  cp "$HOOK_SRC" "$HOOK_DST"
  echo "✅ commit-msg hook 已安装（复制）: $HOOK_DST"
fi

chmod +x "$HOOK_DST" 2>/dev/null || true

# 自检：验证 hook 可执行
if bash "$HOOK_DST" /dev/null >/dev/null 2>&1; then
  echo "⚠️  警告：hook 自检未触发拒绝（/dev/null 含 workflow 字样？）" >&2
else
  echo "✅ hook 自检通过：空 message 被拒绝（符合预期）"
fi

echo ""
echo "现在 commit 时，message 必须包含: workflow: <36位UUID>"
echo "示例: git commit -m \"feat: xxx\" -m \"workflow: 8265a467-f983-44af-bf56-fcef60a75996\""
