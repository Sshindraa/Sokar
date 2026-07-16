#!/usr/bin/env bash
# Empêche `next build` d'écraser le .next d'un `next dev` tournant sur la même app.
#
# Contexte : Next.js partage un unique répertoire de sortie (.next) entre `dev`
# et `build`. Builder par-dessus un dev actif corrompt le cache webpack et crashe
# le runtime au premier rendu :
#   TypeError: __webpack_modules__[moduleId] is not a function
#
# Usage : guard-next-build.sh <port> [app-name]
#   <port>  port d'écoute de l'app en dev (ex. 3000 pour le dashboard)
#   [app]   nom affiché dans le message d'erreur
#
# Override : NEXT_BUILD_ALLOW_DEV=1 autorise le build malgré un dev actif
#            (à utiliser seulement si le dev server est sur une autre machine/port).
set -euo pipefail

PORT="${1:-3000}"
APP="${2:-cette app}"

if [ "${NEXT_BUILD_ALLOW_DEV:-}" = "1" ]; then
  exit 0
fi

dev_listening() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1 && return 0
    return 1
  fi
  # Pas de lsof : on ne bloque PAS par défaut. Un faux positif (bloquer un build
  # légitime en CI/prod) coûte plus cher qu'un crash webpack rare et récupérable.
  # Le déploiement VPS stoppe Next avant de builder (scripts/deploy-vps.sh:333).
  return 1
}

if dev_listening; then
  echo "🛑 Build annulé : un serveur Next écoute déjà sur :${PORT} (probablement \`next dev\` de ${APP})."
  echo "   Arrête-le (Ctrl-C / kill) avant de builder, sinon le cache .next sera corrompu"
  echo "   et le dashboard crashera avec : __webpack_modules__[moduleId] is not a function."
  echo "   Pour forcer quand même : NEXT_BUILD_ALLOW_DEV=1 pnpm --filter ${APP} build"
  exit 1
fi

exit 0
