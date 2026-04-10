#!/bin/bash
# EVM Cortex remote installer
# Usage: curl -fsSL https://raw.githubusercontent.com/ccashwell/evm-cortex/main/install-remote.sh | bash
set -e

INSTALL_DIR="$HOME/.evm-cortex"
REPO_URL="https://github.com/ccashwell/evm-cortex.git"

echo ""
echo "  EVM Cortex remote installer"
echo "  ================================"
echo ""

# Check prerequisites
if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is required. Install it first."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js is required. Install it first."
  echo "  https://nodejs.org/"
  exit 1
fi

NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo "Warning: Node.js >= 18 recommended (you have $(node -v))"
fi

# Check for Foundry
if ! command -v forge >/dev/null 2>&1; then
  echo "Warning: Foundry not found. Install it for full functionality:"
  echo "  curl -L https://foundry.paradigm.xyz | bash && foundryup"
  echo ""
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation..."
  git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null || {
    echo "Pull failed, re-cloning..."
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  }
else
  echo "Cloning EVM Cortex..."
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

echo ""

# Run main installer
cd "$INSTALL_DIR"
bash install.sh --non-interactive

echo ""
echo "Done! EVM Cortex is ready."
echo ""
echo "  Agents, skills, hooks, and rules installed."
echo ""
echo "  Ethereum protocol engineering squad installed."
echo ""
echo "github.com/ccashwell/evm-cortex"
echo ""
