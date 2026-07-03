# Spec — Cartes cadeaux dans Sokar

> Statut : spec technique MVP (P1). Pas de code à produire dans ce ticket.  
> But : permettre aux restaurateurs Sokar de vendre des cartes cadeaux digitales, intégrées nativement au parcours de réservation, avec différenciation IA voice + personnalisation.

---

## 1. Contexte et objectifs

### État actuel

- Sokar gère les réservations via `hold` / `confirm` (Connect, widget, voice, MCP).
- Le CRM `Customer` existe avec historique, VIP, consentements.
- Aucun modèle de carte cadeau n’existe.
- Aucun flux de paiement anticipé n’existe aujourd’hui.

### Objectifs

1. Permettre à un client d’acheter une carte cadeau pour un restaurant Sokar.
2. Permettre au bénéficiaire de l’utiliser automatiquement au moment de la réservation.
3. Différencier Sokar via l’IA voice (achat par téléphone) et la personnalisation (message vocal/texte).
4. Offrir au restaurateur un dashboard simple de création / suivi / statistiques.
5. Garder le système compatible avec un futur paiement Stripe (P2) et une cagnotte groupe (P2).

### Différenciation Sokar vs Zenchef / OpenTable

| Zenchef classique    | Sokar next level                                         |
| -------------------- | -------------------------------------------------------- |
| Achat web uniquement | Achat web + voice + widget                               |
| Code générique       | Code personnalisé avec message vocal/texte généré par IA |
| Montant fixe         | Montant libre + suggestions IA selon le profil           |
| Cadeau anonyme       | Cadeau lié au CRM (expéditeur, destinataire, occasion)   |
| Utilisation manuelle | Utilisation automatique au moment de la réservation      |
| Pas de cagnotte      | Cagnotte groupe possible (plusieurs contributeurs, P2)   |

---

## 2. Périmètre

### In scope (P1)

- Modèle de données Prisma : `GiftCard`, `GiftCardRedemption`, `GiftCardContribution`.
- Flux d’achat : web, widget, voice (mode test / manuel en P1).
- Flux d’utilisation : réservation + paiement partiel avec solde restant.
- Concierge IA pour recommander le montant et le message.
- Dashboard restaurateur : liste, création manuelle, stats simples.
- API routes admin + public.
- Intégration widget : bouton "Offrir".
- Intégration voice : dialogue d’achat par téléphone.
- Tests et roadmap.

### Out of scope (P1)

- Paiement réel (Stripe) — mode test ou marquage manuel en P1.
- Cagnotte multi-contributeurs (P2).
- Cadeau physique / livraison.
- Marketplace de cartes cadeaux entre restaurants.
- Remboursement automatique (P2 ; P1 = annulation manuelle côté restaurateur).
- Multi-devise (P1 = EUR uniquement).

---

## 3. Modèle de données Prisma

### Choix retenu

On ajoute 3 modèles. `GiftCard` est la source de vérité. `GiftCardRedemption` trace chaque utilisation pour permettre un solde restant et un historique. `GiftCardContribution` prépare la cagnotte groupe sans impacter l’API P1.

`code` est unique et non-énumérable. P1 utilise un UUID ; P2 pourra ajouter un code court mnémonique (ex. `SOKAR-XXXX-XXXX`) avec rate-limiting et hash.

### Schema proposé

