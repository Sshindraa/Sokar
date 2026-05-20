#!/usr/bin/env zsh
# Lance Hermes Agent avec la config Sokar
# Usage: zsh agent/scripts/start-hermes.sh

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
    echo "[ERROR] Hermes non trouvé. Lance d'abord: zsh $REPO_ROOT/agent/scripts/setup.sh"
    exit 1
fi

if [ -z "${WINDSURF_TOKEN:-}" ]; then
    echo "[ERROR] WINDSURF_TOKEN non défini."
    echo "  Dans Windsurf: Ctrl+Shift+P → 'Provide auth token' → copie le token"
    echo "  export WINDSURF_TOKEN=ton_token"
    exit 1
fi

echo "[SOKAR-AGENT] Démarrage d'Hermes..."
echo "  Config: $REPO_ROOT/agent/config/hermes-config.yaml"
echo "  Token:  ${WINDSURF_TOKEN:0:10}..."
echo ""

# Lancer Hermes avec le modèle executor Sokar
hermes --provider=openrouter --model=deepseek/deepseek-v4-flash
