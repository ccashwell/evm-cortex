#!/bin/bash
# EVM Cortex installer for OpenClaw
# Copies skills to ~/.openclaw/skills/ (shared across all agents)
# and sets up workspace bootstrap files
#
# Usage: ./install-openclaw.sh [--update|--force] [--workspace-only] [--skills-only]

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
OPENCLAW_DIR="$HOME/.openclaw"
WORKSPACE_DIR="$OPENCLAW_DIR/workspace"
FORCE=false
SKILLS_ONLY=false
WORKSPACE_ONLY=false
ADDED=0
CURRENT=0
OUTDATED=0
OUTDATED_LIST=""

for arg in "$@"; do
  case $arg in
    --force|--update) FORCE=true ;;
    --skills-only) SKILLS_ONLY=true ;;
    --workspace-only) WORKSPACE_ONLY=true ;;
    --help|-h)
      echo "Usage: ./install-openclaw.sh [--update|--force] [--skills-only] [--workspace-only]"
      echo ""
      echo "  --update, --force Replace EVM Cortex files with this version"
      echo "                    (required to upgrade an existing install)"
      echo "  --skills-only     Only install skills to ~/.openclaw/skills/"
      echo "  --workspace-only  Only install workspace bootstrap files"
      echo ""
      echo "Installs EVM Cortex skills and workspace config for OpenClaw."
      echo ""
      echo "Skills are installed to ~/.openclaw/skills/ (shared across all agents)."
      echo "Workspace files go to ~/.openclaw/workspace/ (AGENTS.md, TOOLS.md)."
      echo ""
      echo "Alternative: zero-copy setup via openclaw.json:"
      echo '  { "skills": { "load": { "extraDirs": ["/path/to/evm-cortex/skills"] } } }'
      exit 0
      ;;
  esac
done

echo "EVM Cortex installer for OpenClaw"
echo "======================================="
echo ""

if command -v openclaw &> /dev/null; then
  echo "OpenClaw: found"
else
  echo "Warning: openclaw command not found."
  echo "  Install: https://docs.openclaw.ai/install"
  echo ""
  echo "Continuing with file installation anyway..."
fi
echo ""

