#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Stop hook — keeps the docs in step with the code, automatically.
#
# After every Claude Code turn it asks one question: did any SOURCE files
# change that belong to a DOC which did NOT change with them? If so, it tells
# Claude to run the update skill and bring the docs up to date before stopping.
#
# Properties (the things that make this work):
#   * Diff-driven  — only looks at this branch + working tree, never the whole repo.
#   * Automatic    — it triggers the update skill itself; the developer is NOT prompted.
#                    The result is reviewed in the pull request (that's the safety net).
#   * Advisory     — always exits 0; it never fails a build or blocks your work.
#   * Loop-safe    — does nothing if it was itself triggered by a previous Stop.
#   * Portable     — runs on bash 3.2 (the default shell on macOS); no python/jq needed.
#
# Set the CONFIGURE block below for your repo (docs folder, source file types,
# base branch). The defaults work for many projects as-is.
# ---------------------------------------------------------------------------
set -euo pipefail

# ===== CONFIGURE for your repo ============================================
DOCS_DIR="docs"                  # folder where your generated docs (*.md) live
UPDATE_SKILL="update-docs"       # the skill the hook runs to fix drift
PRIMARY_BASE="origin/main"       # base branch (only used when COMPARE_MODE="branch")
PRIMARY_BASE_ALT="origin/master" # fallback base branch

# What the docs must keep up with:
#   local  → your uncommitted + staged edits only. Works on ANY branch, including a freshly
#            installed kit not yet merged to your base branch. (Recommended — the workshop relies
#            on this.) Workflow: commit a generated doc, then edit its code → the hook flags it.
#   branch → also include everything on this branch vs the base branch. Catches drift already
#            committed across a whole PR, but only once your docs live on the base branch (before
#            that, a freshly-added doc looks "fresh" and masks real drift). Switch after merging.
COMPARE_MODE="local"

# Which changed files count as "source"? Broad on purpose so any stack works.
is_source() {
    case "$1" in
        *.kt|*.java|*.ts|*.tsx|*.js|*.py|*.go|*.rb|*.cs|*.php|*.rs|*.sql|*.proto|*.json|*.yaml|*.yml) return 0 ;;
        *) return 1 ;;
    esac
}

# Doc files that are NOT area docs (skip them when matching).
is_index_doc() {
    case "$1" in
        README|CHANGELOG|index|overview) return 0 ;;
        *) return 1 ;;
    esac
}
# ===========================================================================

# Prevent loops: if this Stop was triggered by a previous hook iteration, do nothing.
input="$(cat 2>/dev/null || true)"
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
    exit 0
fi

# Must be a git repo that has a docs folder.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$repo_root" ] && exit 0
cd "$repo_root"
[ -d "$DOCS_DIR" ] || exit 0

# Base ref — only consulted in "branch" mode. In "local" mode we look at the working tree + staged
# changes only, which works on any branch (even a fresh install that isn't merged yet).
base=""
if [ "$COMPARE_MODE" = "branch" ]; then
    base_ref="$PRIMARY_BASE"
    git rev-parse --verify --quiet "$base_ref" >/dev/null 2>&1 || base_ref="$PRIMARY_BASE_ALT"
    base="$(git merge-base "$base_ref" HEAD 2>/dev/null || true)"
fi

# Changed files = branch diff (if any) + staged + unstaged.
changed="$(
    {
        [ -n "$base" ] && git diff --name-only "$base"...HEAD 2>/dev/null
        git diff --name-only 2>/dev/null
        git diff --cached --name-only 2>/dev/null
    } | sort -u
)"
[ -z "$changed" ] && exit 0

# Doc "stems" = doc filenames (without the index/changelog ones).
stems="$(
    for f in "$DOCS_DIR"/*.md; do
        [ -e "$f" ] || continue
        b="$(basename "$f" .md)"
        is_index_doc "$b" && continue
        echo "$b"
    done
)"
[ -z "$stems" ] && exit 0

# Which docs do the changed source files touch? (filename token match)
affected=""
while IFS= read -r file; do
    case "$file" in "$DOCS_DIR"/*) continue ;; esac   # ignore the docs themselves
    is_source "$file" || continue
    lc="$(printf '%s' "$file" | tr '[:upper:]' '[:lower:]')"
    while IFS= read -r stem; do
        [ -z "$stem" ] && continue
        case "$lc" in *"$stem"*) affected="$affected $stem" ;; esac
    done <<< "$stems"
done <<< "$changed"

affected="$(printf '%s' "$affected" | tr ' ' '\n' | sed '/^$/d' | sort -u)"
[ -z "$affected" ] && exit 0

# Drop docs that were already updated in this same change.
stale=""
while IFS= read -r stem; do
    [ -z "$stem" ] && continue
    if printf '%s\n' "$changed" | grep -q "^$DOCS_DIR/$stem\.md$"; then
        continue
    fi
    stale="$stale $stem"
done <<< "$affected"

stale="$(printf '%s' "$stale" | tr ' ' '\n' | sed '/^$/d' | sort -u)"
[ -z "$stale" ] && exit 0

# Build a "docs/foo.md, docs/bar.md" list (join with ', ' portably).
docs_list="$(printf '%s' "$stale" | sed "s#^#$DOCS_DIR/#; s#\$#.md#" | paste -sd, - | sed 's/,/, /g')"

# Keep the reason JSON-safe (no double quotes / backslashes / newlines).
reason="Changed source files belong to docs that were not updated yet: ${docs_list}. Run the ${UPDATE_SKILL} skill now (call the Skill tool, diff mode) and update the docs automatically before you stop. Do NOT ask for confirmation; the changes are reviewed in the PR. Verify all related source files before removing anything from a doc."

printf '{"decision":"block","reason":"%s"}\n' "$reason"
exit 0
