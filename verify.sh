#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Preflight check for the self-maintaining-docs setup.
# Run from inside your repo (after following the README setup steps):
#   ./verify.sh
# It reports ✅/❌ per check so you're not debugging mid-exercise. Exits non-zero
# if anything needs fixing. Portable (bash 3.2, no python/jq).
# ---------------------------------------------------------------------------
set -uo pipefail   # intentionally no -e: run every check, then report

pass=0; fail=0
ok()  { printf '✅ %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '❌ %s\n' "$1"; [ -n "${2:-}" ] && printf '   → %s\n' "$2"; fail=$((fail + 1)); }

# Work from the git root so paths are stable.
root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -n "$root" ]; then cd "$root"; ok "git repo detected ($root)"; else
    bad "not a git repo" "run this from inside your project's git repository"
fi

HOOK=".claude/hooks/check-docs.sh"
SETTINGS=".claude/settings.json"

# Hook present + executable
if [ -f "$HOOK" ]; then
    if [ -x "$HOOK" ]; then ok "$HOOK exists and is executable"
    else bad "$HOOK is not executable" "chmod +x $HOOK"; fi
else
    bad "$HOOK missing" "copy dot-claude/hooks/check-docs.sh into .claude/hooks/"
fi

# Hook registered under Stop
if [ -f "$SETTINGS" ] && grep -q "check-docs.sh" "$SETTINGS"; then
    ok "Stop hook registered in $SETTINGS"
else
    bad "Stop hook not registered in $SETTINGS" "merge dot-claude/settings.snippet.json into $SETTINGS"
fi

# Skills present
for s in generate-docs update-docs; do
    if [ -f ".claude/skills/$s/SKILL.md" ]; then ok "skill present: $s"
    else bad "skill missing: $s" "copy dot-claude/skills/$s/ into .claude/skills/"; fi
done

# Docs dir — read from the hook config (default: docs)
DOCS_DIR="docs"
if [ -f "$HOOK" ]; then
    v="$(grep -E '^DOCS_DIR=' "$HOOK" | head -1 | cut -d'"' -f2)"
    [ -n "$v" ] && DOCS_DIR="$v"
fi

# HTML companion assets present
for a in "$DOCS_DIR/html/assets/styles.css" "$DOCS_DIR/html/assets/app.js"; do
    if [ -f "$a" ]; then ok "asset present: $a"
    else bad "asset missing: $a" "copy html-assets/ into $DOCS_DIR/html/"; fi
done
if [ -f "$DOCS_DIR/html/index.html" ]; then ok "directory page: $DOCS_DIR/html/index.html"
else bad "missing $DOCS_DIR/html/index.html" "copy html-assets/index.html into $DOCS_DIR/html/"; fi

# Placeholders filled in the skills
left=""
for tok in '<DOCS_DIR>' '<SOURCE LOCATIONS>' '<SOURCE TYPES>'; do
    if grep -rqF "$tok" .claude/skills 2>/dev/null; then left="$left $tok"; fi
done
if [ -z "$left" ]; then ok "placeholders filled in the skills"
else bad "placeholders still unfilled:$left" "search-and-replace them in .claude/skills/ with your values"; fi

# Summary
echo ""
if [ "$fail" -eq 0 ]; then
    printf 'All good — %s checks passed. Run  /generate-docs <area>  to start.\n' "$pass"
    exit 0
else
    printf '%s passed, %s to fix — see the → hints above.\n' "$pass" "$fail"
    exit 1
fi
