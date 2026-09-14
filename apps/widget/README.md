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
2. **Publication CDN vérifiée.** `next.config.js` produit un export statique
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
