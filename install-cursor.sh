#!/bin/bash
# EVM Cortex installer for Cursor IDE
# Copies skills to project and sets up .cursor/rules

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
FORCE=false
TARGET_DIR="."
ADDED=0
CURRENT=0
OUTDATED=0
OUTDATED_LIST=""

for arg in "$@"; do
  case $arg in
    --force|--update) FORCE=true ;;
    --help|-h)
      echo "Usage: ./install-cursor.sh [target-dir] [--update|--force]"
      echo ""
      echo "  --update, --force  Replace EVM Cortex files with this version"
      echo ""
      echo "UPGRADING an existing install requires --update. The default mode only"
      echo "adds NEW files and reports which existing ones are out of date."
      exit 0
      ;;
    *) TARGET_DIR="$arg" ;;
  esac
done

# True when dest exists but differs from src — an older version or a local edit.
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
  local src="$1" dest="$2"
  if [ ! -e "$dest" ]; then
    cp "$src" "$dest"; ADDED=$((ADDED + 1))
  elif ! differs "$src" "$dest"; then
    CURRENT=$((CURRENT + 1))
  elif [ "$FORCE" = true ]; then
    cp "$src" "$dest"; ADDED=$((ADDED + 1))
  else
    record_outdated "$2"
  fi
}

smart_copy_dir() {
  local src="$1" dest="$2"
  if [ ! -e "$dest" ]; then
    cp -r "$src" "$dest"; ADDED=$((ADDED + 1))
  elif ! differs "$src" "$dest"; then
    CURRENT=$((CURRENT + 1))
  elif [ "$FORCE" = true ]; then
    # Replace rather than merge, so files this version no longer ships are gone.
    rm -rf "$dest"; cp -r "$src" "$dest"; ADDED=$((ADDED + 1))
  else
    record_outdated "$2"
  fi
}

echo "EVM Cortex installer for Cursor IDE"
echo "========================================="
echo ""
echo "Target project: $(cd "$TARGET_DIR" && pwd)"
echo ""
echo "This will install:"
echo "  - .cursor/rules/*.mdc  (6 rule files)"
echo "  - AGENTS.md            (project instructions)"
echo ""
read -p "Continue? (y/N) " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 0

# Copy .cursor/rules
echo ""
echo "Installing Cursor rules..."
mkdir -p "$TARGET_DIR/.cursor/rules"
for f in "$REPO_DIR/.cursor/rules/"*.mdc; do
  [ -f "$f" ] || continue
  name=$(basename "$f")
  smart_copy_file "$f" "$TARGET_DIR/.cursor/rules/$name"
done

# Copy AGENTS.md
smart_copy_file "$REPO_DIR/AGENTS.md" "$TARGET_DIR/AGENTS.md"

# Optionally copy skills to project
echo ""
read -p "Also copy skills to project? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "Copying skills..."
  mkdir -p "$TARGET_DIR/.cursor/skills"
  for d in "$REPO_DIR/skills/"*/; do
    name=$(basename "$d")
    [ "$name" = "*" ] && continue
    smart_copy_dir "$d" "$TARGET_DIR/.cursor/skills/$name"
  done
fi

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
echo "  Rules: $(ls "$TARGET_DIR/.cursor/rules/"*.mdc 2>/dev/null | wc -l | tr -d ' ') .mdc files"
echo ""
echo "Usage:"
echo "  Open your project in Cursor IDE"
echo "  Rules will auto-apply based on file patterns"
echo '  Use @ruleName in chat to manually invoke a rule'
echo ""
if [ $OUTDATED -gt 0 ]; then
  echo "=============================================================="
  echo "  $OUTDATED file(s) differ from this version and were NOT"
  echo "  updated. You are still running the older copies:"
  echo ""
  printf "%s" "$OUTDATED_LIST"
  echo ""
  echo "  To replace them with this version:"
  echo ""
  echo "      ./install-cursor.sh $TARGET_DIR --update"
  echo "=============================================================="
fi