```prisma
model GiftCard {
  id              String   @id @default(uuid())
  restaurantId    String   @map("restaurant_id")
  code            String   @unique @default(uuid())
  amount          Decimal  @db.Decimal(10, 2)
  remainingAmount Decimal  @db.Decimal(10, 2) @map("remaining_amount")
  currency        String   @default("EUR")
  status          String   @default("ACTIVE") // ACTIVE, REDEEMED, EXPIRED, CANCELLED
  purchasedAt     DateTime @default(now()) @map("purchased_at")
  expiresAt       DateTime? @map("expires_at")

  senderName      String? @map("sender_name")
  senderEmail     String? @map("sender_email")
  senderPhone     String? @map("sender_phone")
  recipientName   String? @map("recipient_name")
  recipientEmail  String? @map("recipient_email")
  recipientPhone  String? @map("recipient_phone")

  message         String? // message texte personnalisé
  voiceMessageUrl String? @map("voice_message_url") // URL message vocal généré par IA
  occasion        String? // anniversaire, remerciement, etc.

  customerId      String? @map("customer_id") // lien CRM (expéditeur ou destinataire)

  restaurant      Restaurant @relation(fields: [restaurantId], references: [id], onDelete: Cascade)
  customer        Customer?  @relation(fields: [customerId], references: [id], onDelete: SetNull)
  redemptions     GiftCardRedemption[]
  contributions   GiftCardContribution[]

  @@index([restaurantId, status])
  @@index([code])
  @@map("gift_cards")
}

model GiftCardRedemption {
  id            String    @id @default(uuid())
  giftCardId    String    @map("gift_card_id")
  reservationId String?   @map("reservation_id")
  amount        Decimal   @db.Decimal(10, 2)
  redeemedAt    DateTime  @default(now()) @map("redeemed_at")

  giftCard      GiftCard      @relation(fields: [giftCardId], references: [id], onDelete: Cascade)
  reservation   Reservation?  @relation(fields: [reservationId], references: [id], onDelete: SetNull)

  @@index([giftCardId])
  @@map("gift_card_redemptions")
}

model GiftCardContribution {
  id              String   @id @default(uuid())
  giftCardId      String   @map("gift_card_id")
  contributorName String?  @map("contributor_name")
  amount          Decimal  @db.Decimal(10, 2)
  contributedAt   DateTime @default(now()) @map("contributed_at")

  giftCard GiftCard @relation(fields: [giftCardId], references: [id], onDelete: Cascade)

  @@index([giftCardId])
  @@map("gift_card_contributions")
}
```

### Justification des champs

- `amount` / `remainingAmount` : montant initial et solde courant. `remainingAmount` est dénormalisé pour éviter un `SUM` à chaque usage.
- `code` : identifiant unique utilisé par le bénéficiaire. UUID en P1 pour la sécurité.
- `status` : machine à état simple. `REDEMED` = solde nul. `EXPIRED` = date passée. `CANCELLED` = annulation restaurateur.
- `sender*` / `recipient*` : personnalisation et envoi email/SMS. Obligatoire en production selon le canal.
- `message` / `voiceMessageUrl` : différenciation IA. `voiceMessageUrl` est un fichier audio généré côté API (TTS ou enregistrement agent).
- `occasion` : input du concierge IA pour recommander le montant et le message.
- `customerId` : lien CRM pour historique et segmentation.
- `GiftCardContribution` : modèle préparatoire pour la cagnotte P2. P1, il ne sert que si le restaurateur crée une carte manuellement avec un premier verseur.

### Migrations requises

- `20260716000000_add_gift_cards` : création des 3 tables + index.
- Mise à jour optionnelle de `Restaurant` pour ajouter `giftCardEnabled` (P1.5) si le restaurateur veut activer/désactiver la feature.

---

## 4. Flux d’achat

### 4.1 Web / widget

```text
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐     ┌────────────┐
| Client      |────▶| Widget/site  |────▶| Formule cadeau  |────▶| Paiement   |
| (expéditeur)|     | "Offrir"     |     | (montant, msg)  |     | (test P1)  |
└─────────────┘     └──────────────┘     └─────────────────┘     └────┬───────┘
                                                                        │
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐            │
| Destinataire|◀────| Email/SMS    |◀────| Code + URL      |◀───────────┘
|             |     | (code)       |     | personnalisée   |
└─────────────┘     └──────────────┘     └─────────────────┘
```

Étapes :

1. Le client clique sur "Offrir une carte cadeau" depuis le widget ou la page restaurant.
2. Formulaire : montant, occasion, expéditeur, destinataire, message personnalisé.
3. Suggestion IA affichée : "Pour un anniversaire à 2 personnes, nous recommandons 120 €".
4. Paiement (P1 = mock/test, P2 = Stripe).
5. Création de la `GiftCard` en statut `ACTIVE`.
6. Envoi email/SMS au destinataire avec le code + URL de réservation.
7. Option : génération d’un message vocal par l’IA (TTS ou agent voice).

### 4.2 Voice

