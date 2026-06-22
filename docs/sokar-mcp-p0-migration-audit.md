# Sokar Agentic Reservations — Audit Prisma exact + Migration P0

> **Statut** : audit réel du schéma + proposition de migration P0 additive.
> **Pas de code MCP tant que cette migration n'est pas appliquée + testée.**
> **Décisions cadrées par Hamza le 2026-06-20.**

---

## 1. Audit exact du `schema.prisma` (200 lignes)

### 1.1 Modèles présents (8)

| Modèle             | Lignes  | Champs  |
| ------------------ | ------- | ------- |
| `Restaurant`       | 16-44   | 18      |
| `Call`             | 46-67   | 13      |
| `Reservation`      | 69-94   | 13      |
| `AgentPersonality` | 96-110  | 8       |
| `CallQuota`        | 112-121 | 3       |
| `Customer`         | 123-143 | 11      |
| `LatencyTrace`     | 145-158 | 7       |
| (enums, fin)       | 160-200 | 7 enums |

### 1.2 Enums présents (7)

- `Plan` (ESSENTIAL/STARTER/PRO/PREMIUM)
- `CallIntent` (RESERVATION/HOURS/MENU/CANCEL/OTHER)
- `CallOutcome` (RESERVED/INFO/NO_ACTION/HANDOFF/ERROR)
- `ReservationStatus` (CONFIRMED/CANCELLED/NO_SHOW/SEATED) ← **4 valeurs, à étendre à 8**
- `ProfileType`, `FillerStyle`, etc.

### 1.3 Inventaire EXACT des champs manquants

Rectification de l'erreur de comptage précédente : il y a **17 ajouts
Restaurant + 10 ajouts Reservation + 4 nouveaux modèles + 2 nouveaux
enums + 1 nouvel enum à étendre**, soit **34 changements P0**, pas 13.

#### Restaurant (P0 = 10 ajouts)

| #   | Champ                  | Type           | Nullable | Default        | Notes                             |
| --- | ---------------------- | -------------- | -------- | -------------- | --------------------------------- |
| 1   | `slug`                 | String @unique | non      | —              | URL canonique                     |
| 2   | `lat`                  | Decimal(9,6)   | oui      | null           |                                   |
| 3   | `lng`                  | Decimal(9,6)   | oui      | null           |                                   |
| 4   | `timezone`             | String         | non      | "Europe/Paris" |                                   |
| 5   | `phoneE164`            | String         | oui      | null           |                                   |
| 6   | `formattedAddress`     | String         | oui      | null           |                                   |
| 7   | `agenticOptIn`         | Boolean        | non      | false          |                                   |
| 8   | `openaiReserveEnabled` | Boolean        | non      | false          |                                   |
| 9   | `policyVersion`        | String         | non      | "2026-06-20"   | snapshot version                  |
| 10  | `exposureSettings`     | relation 1:1   | oui      | —              | vers `RestaurantExposureSettings` |

#### Restaurant (P1 = 7 ajouts, à NE PAS faire maintenant)

- `canonicalUrl`, `websiteUrl`, `cuisineType[]`, `priceRange`,
  `ambiance[]`, `noiseLevel`, `dietary[]`, `attributeConfidence` (Json)

#### Reservation (P0 = 10 ajouts)

| #   | Champ                    | Type               | Nullable | Default | Notes                      |
| --- | ------------------------ | ------------------ | -------- | ------- | -------------------------- |
| 1   | `channel`                | ReservationChannel | non      | PHONE   | nouvel enum                |
| 2   | `state`                  | ReservationState   | non      | PENDING | étendu (8 valeurs)         |
| 3   | `startsAt`               | DateTime           | oui      | null    |                            |
| 4   | `endsAt`                 | DateTime           | oui      | null    |                            |
| 5   | `holdExpiresAt`          | DateTime           | oui      | null    |                            |
| 6   | `idempotencyKey`         | String @unique     | oui      | null    | nullable au début          |
| 7   | `specialRequests`        | String             | oui      | null    |                            |
| 8   | `createdByClient`        | String             | oui      | null    | identifie l'agent appelant |
| 9   | `cancellationPolicySnap` | Json               | oui      | null    | snapshot au moment T       |
| 10  | `noShowPolicySnap`       | Json               | oui      | null    | snapshot au moment T       |

Note : `consents` n'est PAS sur Reservation directement dans P0. On le
stoke dans un nouveau modèle `ReservationConsent` lié 1:N pour historiser
les consentements par résa (et permettre des modifs RGPD propres).

**Rectification** : en relisant la v2 de la spec, le `consents` est
intégré à la résa (Json) ET historisé. Pour P0 on garde uniquement
Json sur Reservation, sans table d'historique dédiée. L'historique
viendra en P1 si on en a besoin.

