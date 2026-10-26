# @sokar/widget — OpenAI Reserve Widget

## État au 13 septembre 2026

Le widget est **fonctionnel en local** et reste gelé avant toute mise en
production. Le composant `src/components/reservation-widget.tsx` appelle le
parcours API réel :

1. `GET /public/r/:slug/availability` ;
2. `POST /public/r/:slug/hold` ;
3. `POST /public/r/:slug/confirm`.

Les tokens d’attribution marketing sont conservés dans l’URL
`marketingAttributionToken`, enregistrent le clic et sont transmis à la
création de la réservation. Le composant n’utilise pas de `setTimeout` pour
simuler une confirmation.

Deux conditions restent ouvertes avant une activation commerciale :

1. **Accès partenaire OpenAI Reserve.** L’API expose le feed et le tool sous
   `apps/api/src/modules/agentic-reservations/openai-reserve/`, mais l’accès
   partenaire externe n’est pas encore accordé.
2. **Publication CDN vérifiée** (workflow `deploy-widget.yml`, voir « Publication »). `next.config.js` produit un export statique
   dans `out/` et `WIDGET_PUBLIC_URL` pointe vers `widget.sokar.tech`, mais le
   DNS/CDN et un smoke test public doivent encore être validés sur un
   environnement de staging.

## Développement

Définir `NEXT_PUBLIC_API_URL` au moment du build (par exemple
`http://localhost:3001` en local), puis lancer :

```bash
pnpm --filter @sokar/widget dev
pnpm --filter @sokar/widget test
pnpm --filter @sokar/widget typecheck
```

Le fallback standalone accepte `?slug=...`. Dans ChatGPT, le slug est lu
depuis `window.openai.toolInput`.

## Stack

- Next.js 15 avec `output: export` ;
- Tailwind CSS ;
- OpenAI Apps SDK (`window.openai` pour l’état du widget) ;
- API Sokar pour les disponibilités, holds et confirmations.

## Publication (Cloudflare Pages)

`public/_headers` est au format Cloudflare Pages. Le build produit
`out/restaurant-reservation.html`, l'adresse que l'API donne à ChatGPT.

Avant le premier déploiement, côté Cloudflare / GitHub :

1. Créer le projet Pages `sokar-widget` (mode « Direct Upload »).
2. Y rattacher le domaine `widget.sokar.tech` (le DNS suit automatiquement).
3. Ajouter les secrets GitHub `CLOUDFLARE_API_TOKEN` (droit Pages : Edit) et
   `CLOUDFLARE_ACCOUNT_ID`.
4. Vérifier que `CORS_ORIGINS` de l'API de prod contient `https://widget.sokar.tech`
   (l'écran appelle `api.sokar.tech` depuis ce domaine).

Puis lancer le workflow **Deploy Widget (Cloudflare Pages)** à la main : il construit,
publie et vérifie que l'adresse répond 200.