```text
Appelant
   │
   ▼
"Je voudrais offrir une carte cadeau"
   │
   ▼
Agent IA collecte :
  • montant
  • occasion
  • nom du destinataire
  • numéro de téléphone du destinataire
   │
   ▼
Agent IA propose un montant recommandé
   │
   ▼
Paiement (P2 : Stripe par téléphone ; P1 : lien SMS / marquage manuel)
   │
   ▼
Confirmation vocale + SMS au destinataire
```

Étapes :

1. L’agent détecte l’intention "offrir une carte cadeau".
2. Il collecte le montant, l’occasion et les coordonnées du destinataire.
3. Il suggère un montant adapté au restaurant et à l’occasion.
4. Paiement (P1 = lien SMS de paiement ou marquage manuel ; P2 = paiement vocal Stripe).
5. Création de la `GiftCard` et envoi SMS au destinataire avec le code.

### 4.3 API d’achat P1

- `POST /public/gift-cards/purchase` (P1 en mode test, P2 avec Stripe).
- `POST /restaurants/:id/gift-cards` (dashboard : création manuelle par le restaurateur).

---

## 5. Concierge IA pour recommander le cadeau

### Inputs

- Profil du restaurant : cuisine, prix moyen, ambiance, fourchette de prix.
- Occasion : anniversaire, dîner romantique, déjeuner d’affaires, remerciement, etc.
- Party size (si connue).
- Budget indicatif (optionnel).

### Logique de recommandation (P1)

```text
montant_recommandé = base_par_personne * party_size * multiplicateur_occasion

base_par_personne = restaurant.priceRange * 25  // EUR, ajustable
multiplicateur_occasion = {
  anniversaire: 1.2,
  romantique: 1.3,
  affaires: 1.0,
  remerciement: 1.0,
  départ: 1.1,
  default: 1.0
}
```

### Sortie

- Montant recommandé (arrondi au multiple de 10 €).
- Message suggéré (template personnalisable par le restaurant).
- Option message vocal généré.

### Où l’exécuter

- Côté API : endpoint `POST /public/gift-cards/recommend` (stateless, appelle OpenAI ou règle métier P1).
- Côté voice : la même fonction est appelée par l’agent pour formuler la suggestion à l’oral.

---

## 6. Flux d’utilisation

```text
Destinataire reçoit le code
   │
   ▼
Réserve via widget / voice / web
   │
   ▼
Saisit le code au moment du confirm (ou au hold)
   │
   ▼
Système vérifie le solde
   │
   ├── Solde >= montant de la réservation
   │   ▼
   │   Réservation confirmée, paiement complété par la carte
   │   GiftCard passe en REDEEMED (ou solde nul)
   │
   └── Solde < montant de la réservation
       ▼
       Déduction du solde, reste à payer par le client
       GiftCard reste ACTIVE avec remainingAmount mis à jour
```

### Règles métier

- Une carte cadeau peut être utilisée sur plusieurs réservations tant que le solde est positif.
- Le solde est déduit au moment de la confirmation, pas au hold.
- Si le montant de la réservation est inférieur au solde, le reste reste disponible.
- Si le montant est supérieur, le client paie le complément (P2 via Stripe, P1 via réservation marquée "complément à payer").
- Une carte expirée ou annulée ne peut pas être appliquée.

---

## 7. API routes

### Admin

```text
GET    /restaurants/:id/gift-cards
POST   /restaurants/:id/gift-cards
GET    /restaurants/:id/gift-cards/:giftCardId
PATCH  /restaurants/:id/gift-cards/:giftCardId
POST   /restaurants/:id/gift-cards/:giftCardId/cancel
GET    /restaurants/:id/gift-cards/stats
```

### Public

```text
POST   /public/gift-cards/check        // vérifier solde et validité
POST   /public/gift-cards/apply        // appliquer à une réservation
POST   /public/gift-cards/purchase     // acheter (P2 Stripe, P1 test)
POST   /public/gift-cards/recommend    // suggestion IA
GET    /public/r/:slug/gift-card       // infos pour l’achat (restaurant, montants suggérés)
```

### Endpoints de réservation existants

- `POST /public/r/:slug/hold` : optionnellement accepte `giftCardCode` pour réserver le solde (soft-hold).
- `POST /public/r/:slug/confirm` : accepte `giftCardCode` et applique la déduction.