#### Reservation (P0 aussi = 1 champ Json)

| #   | Champ      | Type | Nullable | Default | Notes          |
| --- | ---------- | ---- | -------- | ------- | -------------- |
| 11  | `consents` | Json | non      | "{}"    | RGPD structuré |

→ Total Reservation P0 = **11 champs** (pas 10). Recompte corrigé.

#### Modèles 100% nouveaux (4)

1. `AgenticHold` (10 champs, 4 index)
2. `ReservationAuditLog` (9 champs, 2 index, append-only)
3. `RestaurantExposureSettings` (12 champs, 1 relation)
4. (P1) `AgentClient` — **PAS en P0**

→ **3 modèles en P0**.

#### Enums (1 à étendre, 2 nouveaux)

- `ReservationStatus` → **renommer en `ReservationState`** et étendre
  (PENDING, CONFIRMED, SEATED, HONORED, CANCELLED, NO_SHOW, FAILED,
  EXPIRED). ATTENTION : casse le code existant qui référence
  `ReservationStatus.CONFIRMED` etc. Voir §3.3 (stratégie de migration).
- `ReservationChannel` (nouveau) : PHONE, WEB, MCP, OPENAI_RESERVE, ADMIN, API
- `HoldType` (nouveau) : QUOTE, HOLD
- `NoiseLevel` (nouveau, P1, pas P0)
- `AgentClientType` (nouveau, P1, pas P0)
- `AgentClientStatus` (nouveau, P1, pas P0)

→ **1 enum étendu + 2 nouveaux enums en P0**.

---

## 2. Récapitulatif inventaire P0

| Type de changement   | Compte             |
| -------------------- | ------------------ |
| Champs `Restaurant`  | 10                 |
| Champs `Reservation` | 11                 |
| Modèles nouveaux     | 3                  |
| Enums étendus        | 1                  |
| Enums nouveaux       | 2                  |
| **TOTAL P0**         | **27 changements** |

→ Recompte corrigé : **27 changements P0**, pas 13.
La précédente approximation ("13 champs manquants") sous-estimait
l'addition Reservation et ignorait les nouveaux modèles + enums.

---

## 3. Stratégie de migration P0

### 3.1 Principes

- **100% additive** : aucune colonne supprimée, aucun enum renommé
  brutalement, aucun default destructif.
- **Nullable par défaut** : un champ NOT NULL doit avoir un default
  explicite compatible avec les données existantes.
- **Backfill minimal** : remplir `state = 'CONFIRMED'` pour les
  réservations existantes (équivalent sémantique du `ReservationStatus`
  actuel).
- **Rollback plan** : une migration additive se rollback en supprimant
  les colonnes ajoutées. Documenté dans le fichier de migration.

### 3.2 Champs NOT NULL avec default

| Champ                             | Default        | Raison                                            |
| --------------------------------- | -------------- | ------------------------------------------------- |
| `Restaurant.slug`                 | —              | Pas de default ; backfill obligatoire (voir §3.4) |
| `Restaurant.timezone`             | "Europe/Paris" | Valeur safe                                       |
| `Restaurant.agenticOptIn`         | false          | Opt-in par défaut                                 |
| `Restaurant.openaiReserveEnabled` | false          | Opt-in par défaut                                 |
| `Restaurant.policyVersion`        | "2026-06-20"   | Version courante                                  |
| `Reservation.channel`             | PHONE          | Toutes les résas existantes = phone               |
| `Reservation.state`               | CONFIRMED      | Backfill depuis `ReservationStatus`               |
| `Reservation.consents`            | "{}"           | Pas de consent historisé pour legacy              |

### 3.3 Stratégie pour l'enum `ReservationStatus` → `ReservationState`

L'enum actuel `ReservationStatus { CONFIRMED, CANCELLED, NO_SHOW,
SEATED }` est utilisé dans le code existant (probablement des
`.findMany({ where: { status: 'CONFIRMED' }})`).

**Option A (choisie)** :

- Garder l'enum `ReservationStatus` intact (legacy)
- Ajouter le nouvel enum `ReservationState`
- Champ `Reservation.state` utilise `ReservationState` (le nouveau)
- Backfill : pour chaque résa existante, mapper
  `ReservationStatus → ReservationState` :
  - `CONFIRMED` → `CONFIRMED`
  - `CANCELLED` → `CANCELLED`
  - `NO_SHOW` → `NO_SHOW`
  - `SEATED` → `SEATED`
- Laisserr `Reservation.status` (ancien) coexister pendant 1 cycle
  de release, puis le déprécier en P1 dans une migration séparée.

→ L'ancien code qui lit `Reservation.status` continue de marcher.
Le nouveau code lit `Reservation.state`. Pas de cassure.

### 3.4 Backfill de `Restaurant.slug`

Contrainte : `@unique` sur slug → on ne peut pas créer la colonne vide.

Stratégie :

1. Ajouter la colonne **nullable** (sans `@unique` dans la migration
   initiale).
2. Backfill : `UPDATE restaurants SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(id::text, 1, 8)`.
3. Vérifier unicité, résoudre les collisions manuellement (rare).
4. Ajouter la contrainte `@unique` et passer en NOT NULL.

→ 2 migrations au lieu d'1, mais safe. Si conflit, on ne casse pas
la table en plein milieu.

### 3.5 Rollback

```sql
-- Pseudo-rollback (chaque migration est réversible)

