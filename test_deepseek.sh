#!/usr/bin/env bash
# Test deepseek-v4-flash via Crof AI
set -euo pipefail

RESP=$(curl -s https://crof.ai/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${CROF_API_KEY:-$OPENROUTER_API_KEY}" \
  -d '{
    "model": "deepseek-v4-flash",
    "messages": [
      {"role": "user", "content": "Salut, quel modèle es-tu exactement et quel fournisseur te sert ? Reponds en UNE phrase cleare."}
    ],
    "max_tokens": 100
  }')

echo "$RESP" | python3 -c "
import json,sys
data=json.load(sys.stdin)
if 'error' in data:
    print('ERROR:', data['error'])
else:
    c=data['choices'][0]
    print('MODEL:', data['model'])
    print('REPONSE:', c['message']['content'])
    print('FINISH:', c['finish_reason'])
"