### Non-régression

- Les endpoints existants continuent de fonctionner sans `giftCardCode`.
- L’ajout du champ `giftCardCode` est optionnel dans les payloads.

---

## 8. Dashboard restaurateur

### Page `/dashboard/gift-cards`

#### Vue liste

- Cartes cadeaux vendues (code masqué partiellement, montant, solde, statut, destinataire, date d’achat).
- Filtres : statut, période.
- Recherche par code, email ou nom.

#### Vue stats

- CA total généré par les cartes cadeaux.
- Solde total encore disponible.
- Taux d’utilisation (% de cartes redeemées).
- Montant moyen d’achat.

#### Actions

- Bouton "Créer une carte cadeau manuelle" (ex. compensation client, partenariat).
- Bouton "Annuler" (passe le statut à `CANCELLED`).
- Bouton "Voir détail" (historique des redemptions, contributions).

### Permissions

- Seul le restaurateur (rôle owner/manager) peut annuler ou créer manuellement.
- Le staff peut consulter la liste.

---

## 9. Intégration widget

### Bouton "Offrir une carte cadeau"

- Ajout dans le widget embed (`apps/connect/src/components/booking-widget.tsx`).
- Ouverture d’un flow en 2-3 étapes :
  1. Montant + occasion.
  2. Expéditeur + destinataire + message.
  3. Confirmation + code.

### Page dédiée

- `/public/r/:slug/gift-card` (ou route Connect dédiée) affiche :
  - Nom du restaurant.
  - Montants suggérés.
  - Formulaire d’achat.
  - Aperçu du message / vocal.

### Style

- French-first copy : "Offrir", "Carte cadeau", "Solde", "Utiliser".
- Design tokens Sokar : `bg-background`, `text-primary`, `border-border`.
- Responsive iPad.

---

## 10. Intégration voice

### Nouvelle intention

- `gift_card_purchase` détectée quand l’appelant dit "offrir une carte cadeau", "cadeau", "chèque cadeau", etc.

### Dialogue type

```text
Agent : "Bien sûr. Pour quelle occasion souhaitez-vous offrir cette carte cadeau ?"
Appelant : "C'est pour un anniversaire."
Agent : "Parfait. Pour un anniversaire à [Restaurant], je vous recommande une carte de 120 euros pour deux personnes. Souhaitez-vous ce montant ?"
Appelant : "Oui, c'est parfait."
Agent : "Pourriez-vous me donner le nom et le numéro de téléphone du destinataire ?"
...
Agent : "Votre carte cadeau est créée. Le destinataire recevra un SMS avec le code."
```

### Paiement vocal

- P1 : l’agent envoie un lien de paiement sécurisé par SMS à l’expéditeur, ou le restaurateur marque la carte comme payée manuellement.
- P2 : intégration Stripe payment intents / card-not-present.

### Message vocal

- Généré côté API via TTS (Cartesia) ou enregistrement direct par l’agent.
- Stocké dans `GiftCard.voiceMessageUrl`.

---

## 11. Tests

### Tests unitaires

- Calcul du solde après redemption.
- Validation d’un code (format, expiration, statut).
- Logique de recommandation du concierge IA.
- Machine à état `ACTIVE` → `REDEEMED` / `EXPIRED` / `CANCELLED`.

### Tests d’intégration

- Achat via `POST /restaurants/:id/gift-cards` → vérification du solde.
- Utilisation sur une réservation : `POST /public/r/:slug/confirm` avec `giftCardCode`.
- Réservation normale sans carte cadeau (non-régression).
- Réservation avec solde partiel (complément à payer).

### Tests voice

- Mock du dialogue d’achat de carte cadeau.
- Vérification que l’agent collecte les champs obligatoires.

### Tests dashboard

- Création manuelle par le restaurateur.
- Annulation.
- Stats.

---

## 12. Roadmap

### P1 (MVP)

- Modèle de données Prisma.
- API admin + public (check, apply, purchase mode test).
- Dashboard liste + stats + création manuelle.
- Widget : bouton "Offrir" et formulaire.
- Voice : intention et dialogue basique.
- Tests unitaires et intégration.