-- Migration 1 : ajout colonnes nullable Restaurant + Reservation
ALTER TABLE restaurants DROP COLUMN IF EXISTS slug;
ALTER TABLE restaurants DROP COLUMN IF EXISTS lat;
-- ...etc
ALTER TABLE reservations DROP COLUMN IF EXISTS state;
-- ...etc

-- Migration 2 : modèles nouveaux
DROP TABLE IF EXISTS agentic_holds CASCADE;
DROP TABLE IF EXISTS reservation_audit_log CASCADE;
DROP TABLE IF EXISTS restaurant_exposure_settings CASCADE;

-- Migration 3 : backfill slug + contrainte unique
-- (rollback = DROP COLUMN slug, on perd les slugs)
```

---

## 4. Proposition de migration P0 — fichiers à créer

### 4.1 Liste des migrations Prisma

| #   | Fichier                                                 | Contenu                                                                         |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `20260621000000_add_agentic_p0_columns/migration.sql`   | Colonnes nullable sur `restaurants` et `reservations`                           |
| 2   | `20260621001000_add_agentic_models/migration.sql`       | Tables `agentic_holds`, `reservation_audit_log`, `restaurant_exposure_settings` |
| 3   | `20260621002000_backfill_restaurant_slug/migration.sql` | Backfill slug + ajout contrainte unique                                         |
| 4   | `20260621003000_add_agentic_enums/migration.sql`        | Création enums `ReservationState`, `ReservationChannel`, `HoldType`             |

→ 4 migrations au total, chacune réversible, chacune additive.

### 4.2 Schéma Prisma cible (extraits P0)

```prisma
// ─── Extensions Restaurant (P0) ─────────────────────────
model Restaurant {
  // ...champs existants préservés (16-44 actuels)...

  slug                  String?  @unique @map("slug")
  lat                   Decimal? @db.Decimal(9, 6) @map("lat")
  lng                   Decimal? @db.Decimal(9, 6) @map("lng")
  timezone              String   @default("Europe/Paris") @map("timezone")
  phoneE164             String?  @map("phone_e164")
  formattedAddress      String?  @map("formatted_address")
  agenticOptIn          Boolean  @default(false) @map("agentic_opt_in")
  openaiReserveEnabled  Boolean  @default(false) @map("openai_reserve_enabled")
  policyVersion         String   @default("2026-06-20") @map("policy_version")

  exposureSettings      RestaurantExposureSettings?

  // ...relations existantes...
  @@map("restaurants")
}
```

```prisma
// ─── Extensions Reservation (P0) ────────────────────────
model Reservation {
  // ...champs existants préservés (69-94 actuels)...

  channel                 ReservationChannel  @default(PHONE) @map("channel")
  state                   ReservationState    @default(CONFIRMED) @map("state")
  startsAt                DateTime?           @map("starts_at")
  endsAt                  DateTime?           @map("ends_at")
  holdExpiresAt           DateTime?           @map("hold_expires_at")
  idempotencyKey          String?             @unique @map("idempotency_key")
  specialRequests         String?             @map("special_requests")
  createdByClient         String?             @map("created_by_client")
  cancellationPolicySnap  Json?               @map("cancellation_policy_snap")
  noShowPolicySnap        Json?               @map("no_show_policy_snap")
  consents                Json                @default("{}") @map("consents")

  // ...relations existantes...
  @@map("reservations")
}
```

```prisma
// ─── Nouveaux modèles P0 ────────────────────────────────
model AgenticHold {
  id              String        @id @default(uuid())
  restaurantId    String        @map("restaurant_id")
  type            HoldType
  partySize       Int           @map("party_size")
  slotStart       DateTime      @map("slot_start")
  slotEnd         DateTime      @map("slot_end")
  channel         ReservationChannel
  quoteToken      String?       @unique @map("quote_token")
  holdToken       String?       @unique @map("hold_token")
  expiresAt       DateTime      @map("expires_at")
  consumedAt      DateTime?     @map("consumed_at")
  policyVersion   String        @map("policy_version")
  reservationId   String?       @map("reservation_id")
  createdAt       DateTime      @default(now()) @map("created_at")
  restaurant      Restaurant    @relation(fields: [restaurantId], references: [id])

  @@index([restaurantId, slotStart])
  @@index([expiresAt])
  @@index([type, consumedAt])
  @@map("agentic_holds")
}