SKILL_COUNT=$(find "$REPO_DIR/skills/" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

if [ "$SKILLS_ONLY" = true ]; then
  echo "This will install:"
  echo "  - $SKILL_COUNT skills -> ~/.openclaw/skills/"
elif [ "$WORKSPACE_ONLY" = true ]; then
  echo "This will install:"
  echo "  - AGENTS.md   -> ~/.openclaw/workspace/"
  echo "  - TOOLS.md    -> ~/.openclaw/workspace/"
else
  echo "This will install:"
  echo "  - $SKILL_COUNT skills -> ~/.openclaw/skills/"
  echo "  - AGENTS.md   -> ~/.openclaw/workspace/"
  echo "  - TOOLS.md    -> ~/.openclaw/workspace/"
fi
echo ""

if [ "$FORCE" = true ]; then
  echo "Mode: UPDATE — EVM Cortex files will be replaced with this version"
else
  echo "Mode: ADD-ONLY (default) — only new files are installed"
  echo "      Upgrading an existing install? Use --update."
fi
echo ""

if command -v forge &>/dev/null; then
  FORGE_VERSION=$(forge --version 2>/dev/null | head -1)
  echo "Foundry detected: $FORGE_VERSION"
else
  echo "WARNING: Foundry not found. Install it:"
  echo "  curl -L https://foundry.paradigm.xyz | bash && foundryup"
fi

if command -v slither &>/dev/null; then
  echo "Slither detected"
else
  echo "NOTE: Slither not found. Install it: pip install slither-analyzer"
fi
echo ""

read -p "Continue? (y/N) " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 0

# True when dest exists but differs from src — an older version or a local edit.
# Default mode leaves it alone but REPORTS it, so an upgrade cannot silently no-op.
differs() {
  local src="$1" dest="$2"
  if [ -d "$src" ]; then
    ! diff -rq "$src" "$dest" >/dev/null 2>&1
  else
    ! diff -q "$src" "$dest" >/dev/null 2>&1
  fi
}

record_outdated() {
  OUTDATED=$((OUTDATED + 1))
  OUTDATED_LIST="${OUTDATED_LIST}    $1"$'\n'
}

smart_copy_file() {
  local src="$1"
  local dest="$2"
  if [ ! -e "$dest" ]; then
    cp "$src" "$dest"
    ADDED=$((ADDED + 1))
  elif ! differs "$src" "$dest"; then
    CURRENT=$((CURRENT + 1))
  elif [ "$FORCE" = true ]; then
    cp "$src" "$dest"
    ADDED=$((ADDED + 1))
  else
    record_outdated "${dest#$OPENCLAW_DIR/}"
  fi
}

smart_copy_dir() {
  local src="$1"
  local dest="$2"
  if [ ! -e "$dest" ]; then
    cp -r "$src" "$dest"
    ADDED=$((ADDED + 1))
  elif ! differs "$src" "$dest"; then
    CURRENT=$((CURRENT + 1))
  elif [ "$FORCE" = true ]; then
    # Replace rather than merge, so files this version no longer ships are gone.
    rm -rf "$dest"
    cp -r "$src" "$dest"
    ADDED=$((ADDED + 1))
  else
    record_outdated "${dest#$OPENCLAW_DIR/}"
  fi
}

# Install skills to ~/.openclaw/skills/ (shared across agents)
if [ "$WORKSPACE_ONLY" != true ]; then
  echo "Installing skills..."
  mkdir -p "$OPENCLAW_DIR/skills"
  for d in "$REPO_DIR/skills/"*/; do
    name=$(basename "$d")
    [ "$name" = "*" ] && continue
    smart_copy_dir "$d" "$OPENCLAW_DIR/skills/$name"
  done
fi

# Install workspace bootstrap files
if [ "$SKILLS_ONLY" != true ]; then
  echo "Installing workspace files..."
  mkdir -p "$WORKSPACE_DIR"

  # AGENTS.md — operating instructions injected every session
  smart_copy_file "$REPO_DIR/AGENTS.md" "$WORKSPACE_DIR/AGENTS.md"

  # TOOLS.md — local tool conventions and notes
  if [ ! -e "$WORKSPACE_DIR/TOOLS.md" ]; then
    cat > "$WORKSPACE_DIR/TOOLS.md" << 'TOOLSEOF'
# Tools — EVM Cortex

## Foundry (required)

- `forge build` — compile contracts
- `forge test` — run tests
- `forge snapshot` — gas snapshots
- `forge script` — deployment scripts
- `cast` — CLI interaction with contracts
- `anvil` — local testnet

## Slither (recommended)

- `slither .` — static analysis
- Run before every PR

## Aderyn (optional)

- `aderyn .` — additional static analysis

## Conventions

- Say "onchain" not "on-chain"
- USDC has 6 decimals, not 18
- Use SafeERC20 for all token transfers
- Custom errors over require strings
- NatSpec on all public/external functions
- Checks-effects-interactions pattern always

## MCP Servers

- OpenZeppelin MCP (mcp.openzeppelin.com) — contract generation
- Blockscout MCP — onchain data queries
TOOLSEOF
    ADDED=$((ADDED + 1))
  else
    CURRENT=$((CURRENT + 1))
  fi
fi


print_outdated_notice() {
  [ $OUTDATED -eq 0 ] && return 0
  echo "=============================================================="
  echo "  $OUTDATED file(s) on disk differ from this version and were"
  echo "  NOT updated. You are still running the older copies:"
  echo ""
  printf "%s" "$OUTDATED_LIST"
  echo ""
  echo "  To replace them with this version:"
  echo ""
  echo "      ./install-openclaw.sh --update"
  echo "=============================================================="
  echo ""
}

INSTALLED_SKILLS=$(find "$OPENCLAW_DIR/skills/" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')

echo ""
if [ "$FORCE" = true ]; then
  echo "Update complete!"
  echo "  Written:         $ADDED"
  echo "  Already current: $CURRENT"
else
  echo "Installation complete!"
  echo "  Added:           $ADDED (new)"
  echo "  Already current: $CURRENT"
  echo "  OUT OF DATE:     $OUTDATED (left unchanged)"
fi
echo ""
if [ "$WORKSPACE_ONLY" != true ]; then
  echo "  Skills in ~/.openclaw/skills/: $INSTALLED_SKILLS"
fi
if [ "$SKILLS_ONLY" != true ]; then
  echo "  Workspace: $WORKSPACE_DIR"
fi
echo ""
print_outdated_notice
echo "Usage:"
echo "  openclaw agent --message \"audit this Solidity contract\""
echo "  openclaw agent --message \"use the usdc-integration skill\""
echo ""
echo "Alternative zero-copy setup (always in sync with repo):"
echo "  Add to ~/.openclaw/openclaw.json:"
echo '  { "skills": { "load": { "extraDirs": ["'"$REPO_DIR/skills"'"] } } }'
echo ""
echo "Recommended toolchain:"
echo "  - Foundry: curl -L https://foundry.paradigm.xyz | bash && foundryup"
echo "  - Slither: pip install slither-analyzer"
echo "  - Aderyn: cargo install aderyn"
