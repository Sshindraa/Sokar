# Callyx — Sprint 2 : Brief Technique Agent Code
### Différenciation Économique — Mai/Juin 2026

---

## 🎯 Objectif du Sprint 2

Rendre Callyx **rentable et différencié** : migrer vers Telnyx + Deepgram, ajouter la mémoire client, le cache TTS, et le dashboard ROI. Durée réaliste : **5 à 7 semaines**.

> ⚠️ La migration Vapi → Telnyx est le risque #1 du sprint. L'attaquer en semaine 1 à froid. Ne pas commencer par le dashboard.

---

## 📁 Nouveaux fichiers — delta vs Sprint 1

```
callyx/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── voice/
│   │   │   │   │   ├── telnyx.pipeline.ts   ← remplace pipeline.ts (Vapi)
│   │   │   │   │   ├── telnyx.guard.ts       ← remplace webhook.guard.ts
│   │   │   │   │   ├── tts-cache.ts          ← NOUVEAU cache TTS Redis
│   │   │   │   │   └── fillers.ts            ← déjà présent, enrichi
│   │   │   │   ├── customers/                ← NOUVEAU module
│   │   │   │   │   ├── customer.service.ts
│   │   │   │   │   └── customer.schema.ts
│   │   │   │   └── analytics/
│   │   │   │       ├── report.service.ts     ← enrichi avec ROI
│   │   │   │       └── roi.service.ts        ← NOUVEAU calcul économies TheFork
│   │   │   └── shared/
│   │   │       ├── queue/
│   │   │       │   └── workers/
│   │   │       │       ├── sms-confirmation.worker.ts  ← implémenté (était vide)
│   │   │       │       └── outbound-confirm.worker.ts  ← NOUVEAU rappels sortants
│   │   │       └── telnyx/
│   │   │           └── client.ts             ← NOUVEAU SDK Telnyx
├── packages/
│   └── database/prisma/schema.prisma         ← nouvelles tables
```

---

## 🗄️ Schéma Base de Données — Delta Sprint 2

Ajouter à `packages/database/prisma/schema.prisma` :

```prisma
// ─── Nouveaux modèles Sprint 2 ───────────────────────────────────────────────

model Customer {
  id              String        @id @default(uuid())
  restaurantId    String        @map("restaurant_id")
  phone           String
  name            String?
  visitCount      Int           @default(0) @map("visit_count")
  loyaltyScore    Decimal       @default(0) @map("loyalty_score") @db.Decimal(5, 2)
  isVip           Boolean       @default(false) @map("is_vip")
  notes           String?
  specialOccasion String?       @map("special_occasion")
  // embedding   Unsupported("vector(1536)")?   ← Sprint 3 avec pgvector
  lastSeenAt      DateTime?     @map("last_seen_at")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")
  restaurant      Restaurant    @relation(fields: [restaurantId], references: [id])
  reservations    Reservation[]
  @@unique([restaurantId, phone])
  @@index([restaurantId, isVip])
  @@map("customers")
}

model LatencyTrace {
  id             String   @id @default(uuid())
  callId         String   @map("call_id")
  vadEndMs       Int?     @map("vad_end_ms")
  sttFinalMs     Int?     @map("stt_final_ms")
  llmFirstToken  Int?     @map("llm_first_token_ms")
  ttsFirstByte   Int?     @map("tts_first_byte_ms")
  audioPlayingMs Int?     @map("audio_playing_ms")
  totalE2eMs     Int?     @map("total_e2e_ms")
  createdAt      DateTime @default(now()) @map("created_at")
  @@index([callId])
  @@map("latency_traces")
}

// ─── Modifications sur modèles existants ─────────────────────────────────────

// Ajouter dans model Call :
//   llmProvider   String?  @map("llm_provider")
//   ttsProvider   String?  @map("tts_provider")
//   sttProvider   String?  @map("stt_provider")
//   carrier       String?
//   latencyTrace  LatencyTrace?

// Ajouter dans model Reservation :
//   customerId       String?  @map("customer_id")
//   customer         Customer? @relation(fields: [customerId], references: [id])
//   confirmedRevenue Decimal? @map("confirmed_revenue") @db.Decimal(10, 2)

// Ajouter dans model Restaurant :
//   customers      Customer[]
//   theforkSavings Decimal @default(0) @map("thefork_savings") @db.Decimal(10, 2)
```

---

## 🔌 Variables d'Environnement — Delta Sprint 2

```env
# ─── Telnyx ────────────────────────────────────────────────────────────────
TELNYX_API_KEY="KEY..."
TELNYX_PUBLIC_KEY="..."
TELNYX_APP_ID="..."
TELNYX_WEBHOOK_SECRET="..."
TELNYX_FROM_NUMBER="+33XXXXXXXXX"

# ─── Deepgram STT ──────────────────────────────────────────────────────────
DEEPGRAM_API_KEY="..."
DEEPGRAM_MODEL="nova-3"

# ─── Cartesia TTS (fallback ElevenLabs) ────────────────────────────────────
CARTESIA_API_KEY="..."

# ─── Feature flags ─────────────────────────────────────────────────────────
TTS_CACHE_ENABLED="true"
VIP_PUSH_ENABLED="true"
```
(Voir le brief complet pour les LLM_MODELS et autres constantes)