model ReservationAuditLog {
  id            String   @id @default(uuid())
  reservationId String?  @map("reservation_id")
  holdId        String?  @map("hold_id")
  actor         String                              // 'agent:openai', 'resto:42', 'system'
  event         String                              // 'state_transition', 'hold_created', ...
  fromState     String? @map("from_state")
  toState       String? @map("to_state")
  metadata      Json    @default("{}")
  createdAt     DateTime @default(now()) @map("created_at")
  reservation   Reservation? @relation(fields: [reservationId], references: [id])

  @@index([reservationId, createdAt])
  @@index([createdAt])
  @@map("reservation_audit_log")
}

model RestaurantExposureSettings {
  restaurantId            String   @id @map("restaurant_id")
  mcpEnabled              Boolean  @default(false) @map("mcp_enabled")
  openaiReserveEnabled    Boolean  @default(false) @map("openai_reserve_enabled")
  exposedCreneaux         Json     @default("[]") @map("exposed_creneaux")
  maxPartySize            Int      @default(12) @map("max_party_size")
  minLeadTimeMinutes      Int      @default(30) @map("min_lead_time_minutes")
  requireManualValidation Boolean  @default(false) @map("require_manual_validation")
  quoteTtlSeconds         Int      @default(300)  @map("quote_ttl_seconds")
  holdTtlSeconds          Int      @default(420)  @map("hold_ttl_seconds")
  noShowPolicy            String   @default("warning") @map("no_show_policy")
  notificationChannels    String[] @default(["sms", "email"]) @map("notification_channels")
  capacitySpecials        Json     @default("{}") @map("capacity_specials")
  updatedAt               DateTime @updatedAt @map("updated_at")
  restaurant              Restaurant @relation(fields: [restaurantId], references: [id])

  @@map("restaurant_exposure_settings")
}
```

```prisma
// ─── Nouveaux enums P0 ──────────────────────────────────
enum ReservationState {
  PENDING
  CONFIRMED
  SEATED
  HONORED
  CANCELLED
  NO_SHOW
  FAILED
  EXPIRED
}

enum ReservationChannel {
  PHONE
  WEB
  MCP
  OPENAI_RESERVE
  ADMIN
  API
}

enum HoldType {
  QUOTE
  HOLD
}
```

---

## 5. Ordre d'exécution S1 (rappel du cadrage)

1. ✅ Audit schéma réel + inventaire exact (ce document)
2. ⏳ Attente **GO explicite Hamza** sur ce cadrage
3. ⏳ Créer les 4 migrations P0 additives
4. ⏳ `prisma migrate dev` + tests
5. ⏳ `core/state-machine.ts` (transitions autorisées, **isolé**, sans DB)
6. ⏳ `core/policies.service.ts` (resolve + snapshot, **isolé**)
7. ⏳ Tests unitaires state machine + policies (couverture 90%+)
8. ⏳ **STOP** : revue Hamza avant S2 (moteur transactionnel)

→ Pas de code MCP, pas de widget OpenAI, pas de serveur StreamableHTTP
tant que S1 n'est pas validé.

---

## 6. Critères de succès S1

- [ ] 4 migrations appliquées sur DB locale
- [ ] `prisma generate` OK
- [ ] `prisma migrate deploy` reproductible
- [ ] `pnpm typecheck` OK dans `packages/database` et `apps/api`
- [ ] Tests unitaires state machine : 100% des transitions valides
  - 100% des transitions invalides rejetées
- [ ] Tests unitaires policies : snapshot + version
- [ ] Aucun import MCP / OpenAI dans le code S1
- [ ] Aucun call réseau dans le code S1 (pure logique + Prisma)

---

## 7. Décision finale

J'attends ton GO sur :

1. **Inventaire corrigé à 27 changements P0** (au lieu de 13)
2. **Stratégie enum : ajouter `ReservationState`, garder `ReservationStatus` legacy**
3. **Backfill slug en 2 étapes** (colonne nullable puis contrainte unique)
4. **4 migrations additives** (pas une seule grosse migration)
5. **STOP obligatoire après S1**, revue avant S2

Si tu valides les 5 points, je crée les migrations et le code state
machine + policies, puis je m'arrête pour ta revue.
