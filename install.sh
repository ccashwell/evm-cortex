#!/bin/bash
# EVM Cortex installer
# Ethereum protocol engineering squad for Claude Code / Codex CLI
# Merges ecosystem files without overwriting your existing setup

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
FORCE=false
ADDED=0
SKIPPED=0

for arg in "$@"; do
  case $arg in
    --force) FORCE=true ;;
    --non-interactive) NON_INTERACTIVE=true ;;
    --help|-h)
      echo "Usage: ./install.sh [--force] [--non-interactive]"
      echo ""
      echo "  --force            Overwrite existing files (default: skip existing)"
      echo "  --non-interactive  Skip confirmation prompt"
      echo ""
      echo "Without --force, only NEW files are added. Your existing agents,"
      echo "skills, hooks, and rules are preserved."
      exit 0
      ;;
  esac
done

echo "EVM Cortex installer"
echo "========================"
echo ""
echo "Ethereum protocol engineering squad for Claude Code"
echo ""
AGENT_COUNT=$(find "$REPO_DIR/agents" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
SKILL_COUNT=$(find "$REPO_DIR/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
HOOK_COUNT=$(find "$REPO_DIR/hooks/src" -maxdepth 1 -name "*.ts" 2>/dev/null | wc -l | tr -d ' ')
RULE_COUNT=$(find "$REPO_DIR/rules" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')

echo "This will install into ~/.claude/:"
echo "  - $AGENT_COUNT agents  -> ~/.claude/agents/"
echo "  - $SKILL_COUNT skills  -> ~/.claude/skills/"
echo "  - $HOOK_COUNT hooks   -> ~/.claude/hooks/"
echo "  - $RULE_COUNT rules   -> ~/.claude/rules/"
echo ""
if [ "$FORCE" = true ]; then
  echo "Mode: OVERWRITE (--force) — existing files will be replaced"
else
  echo "Mode: MERGE (default) — existing files will be preserved"
fi
echo ""

# Check for Foundry
if command -v forge &>/dev/null; then
  FORGE_VERSION=$(forge --version 2>/dev/null | head -1)
  echo "Foundry detected: $FORGE_VERSION"
else
  echo "WARNING: Foundry not found. Install it: curl -L https://foundry.paradigm.xyz | bash && foundryup"
fi

# Check for Slither
if command -v slither &>/dev/null; then
  echo "Slither detected"
else
  echo "NOTE: Slither not found. Install it: pip install slither-analyzer"
fi
echo ""

if [ "$NON_INTERACTIVE" != true ]; then
  read -p "Continue? (y/N) " -n 1 -r
  echo
  [[ $REPLY =~ ^[Yy]$ ]] || exit 0
fi

if [ "$FORCE" = true ]; then
  if [ -d "$CLAUDE_DIR/agents" ] || [ -d "$CLAUDE_DIR/skills" ]; then
    BACKUP="$CLAUDE_DIR/backup-$(date +%Y%m%d-%H%M%S)"
    echo "Backing up existing files to: $BACKUP"
    mkdir -p "$BACKUP"
    [ -d "$CLAUDE_DIR/agents" ] && cp -r "$CLAUDE_DIR/agents" "$BACKUP/"
    [ -d "$CLAUDE_DIR/skills" ] && cp -r "$CLAUDE_DIR/skills" "$BACKUP/"
    [ -d "$CLAUDE_DIR/hooks" ] && cp -r "$CLAUDE_DIR/hooks" "$BACKUP/"
    [ -d "$CLAUDE_DIR/rules" ] && cp -r "$CLAUDE_DIR/rules" "$BACKUP/"
    echo ""
  fi
fi

smart_copy_file() {
  local src="$1"
  local dest="$2"
  if [ "$FORCE" = true ] || [ ! -e "$dest" ]; then
    cp "$src" "$dest"
    ADDED=$((ADDED + 1))
  else
    SKIPPED=$((SKIPPED + 1))
  fi
}

smart_copy_dir() {
  local src="$1"
  local dest="$2"
  if [ "$FORCE" = true ] || [ ! -e "$dest" ]; then
    cp -r "$src" "$dest"
    ADDED=$((ADDED + 1))
  else
    SKIPPED=$((SKIPPED + 1))
  fi
}

echo "Installing agents..."
mkdir -p "$CLAUDE_DIR/agents"
for f in "$REPO_DIR/agents/"*.md; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  smart_copy_file "$f" "$CLAUDE_DIR/agents/$name"
done

echo "Installing skills..."
mkdir -p "$CLAUDE_DIR/skills"
for d in "$REPO_DIR/skills/"*/; do
  name=$(basename "$d")
  [ "$name" = "*" ] && continue
  smart_copy_dir "$d" "$CLAUDE_DIR/skills/$name"
done

echo "Installing hooks..."
mkdir -p "$CLAUDE_DIR/hooks/dist"
mkdir -p "$CLAUDE_DIR/hooks/src/shared"
for f in "$REPO_DIR/hooks/dist/"*.mjs; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  smart_copy_file "$f" "$CLAUDE_DIR/hooks/dist/$name"
done
for f in "$REPO_DIR/hooks/src/"*.ts; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  smart_copy_file "$f" "$CLAUDE_DIR/hooks/src/$name"
done
for f in "$REPO_DIR/hooks/src/shared/"*.ts; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  smart_copy_file "$f" "$CLAUDE_DIR/hooks/src/shared/$name"
done
[ -f "$REPO_DIR/hooks/package.json" ] && cp "$REPO_DIR/hooks/package.json" "$CLAUDE_DIR/hooks/package.json"
[ -f "$REPO_DIR/hooks/tsconfig.json" ] && cp "$REPO_DIR/hooks/tsconfig.json" "$CLAUDE_DIR/hooks/tsconfig.json"
HOOK_COUNT=$(ls "$CLAUDE_DIR/hooks/dist/"*.mjs 2>/dev/null | wc -l | tr -d ' ')

echo "Installing rules..."
mkdir -p "$CLAUDE_DIR/rules"
for f in "$REPO_DIR/rules/"*.md; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  smart_copy_file "$f" "$CLAUDE_DIR/rules/$name"
done

echo "Installing scripts/mcp..."
mkdir -p "$CLAUDE_DIR/scripts/mcp"
for f in "$REPO_DIR/scripts/mcp/"*; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  smart_copy_file "$f" "$CLAUDE_DIR/scripts/mcp/$name"
done

if [ -d "$REPO_DIR/.github/workflows" ]; then
  echo "Installing GitHub workflow templates..."
  mkdir -p "$CLAUDE_DIR/.github/workflows"
  for f in "$REPO_DIR/.github/workflows/"claude-*.yml; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    smart_copy_file "$f" "$CLAUDE_DIR/.github/workflows/$name"
  done
fi

echo ""
echo "Installation complete!"
echo "  Added:   $ADDED files"
echo "  Skipped: $SKIPPED files (already existed)"
echo ""
echo "  Agents: $(ls "$CLAUDE_DIR/agents/"*.md 2>/dev/null | wc -l | tr -d ' ')"
echo "  Skills: $(find "$CLAUDE_DIR/skills/" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
echo "  Hooks:  ${HOOK_COUNT:-$(ls "$CLAUDE_DIR/hooks/dist/"*.mjs 2>/dev/null | wc -l | tr -d ' ')}"
echo "  Rules:  $(ls "$CLAUDE_DIR/rules/"*.md 2>/dev/null | wc -l | tr -d ' ')"
echo ""
if [ $SKIPPED -gt 0 ]; then
  echo "Tip: Use ./install.sh --force to overwrite existing files."
fi
echo ""
echo "Recommended MCP servers for EVM Cortex:"
echo "  - OpenZeppelin MCP: https://mcp.openzeppelin.com/"
echo "  - Blockscout MCP: for onchain data queries"
echo "  - Slither MCP: for static analysis integration"
echo ""
echo "Recommended toolchain:"
echo "  - Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
echo "  - Slither: pip install slither-analyzer"
echo "  - Aderyn: cargo install aderyn"
