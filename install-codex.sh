#!/bin/bash
# EVM Cortex installer for Codex CLI
# Copies skills to ~/.codex/skills/ where Codex auto-discovers them
#
# Usage: ./install-codex.sh [--update|--force]

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CODEX_DIR="$HOME/.codex"
FORCE=false
ADDED=0
CURRENT=0
OUTDATED=0
OUTDATED_LIST=""

for arg in "$@"; do
  case $arg in
    --force|--update) FORCE=true ;;
    --help|-h)
      echo "Usage: ./install-codex.sh [--update|--force]"
      echo ""
      echo "  --update, --force  Replace existing skills with this version"
      echo ""
      echo "UPGRADING an existing install requires --update. The default mode only"
      echo "adds NEW skills and reports which existing ones are out of date."
      echo ""
      echo "Installs EVM Cortex skills to ~/.codex/skills/"
      echo "for use with Codex CLI (OpenAI)."
      exit 0
      ;;
  esac
done

echo "EVM Cortex installer for Codex CLI"
echo "======================================="
echo ""

# Check if codex is installed
if command -v codex &> /dev/null; then
  echo "Codex CLI: $(codex --version 2>/dev/null || echo 'found')"
else
  echo "Warning: codex command not found. Install it first:"
  echo "  npm install -g @openai/codex"
  echo ""
  echo "Continuing with skill installation anyway..."
fi

echo ""

# Count skills
SKILL_COUNT=$(find "$REPO_DIR/skills/" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
echo "This will install $SKILL_COUNT skills to ~/.codex/skills/"
echo ""

if [ "$FORCE" = true ]; then
  echo "Mode: OVERWRITE (--force)"
else
  echo "Mode: MERGE (default) -- existing skills preserved"
fi
echo ""

read -p "Continue? (y/N) " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 0

# Create directories
mkdir -p "$CODEX_DIR/skills"

# Copy skills
echo ""
echo "Installing skills..."
for d in "$REPO_DIR/skills/"*/; do
  name=$(basename "$d")
  [ "$name" = "*" ] && continue

  dest="$CODEX_DIR/skills/$name"
  if [ ! -e "$dest" ]; then
    cp -r "$d" "$dest"
    ADDED=$((ADDED + 1))
  elif diff -rq "$d" "$dest" >/dev/null 2>&1; then
    CURRENT=$((CURRENT + 1))
  elif [ "$FORCE" = true ]; then
    # Replace rather than merge, so files this version no longer ships are gone.
    rm -rf "$dest"
    cp -r "$d" "$dest"
    ADDED=$((ADDED + 1))
  else
    OUTDATED=$((OUTDATED + 1))
    OUTDATED_LIST="${OUTDATED_LIST}    $name"$'\n'
  fi
done

# Copy AGENTS.md as instructions reference
if [ "$FORCE" = true ] || [ ! -e "$CODEX_DIR/AGENTS.md" ]; then
  cp "$REPO_DIR/AGENTS.md" "$CODEX_DIR/AGENTS.md"
  echo "Copied AGENTS.md to ~/.codex/"
fi

echo ""
if [ "$FORCE" = true ]; then
  echo "Update complete!"
  echo "  Written:         $ADDED skills"
  echo "  Already current: $CURRENT"
else
  echo "Installation complete!"
  echo "  Added:           $ADDED skills (new)"
  echo "  Already current: $CURRENT"
  echo "  OUT OF DATE:     $OUTDATED (left unchanged)"
fi
echo ""
echo "  Total skills in ~/.codex/skills/: $(find "$CODEX_DIR/skills/" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
echo ""
echo "Usage:"
echo "  cd your-project"
echo "  codex"
echo '  > "use the coding-standards skill"'
echo ""
if [ $OUTDATED -gt 0 ]; then
  echo "=============================================================="
  echo "  $OUTDATED skill(s) on disk differ from this version and were"
  echo "  NOT updated. You are still running the older copies:"
  echo ""
  printf "%s" "$OUTDATED_LIST"
  echo ""
  echo "  To replace them with this version:"
  echo ""
  echo "      ./install-codex.sh --update"
  echo "=============================================================="
fi
