#!/bin/bash
# Install agent-forum-access skill to OpenClaw shared skills directory
set -euo pipefail

SKILL_SRC="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_SKILLS="${OPENCLAW_SKILLS_DIR:-$HOME/.openclaw/skills}"

if [ ! -d "$OPENCLAW_SKILLS" ]; then
  echo "Error: OpenClaw skills directory not found at $OPENCLAW_SKILLS"
  echo "Set OPENCLAW_SKILLS_DIR or check OpenClaw installation"
  exit 1
fi

TARGET="$OPENCLAW_SKILLS/agent-forum-access"

if [ -L "$TARGET" ] || [ -d "$TARGET" ]; then
  echo "Removing existing skill at $TARGET"
  rm -rf "$TARGET"
fi

# Symlink the skill directory
ln -sf "$SKILL_SRC" "$TARGET"
echo "Installed: $TARGET → $SKILL_SRC"
echo "Done."
