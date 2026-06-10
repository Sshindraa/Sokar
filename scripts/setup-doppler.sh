#!/bin/bash
# Doppler Setup — Sokar Secrets Management
# Usage: bash scripts/setup-doppler.sh
set -e

echo "🚀 Sokar — Doppler Setup"
echo "========================="
echo ""

# Check doppler CLI
if ! command -v doppler &>/dev/null; then
  echo "📦 Installing Doppler CLI..."
  brew install dopplerhq/cli/doppler
fi

echo "🔑 Authentification Doppler..."
echo "  Ouvre https://dashboard.doppler.com → Login → Settings → Tokens"
echo "  Crée un token 'Sokar Local' avec accès au projet 'sokar'"
echo ""
read -sp "  Colle ton DOPPLER_TOKEN ici : " token
echo ""

# Determine local or production scope
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOPE="${REPO_ROOT}"
# If we are on production, scope is /opt/sokar
if [ -d "/opt/sokar" ] && [ "$PWD" = "/opt/sokar" ]; then
  SCOPE="/opt/sokar"
fi

doppler configure set token "$token" --scope "$SCOPE"

echo ""
echo "📁 Création du projet 'sokar'..."
doppler projects create sokar --scope "$SCOPE" 2>/dev/null || echo "  Projet existe déjà"

echo ""
echo "🔐 Upload des secrets depuis le .env local..."
doppler secrets upload --project sokar --config dev "$SCOPE/.env" 2>/dev/null || {
  echo "  Upload manuel nécessaire. Copie les secrets depuis .env vers Doppler:"
  echo "  → https://dashboard.doppler.com/workplace/projects/sokar/secrets"
}

echo ""
echo "📥 Download du .env local depuis Doppler..."
echo "  doppler secrets download --project sokar --config dev --no-file --format env > .env"
echo ""
echo "✅ Fait ! Ajoute cette ligne dans ~/.zshrc pour charger Doppler automatiquement :"
echo "  eval \"\$(doppler configure --scope $SCOPE)\""
