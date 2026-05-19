#!/bin/zsh
# Setup Vapi Dev Environment
# Usage: ./setup-vapi-dev.sh

set -e

REPO="/Users/hamza/Desktop/Callyx"
LOG="$REPO/.vapi-dev.log"

echo "╔════════════════════════════════════════╗"
echo "║     Callyx Vapi Dev Setup              ║"
echo "╚════════════════════════════════════════╝"
echo ""

# ── 1. Check ngrok ──
if ! command -v ngrok &>/dev/null; then
  echo "❌ ngrok non installé. Installe-le :"
  echo "   brew install ngrok"
  echo "   ngrok config add-authtoken <TON_TOKEN>"
  exit 1
fi
echo "✅ ngrok trouvé"

# ── 2. Check .env ──
if [[ ! -f "$REPO/apps/api/.env" ]]; then
  echo "❌ Fichier .env manquant dans apps/api/.env"
  exit 1
fi

if ! grep -q "VAPI_API_KEY" "$REPO/apps/api/.env"; then
  echo "⚠️  VAPI_API_KEY non trouvé dans .env"
  echo "   Ajoute : VAPI_API_KEY=sk_vapi_..."
  exit 1
fi
echo "✅ VAPI_API_KEY configuré"

# ── 3. Start ngrok in background ──
echo ""
echo "🚀 Démarrage ngrok (port 4000)..."
ngrok http 4000 --log=stdout > "$LOG" 2>&1 &
NGROK_PID=$!
echo "   PID: $NGROK_PID"
echo "   Logs: $LOG"

# ── 4. Wait for URL ──
echo ""
echo "⏳ Attente de l'URL ngrok..."
NGROK_URL=""
for i in {1..30}; do
  NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4)
  if [[ -n "$NGROK_URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$NGROK_URL" ]]; then
  echo "❌ Impossible d'obtenir l'URL ngrok"
  kill $NGROK_PID 2>/dev/null || true
  exit 1
fi

WEBHOOK_URL="${NGROK_URL}/webhooks/vapi"
echo "✅ ngrok URL: $NGROK_URL"
echo "✅ Webhook URL: $WEBHOOK_URL"

# ── 5. Export config for Vapi dashboard ──
echo ""
echo "📋 Configuration pour le dashboard Vapi :"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Server URL    : $WEBHOOK_URL"
echo "First Message : Bonjour, je suis l'assistant virtuel de votre restaurant. Comment puis-je vous aider ?"
echo "Model         : gpt-4o"
echo "Voice         : ElevenLabs → Adam (français)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── 6. Start API ──
echo "🚀 Démarrage de l'API Fastify..."
echo "   (Dans un autre terminal, lance : pnpm dev)"
echo ""
echo "💡 Copie cette URL dans le dashboard Vapi :"
echo "   $WEBHOOK_URL"
echo ""
echo "📖 Docs : docs/obsidian/Vapi Integration.md"
echo ""
echo "⏹️  Pour arrêter : kill $NGROK_PID"

# Save webhook URL for reference
echo "$(date '+%Y-%m-%d %H:%M:%S') — $WEBHOOK_URL" >> "$REPO/.vapi-webhook-urls.log"

# Keep script alive to show ngrok is running
echo ""
echo "Ngrok tourne en arrière-plan. Appuie sur Ctrl+C pour arrêter."
echo ""
wait $NGROK_PID
