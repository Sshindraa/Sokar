# Manifest Local Notifications - 17 Octobre 2026

Liste candidate pour revue, pas une instruction de commit ou de deploiement.
Certains fichiers contiennent plusieurs lots : verifier chaque hunk. Les fichiers
nouveaux non suivis doivent aussi etre examines ; `git diff` seul ne les montre pas.

## Confirmation SMS Et Diagnostics

- `apps/api/src/shared/telnyx/client.ts`
- `apps/api/src/shared/telnyx/sms-error.ts`
- `apps/api/src/shared/telnyx/__tests__/sms-error.test.ts`
- `apps/api/src/shared/telnyx/__tests__/sms-send.test.ts`
- `apps/api/src/shared/messaging/confirmation-text.ts`
- `apps/api/src/shared/messaging/__tests__/confirmation-text.test.ts`
- `apps/api/src/shared/queue/workers/outbound-confirm.worker.ts`
- `apps/api/src/shared/queue/workers/__tests__/outbound-confirm.worker.test.ts`

## Confirmation WEB Durable

- `apps/api/src/shared/outbox/reservation-confirmation.ts`
- `apps/api/src/shared/outbox/__tests__/reservation-confirmation.test.ts`
- `apps/api/src/shared/queue/workers/outbox-delivery.worker.ts`
- `apps/api/src/shared/queue/workers/__tests__/outbox-confirmation-delivery.test.ts`
- `apps/api/src/modules/agentic-reservations/core/reservation.service.ts`
- `apps/api/src/modules/agentic-reservations/__tests__/reservation.service.test.ts`
- `apps/api/src/modules/reservations/reservation-lifecycle.service.ts`
- `apps/api/src/modules/reservations/__tests__/reservation-lifecycle.service.test.ts`

## Politique Rappels Et Integration Meta

- `apps/api/src/shared/messaging/sender.ts`
- `apps/api/src/shared/messaging/__tests__/sender.test.ts`
- `apps/api/src/shared/queue/workers/confirmation-sms.worker.ts`
- `apps/api/src/shared/queue/workers/__tests__/confirmation-sms.worker.test.ts`
- `apps/api/src/shared/queue/notification-idempotency.ts`
- `apps/api/src/shared/queue/workers/reconciliation.worker.ts`
- `apps/api/src/shared/observability/metrics.ts` (type fournisseur Meta uniquement)
- `apps/api/src/shared/whatsapp/client.ts`
- `apps/api/src/shared/whatsapp/meta-client.ts`
- `apps/api/src/shared/whatsapp/meta-status.ts`
- `apps/api/src/shared/whatsapp/__tests__/client.test.ts`
- `apps/api/src/shared/whatsapp/__tests__/meta-client.test.ts`
- `apps/api/src/shared/whatsapp/__tests__/meta-status.test.ts`
- `apps/api/src/modules/whatsapp/meta-webhook.routes.ts`
- `apps/api/src/modules/whatsapp/__tests__/meta-webhook.routes.test.ts`
- `apps/api/src/modules/whatsapp/__tests__/meta-webhook-logging.test.ts`
- `apps/api/src/main.ts` (enregistrement de la route et options du logger enfant)

## Accord Et Retrait Actuels

- `apps/api/src/modules/connect/whatsapp-consent.ts`
- `apps/api/src/modules/connect/__tests__/whatsapp-consent.test.ts`
- `apps/api/src/modules/connect/connect.routes.ts`
- `apps/api/src/modules/connect/connect.types.ts`
- `apps/api/src/modules/connect/__tests__/connect.routes.test.ts`
- `apps/api/src/modules/reservations/reservation.routes.ts`
- `apps/api/src/modules/reservations/reservation.schema.ts`
- `apps/api/src/modules/reservations/reservation.service.ts`
- `apps/api/src/modules/restaurants/restaurant.routes.ts`
- `apps/connect/src/components/booking-widget.tsx`
- `apps/connect/src/components/booking/confirmation-view.tsx`
- `apps/connect/src/components/__tests__/booking-widget.test.tsx`
- `apps/connect/src/components/booking/__tests__/confirmation-view.test.tsx`
- `apps/dashboard/src/app/widget/[restaurantId]/page.tsx`
- `apps/dashboard/e2e/whatsapp-consent.spec.ts`

## Gestion Durable A6 (Locale, Off)

- `apps/api/src/modules/reservations/reservation-management.ts`
- `apps/api/src/modules/reservations/reservation-management.routes.ts`
- `apps/api/src/modules/reservations/__tests__/reservation-management.test.ts`
- `apps/dashboard/src/app/r/layout.tsx`
- `apps/dashboard/src/app/r/page.tsx`
- `apps/dashboard/src/app/r/reservation-view.tsx`
- `apps/dashboard/src/app/r/reservation-view.module.css`
- `apps/dashboard/src/app/r/demo/page.tsx`
- `apps/dashboard/src/app/r/demo/page.test.tsx`
- `apps/dashboard/src/app/r/page.test.tsx`
- `apps/dashboard/src/app/r/telemetry.test.ts`
- `apps/dashboard/src/app/api/reservation-management/route.ts`
- `apps/dashboard/src/app/api/reservation-management/route.test.ts`
- `apps/dashboard/src/components/header.tsx`
- `apps/dashboard/instrumentation-client.ts`
- `apps/dashboard/e2e/reservation-management.spec.ts`
- `infra/nginx/sokar.conf` et `infra/nginx/sokar-staging.conf` : routes exactes
  `/r` et `/api/reservation-management`, pas les autres hunks.
- `docs/runbooks/reservation-management.md`

Les fichiers SMS, creation/API et confirmations web listes plus haut contiennent
aussi les ajouts de lien. Ne pas activer la collecte sur la base de cette seule
liste. Aucun e-mail ajoute ni changement du template WhatsApp.

## Configuration Et Documentation

- `apps/api/.env.example` : uniquement les options WhatsApp du lot, valeurs off.
- `apps/api/src/test/setup.ts` : revoir les seuls changements necessaires au lot,
  ne pas embarquer des mocks concurrents par inadvertance.
- `docs/runbooks/environment.md` : paragraphes/options WhatsApp seulement.
- `docs/runbooks/whatsapp-reservation-activation.md`
- `docs/runbooks/worker-failure-triage-2026-10-16.md`
- `docs/audits/2026-10-17-notifications-critical-review.md`
- Ce manifest ; entrees correspondantes du Journal et etat courant du Context.

## Exclusions Et Gates

- Ne pas embarquer par defaut les changements billing/Stripe, mentions legales,
  confidentialite, e-mail/Resend, alertes ops ou workflows CI/deploiement.
- Aucune modification Prisma, migration, suppression ou regeneration de donnees.
- Aucun fichier `.env` reel ni secret dans le lot.
- Garder les flags WhatsApp off ; ne pas configurer Meta/Telnyx automatiquement.
- A4 modifie le flux transactionnel des nouvelles reservations WEB avec SMS
  active : recette creation, validation manuelle, panne outbox et replay requise.
- Deployer workers compatibles avec le nouveau topic avant les producteurs,
  dans le circuit de release habituel. Conserver la strategie de retour arriere
  pour les nouveaux evenements persistants ; ne pas les donner a un ancien worker
  qui ne reconnait pas le topic.
- Les tests locaux ne remplacent pas la recette staging avec destinataire autorise.
