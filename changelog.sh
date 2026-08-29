#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# changelog.sh
#
# Usage:
#   bash changelog.sh <version> [date]
#
# Examples:
#   bash changelog.sh 1.1.0
#   bash changelog.sh 1.2.0 2026-09-15
#
# What it does:
#   1. Reads the LATEST version block from each sub-module changelog:
#        src/core/CHANGELOG.md
#        src/events/CHANGELOG.md
#        src/storage/CHANGELOG.md
#   2. Assembles them into one new section.
#   3. Prepends that section to the root CHANGELOG.md.
#   4. Appends a reference link for the new version at the bottom of
#      the root CHANGELOG.md.
# ---------------------------------------------------------------------------

set -euo pipefail

# ── helpers ──────────────────────────────────────────────────────────────────

usage() {
  echo "Usage: bash changelog.sh <version> [date]"
  echo "  version  Semantic version, e.g. 1.1.0"
  echo "  date     ISO date, e.g. 2026-09-15  (defaults to today)"
  exit 1
}

# Extract the first version block (## [x.y.z] ... lines until next ## or EOF)
# from a given changelog file.
# Strips the heading line itself; returns only the body (### Added / ### Fixed …).
extract_latest_block() {
  local file="$1"
  awk '
    /^## \[/ { if (found) exit; found=1; next }
    found    { print }
  ' "$file"
}

# Remove leading/trailing blank lines from stdin.
trim_blank_lines() {
  awk 'NF { p=1 } p' | tac | awk 'NF { p=1 } p' | tac
}

# ── argument handling ─────────────────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

VERSION="$1"
DATE="${2:-$(date +%F)}"

# Validate semver-ish format.
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "Error: version must be in semver format (e.g. 1.2.3 or 1.2.3-beta.1)"
  exit 1
fi

ROOT_CHANGELOG="CHANGELOG.md"
CORE_CHANGELOG="src/core/CHANGELOG.md"
EVENTS_CHANGELOG="src/events/CHANGELOG.md"
STORAGE_CHANGELOG="src/storage/CHANGELOG.md"

for f in "$CORE_CHANGELOG" "$EVENTS_CHANGELOG" "$STORAGE_CHANGELOG"; do
  if [[ ! -f "$f" ]]; then
    echo "Error: $f not found. Run this script from the project root."
    exit 1
  fi
done

REPO_URL="https://github.com/rafidahmed870/queue-jobs-worker"

# ── collect sub-module blocks ─────────────────────────────────────────────────

CORE_BODY=$(extract_latest_block "$CORE_CHANGELOG" | trim_blank_lines)
EVENTS_BODY=$(extract_latest_block "$EVENTS_CHANGELOG" | trim_blank_lines)
STORAGE_BODY=$(extract_latest_block "$STORAGE_CHANGELOG" | trim_blank_lines)

# Build the new root entry.
NEW_ENTRY="## [$VERSION] — $DATE

### Core

$CORE_BODY

### Events

$EVENTS_BODY

### Storage

$STORAGE_BODY"

# ── update root CHANGELOG.md ──────────────────────────────────────────────────

TEMP_FILE=$(mktemp)

# If the root changelog already exists, preserve its content after the header.
if [[ -f "$ROOT_CHANGELOG" ]]; then
  # Split at the first ## [ line so we can insert before it.
  HEAD=$(awk '/^## \[/{exit} {print}' "$ROOT_CHANGELOG")
  TAIL=$(awk '/^## \[/{found=1} found{print}' "$ROOT_CHANGELOG")
  # Also strip the old reference-link block at the bottom so we can re-add it.
  TAIL_NO_LINKS=$(echo "$TAIL" | awk '/^\[.*\]:/{exit} {print}')
  OLD_LINKS=$(awk '/^\[.*\]:/{print}' "$ROOT_CHANGELOG")
else
  HEAD="# Changelog

All notable changes to this project will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

"
  TAIL_NO_LINKS=""
  OLD_LINKS=""
fi

# Compose the new reference link.
PREV_VERSION=$(awk '/^\[.*\]:/{match($0,/\[([^]]+)\]/,a); print a[1]; exit}' "$ROOT_CHANGELOG" 2>/dev/null || true)

if [[ -n "$PREV_VERSION" ]]; then
  NEW_LINK="[$VERSION]: $REPO_URL/compare/v${PREV_VERSION}...v${VERSION}"
else
  NEW_LINK="[$VERSION]: $REPO_URL/releases/tag/v${VERSION}"
fi

# Write everything to the temp file, then replace the original.
{
  printf '%s\n' "$HEAD"
  printf '%s\n\n' "$NEW_ENTRY"
  if [[ -n "$TAIL_NO_LINKS" ]]; then
    printf '%s\n' "$TAIL_NO_LINKS"
  fi
  # Reference links block.
  printf '\n%s\n' "$NEW_LINK"
  if [[ -n "$OLD_LINKS" ]]; then
    printf '%s\n' "$OLD_LINKS"
  fi
} > "$TEMP_FILE"

mv "$TEMP_FILE" "$ROOT_CHANGELOG"

echo "✓ CHANGELOG.md updated with version $VERSION ($DATE)"
echo "  Sources merged:"
echo "    • $CORE_CHANGELOG"
echo "    • $EVENTS_CHANGELOG"
echo "    • $STORAGE_CHANGELOG"