### P2

- Paiement Stripe réel (web + voice).
- Cagnotte groupe via `GiftCardContribution`.
- Codes courts mnémoniques + rate-limiting.
- Remboursement automatique.
- Messages vocaux personnalisés par IA.

### P3

- Marketplace de cartes cadeaux entre restaurants.
- Cadeaux physiques / livraison.
- Campagnes marketing (emailing cadeaux fêtes de fin d’année).

---

## 13. Liste des fichiers à modifier

### Schema / base

- `packages/database/prisma/schema.prisma` : ajout des 3 modèles.
- `packages/database/prisma/migrations/20260716000000_add_gift_cards/migration.sql`.

### API

- `apps/api/src/main.ts` : enregistrement des routes.
- `apps/api/src/modules/gift-cards/gift-card.service.ts` (nouveau).
- `apps/api/src/modules/gift-cards/gift-card.routes.ts` (nouveau).
- `apps/api/src/modules/gift-cards/gift-card.types.ts` (nouveau).
- `apps/api/src/modules/gift-cards/__tests__/gift-card.service.test.ts` (nouveau).
- `apps/api/src/modules/gift-cards/__tests__/gift-card.routes.test.ts` (nouveau).
- `apps/api/src/modules/connect/connect.routes.ts` : ajout de `giftCardCode` dans `/hold` et `/confirm`.
- `apps/api/src/modules/agentic-reservations/core/reservation.service.ts` : gestion du solde.
- `apps/api/src/modules/agentic-reservations/core/hold.service.ts` : soft-hold du solde.

### Dashboard

- `apps/dashboard/src/app/dashboard/gift-cards/page.tsx` (nouveau).
- `apps/dashboard/src/app/dashboard/_layout-client.tsx` : ajout dans la nav.

### Widget / Connect

- `apps/connect/src/components/booking-widget.tsx` : bouton "Offrir".
- `apps/connect/src/app/widget/[slug]/page.tsx` : page cadeau.
- `apps/connect/src/components/gift-card-form.tsx` (nouveau).

### Voice

- `apps/api/src/modules/voice/prompts/` : nouvelle intention et phrases.
- `apps/api/src/modules/voice/tools/` : tool `create_gift_card` pour l’agent.

---

## 14. Questions à résoudre

1. **Code cadeau** : UUID en P1 ; code court mnémonique en P2 avec rate-limiting ?
2. **Paiement** : Stripe en P2 ; mode test / marquage manuel en P1 ?
3. **Message vocal** : généré côté API (TTS) ou enregistré côté voice ?
4. **Portée** : carte cadeau liée au restaurant uniquement, ou à un groupe/compte Sokar ?
5. **Remboursement** : annulation manuelle côté restaurateur en P1 ; remboursement automatique en P2 ?
6. **Expiration** : optionnelle en P1 ; obligatoire en P2 ?
7. **Taxes** : la carte cadeau est-elle un titre prépayé soumis à une TVA différée ? À valider avec un expert comptable.

---

## 15. Notes RGPD et sécurité

- Consentement explicite de l’expéditeur et du destinataire pour l’email/SMS.
- Les codes ne doivent pas être énumérables (UUID en P1, hash + rate-limit P2).
- Logs : ne jamais stocker le code en clair dans les logs (loguer `codePrefix` ou `id` uniquement).
- Paiement : ne jamais persister les données de carte bancaire (déléguer à Stripe en P2).
- Durée de conservation : définir une politique d’archivage des cartes cadeaux expirées.

---

## 16. Copy user-facing (French-first)

- Bouton : "Offrir une carte cadeau"
- Titre : "Offrir un moment au [Nom du restaurant]"
- Champs : "Montant", "Occasion", "Votre nom", "Nom du destinataire", "Email du destinataire", "Téléphone du destinataire", "Message personnel"
- Confirmation : "Votre carte cadeau a bien été créée. Le destinataire recevra un email avec le code."
- Utilisation : "Vous avez une carte cadeau ? Saisissez votre code."
- Solde : "Solde restant : [montant]"
- Erreur : "Ce code n’est pas valide ou a expiré."

---

> Dernière mise à jour : 2026-07-03  
> Auteur : Devin / Sokar team
