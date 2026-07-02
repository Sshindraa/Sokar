# @sokar/widget — OpenAI Reserve Widget

## ⚠️ PROTOTYPE NON FONCTIONNEL — NE PAS DÉPLOYER

Cette app est un prototype expérimental (OpenAI Apps SDK). Elle **ne doit pas
être déployée** tant que les 3 points suivants ne sont pas résolus :

1. **Accès partenaire OpenAI Reserve non obtenu** — l'intégration business feed
   - tool `restaurant_reservation` nécessite un accès partenaire OpenAI qui n'a
     pas encore été accordé. Le endpoint `/v1/businesses` et le tool MCP sont
     implémentés côté API (`apps/api/src/modules/agentic-reservations/openai-reserve/`),
     mais OpenAI ne les consomme pas encore.

2. **`reservation-widget.tsx` simule la réservation** — le composant
   (`src/components/reservation-widget.tsx` lignes 87-94) utilise un
   `setTimeout(2000)` + `setSuccess('Réservation confirmée !')` au lieu
   d'appeler l'API réelle (`window.openai.callTool` ou fetch vers
   `/public/hold` + `/public/confirm`). Aucune réservation n'est créée.

3. **Aucun pipeline de déploiement CDN configuré** — la constante
   `WIDGET_PUBLIC_URL` dans `apps/api/src/modules/agentic-reservations/openai-reserve/constants.ts`
   pointe vers `https://widget.sokar.tech/`, mais ce sous-domaine n'a aucun
   DNS/CDN configuré derrière lui aujourd'hui. Aucun déploiement
   Cloudflare/CDN n'est configuré pour servir le build statique (`next export`).

## Que faire pour rendre ce widget fonctionnel ?

1. Obtenir l'accès partenaire OpenAI Reserve (démarche externe, bloquée).
2. Remplacer le mock `setTimeout` par un vrai appel API
   (`/public/hold` → `/public/confirm`, ou `window.openai.callTool`).
3. Configurer le déploiement CDN (Cloudflare Pages ou similaire) sur un
   sous-domaine réel (ex. `widget.sokar.tech`), et mettre à jour
   `WIDGET_PUBLIC_URL` + `OPENAI_WIDGET_PUBLIC_URL`.

## Stack

- Next.js (export statique, `next export`).
- Tailwind CSS.
- OpenAI Apps SDK (`window.openai` injecté par l'iframe ChatGPT).
