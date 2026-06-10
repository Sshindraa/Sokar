# API Endpoints

Documentation exhaustive des routes API exposées par Fastify.

Base URL : `http://localhost:4000` (dev)

---

## Reservations

Module : `apps/api/src/modules/reservations/`

### GET /reservations

Liste les réservations d'un restaurant, optionnellement filtrées par date.

**Query Parameters :**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `restaurantId` | `string` (uuid) | ✅ | ID du restaurant |
| `date` | `string` (date) | ❌ | Filtre par date (YYYY-MM-DD) |
| `limit` | `number` (int) | ❌ | Pagination limit (default: 50, max: 100) |
| `offset` | `number` (int) | ❌ | Pagination offset (default: 0) |

**Réponse :** `200` — Tableau de réservations

---

### POST /reservations

Crée une nouvelle réservation.

**Request Body (Zod Schema : `CreateReservationSchema`) :**
| Champ | Type | Required | Description |
|-------|------|----------|-------------|
| `restaurantId` | `string` (uuid) | ✅ | ID du restaurant |
| `callId` | `string` (uuid) | ❌ | ID de l'appel associé |
| `reservedAt` | `string` (datetime) | ✅ | Date/heure de la réservation (ISO 8601) |
| `partySize` | `number` (int, 1-20) | ✅ | Nombre de couverts |
| `customerName` | `string` (1-200) | ✅ | Nom du client |
| `customerPhone` | `string` (/^\+?[0-9]{10,15}$/) | ❌ | Téléphone du client |

**Réponse :** `201` — Réservation créée (objet complet)

**Comportements :**
- `estimatedRevenue` = `partySize × 35` (calculé automatiquement)
- Si `customerPhone` fourni, une tâche BullMQ de confirmation SMS est enqueueée

**Exemple :**
```json
{
  "restaurantId": "00000000-0000-0000-0000-000000000001",
  "reservedAt": "2026-05-19T20:00:00.000Z",
  "partySize": 4,
  "customerName": "Jean Dupont",
  "customerPhone": "+33612345678"
}
```

---

### PATCH /reservations/:id

Met à jour une réservation existante.

**Request Body :**
| Champ | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | `enum(CONFIRMED, CANCELLED, NO_SHOW, SEATED)` | ❌ | Statut |
| `customerName` | `string` (1-200) | ❌ | Nom |
| `partySize` | `number` (int, 1-20) | ❌ | Couverts |

**Réponse :** `200` — Réservation mise à jour

---

### DELETE /reservations/:id

Supprime une réservation.

**Réponse :** `204 No Content`

---

## Calls

Module : `apps/api/src/modules/calls/`

### GET /calls

Liste les appels d'un restaurant avec pagination.

**Query Parameters :**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `restaurantId` | `string` (uuid) | ✅ | ID du restaurant |
| `limit` | `number` | ❌ | Pagination (default: 50) |
| `offset` | `number` | ❌ | Pagination (default: 0) |

**Réponse :** `{ data: [], total, limit, offset }`

---

## Restaurants

Module : `apps/api/src/modules/restaurants/`

### GET /restaurants/:id

### PATCH /restaurants/:id

### GET /restaurants/:id/availability

---

## Customers

Module : `apps/api/src/modules/customers/`

### GET /customers

### POST /customers

### PATCH /customers/:id

---

## Dashboard

Module : `apps/api/src/modules/dashboard/`

### GET /dashboard/stats

**Réponse :** `{ total_calls, total_reservations, answered_rate, revenue_recovered }`

### GET /dashboard/recent-activity

**Réponse :** `{ reservations: [], calls: [] }`

---

## Voice (Telnyx)

Module : `apps/api/src/modules/voice/`

Webhooks Telnyx entrypoint. Voir [[Telnyx Pipeline]] pour le détail.

---

## Health

### GET /health

**Réponse :** `{ status, db, redis, telnyx }`

---

*Documentation maintenue automatiquement par Hermes Agent. Dernière mise à jour : 2026-05-19 21:44.*
