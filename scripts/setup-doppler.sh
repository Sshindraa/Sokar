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

doppler configure set token "$token" --scope /opt/sokar

echo ""
echo "📁 Création du projet 'sokar'..."
doppler projects create sokar --scope /opt/sokar 2>/dev/null || echo "  Projet existe déjà"

echo ""
echo "🔐 Upload des secrets depuis le .env local..."
doppler secrets upload --project sokar --config dev /opt/sokar/.env 2>/dev/null || {
  echo "  Upload manuel nécessaire. Copie les secrets depuis .env vers Doppler:"
  echo "  → https://dashboard.doppler.com/workplace/projects/sokar/secrets"
}

echo ""
echo "📥 Download du .env local depuis Doppler..."
echo "  doppler secrets download --project sokar --config dev --no-file --format env > .env"
echo ""
echo "✅ Fait ! Ajoute cette ligne dans ~/.zshrc pour charger Doppler automatiquement :"
echo '  eval "$(doppler configure --scope /opt/sokar)"'
