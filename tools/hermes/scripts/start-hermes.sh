#!/usr/bin/env zsh
# Lance Hermes Agent avec la config Sokar
# Usage: zsh tools/hermes/scripts/start-hermes.sh

set -euo pipefail

REPO_ROOT="/Users/hamza/Desktop/Sokar"
HERMES_BIN_DIR="$HOME/Library/Python/3.14/bin"
export PATH="$HERMES_BIN_DIR:$PATH"

# Charger les variables du projet
set -a
source "$REPO_ROOT/.env" 2>/dev/null || true
set +a

# Vérifications
if ! command -v hermes &> /dev/null; then
    echo "[ERROR] Hermes non trouvé. Lance d'abord: zsh $REPO_ROOT/tools/hermes/scripts/setup.sh"
    exit 1
fi

if [ -z "${OPENCODE_GO_API_KEY:-}" ]; then
    echo "[ERROR] OPENCODE_GO_API_KEY non défini."
    echo "  Ajoute-le dans $REPO_ROOT/.env ou exporte-le dans ton shell."
    exit 1
fi

echo "[SOKAR-AGENT] Démarrage d'Hermes..."
echo "  Live config: ~/.hermes/config.yaml"
echo "  Project template: $REPO_ROOT/tools/hermes/config/hermes-config.yaml"
echo ""

# Lancer Hermes (lit ~/.hermes/config.yaml)
hermes
