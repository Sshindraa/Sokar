#!/usr/bin/env bash
# Check if the system is under memory pressure before allowing git operations.
# Git pack-objects in parallel can crash with SIGBUS (signal 10) on
# memory-constrained systems, especially when:
#   - Swap usage > 50% of total
#   - Free RAM < 500MB
#   - Multiple parallel processes (e.g. husky pre-push) are running
#
# Workaround: git config --global pack.threads 1 (set in setup-new-mac.sh)
# But it's also useful to fail fast if the system is too constrained.
#
# Usage: scripts/quality/check-memory.sh [warn|fail]
#   warn (default) : prints a warning, returns 0
#   fail           : returns 1 if system is under pressure

set -euo pipefail

MODE="${1:-warn}"

# Skip on non-macOS (we don't have swap info the same way)
if [ "$(uname -s)" != "Darwin" ]; then
  exit 0
fi

# Read swap usage (macOS-specific)
# Output format: "vm.swapusage: total = 7168.00M  used = 5763.00M  free = 1405.00M  (encrypted)"
SWAP_LINE=$(sysctl vm.swapusage 2>/dev/null)
SWAP_USED_MB=$(echo "$SWAP_LINE" | sed -n 's/.*used = \([0-9.]*\)M.*/\1/p' | cut -d. -f1)
SWAP_TOTAL_MB=$(echo "$SWAP_LINE" | sed -n 's/.*total = \([0-9.]*\)M.*/\1/p' | cut -d. -f1)

# Read free RAM (macOS top)
FREE_MB=$(top -l 1 -n 0 -s 0 2>/dev/null | grep PhysMem | awk '{for(i=1;i<=NF;i++) if($i=="unused") {print $(i-1); exit}}' | tr -d 'M')

PRESSURE=false
MSG=""

if [ -n "${SWAP_USED_MB:-}" ] && [ -n "${SWAP_TOTAL_MB:-}" ] && [ "$SWAP_TOTAL_MB" -gt 0 ]; then
  SWAP_PCT=$((SWAP_USED_MB * 100 / SWAP_TOTAL_MB))
  if [ "$SWAP_PCT" -gt 50 ]; then
    PRESSURE=true
    MSG="$MSG swap=${SWAP_USED_MB}MB/${SWAP_TOTAL_MB}MB (${SWAP_PCT}%)"
  fi
fi

if [ -n "${FREE_MB:-}" ] && [ "$FREE_MB" -lt 500 ]; then
  PRESSURE=true
  MSG="$MSG free_ram=${FREE_MB}MB"
fi

if [ "$PRESSURE" = true ]; then
  echo "⚠️  Système sous pression mémoire :$MSG"
  echo "   git push peut planter avec 'pack-objects died of signal 10'."
  echo "   Workaround : git config --global pack.threads 1 (déjà appliqué)."
  echo "   Conseil : ferme les apps lourdes (IDE, Docker, etc.) avant de push."
  if [ "$MODE" = "fail" ]; then
    exit 1
  fi
fi

exit 0
