# Passage de Sokar à Suppernote

Décision de Hamza du 3 novembre 2026 : la marque Sokar devient Suppernote et `sokar.tech` devient `suppernote.com`.

## Ce qui ne change pas

Ces noms sont internes ou consommés hors du dépôt. Les renommer ne s'est pas justifié ici :

- paquets `@sokar/*`, dossiers `/opt/sokar`, sauvegardes, scripts `sokar-*`, base de données ;
- en-tête `X-Sokar-Site-ID`, `sokar-mcp`, noms d'outils MCP, champs d'API, événements analytics ;
- identifiant iOS `tech.sokar.ios` et projet Xcode ;
- restaurant de démonstration « Chez Sokar » et son slug `chez-sokar-demo` ;
- migrations Prisma, journal `docs/obsidian/` et bancs voix.

## Préalables, avant de fusionner la PR

La fusion déclenche le déploiement : `install-nginx` échoue si le certificat de `suppernote.com` manque.

1. Cloudflare : zone active, enregistrements `@`, `www`, `*`, `api`, `staging` et `api-staging` vers le VPS, proxifiés comme ceux de `sokar.tech`. Retirer les enregistrements de parking IONOS importés.
2. VPS : certificat `/etc/letsencrypt/live/suppernote.com/` couvrant ces noms ; conserver celui de `sokar.tech`, utilisé par les redirections.
3. Clerk : domaine `suppernote.com` en staging et en production, enregistrements `clerk` et `accounts`, adresses de redirection OAuth.
4. E-mails : domaines `suppernote.com` et `news.suppernote.com` vérifiés dans Resend (SPF, DKIM, DMARC) ; alias Google Workspace `privacy@`, `hello@`, `support@`, `dpo@`, `ops@`, `hamza@`.
5. Webhooks : ajouter les adresses `api.suppernote.com` chez Telnyx, Stripe et Meta sans retirer les anciennes. Mettre à jour les secrets Stripe si un nouveau point d'accès en crée.
6. `.env` de staging puis de production : `SITE_URL`, `API_URL`, `PUBLIC_API_URL`, `PUBLIC_URL`, `DASHBOARD_URL`, `CORS_ORIGINS`, `OAUTH_ISSUER_URL`, `EMAIL_FROM`, `MARKETING_EMAIL_FROM`, `MARKETING_UNSUBSCRIBE_BASE_URL`, `ALERT_EMAIL_TO`, `DEMO_REQUEST_NOTIFY_TO`, `CLOUDFLARE_SAAS_FALLBACK_ORIGIN`, `NEXT_PUBLIC_API_URL`. Les variables `NEXT_PUBLIC_*` imposent une reconstruction.

## Après la bascule

- Vérifier les redirections (`POST api.sokar.tech/autre-chemin` : 308) et les liens de désinscription marketing. Les webhooks (`/webhooks/`, `/whatsapp/webhook`, `/voice/`) ne sont pas redirigés : `api.sokar.tech` les relaie à l'API, car Stripe, Telnyx et Meta ne suivent pas les redirections. Contrôler un POST signé sur chaque ancienne adresse, puis faire pointer les trois fournisseurs vers `api.suppernote.com` (Meta : remplacement, une seule adresse).
- Déclarer le changement d'adresse dans Google Search Console.
- Publier l'app iOS : l'ancienne version traite `suppernote.com` comme un lien externe.
- Reconnecter les connecteurs MCP : l'adresse de l'émetteur OAuth change.
- Faire changer le CNAME des domaines personnalisés et prévenir les restaurants qui ont un widget.
- Remplacer le logo : `SokarLogo` et `logo-sokar*` dessinent encore l'ancien.

## `sokar.tech`

Garder le domaine renouvelé et les redirections au moins 12 mois, puis garder le renouvellement : un tiers qui le rachèterait recevrait les liens déjà envoyés et les e-mails adressés aux anciennes adresses.

## PM2 fige d'anciennes valeurs

`pm2 restart` garde les variables enregistrées au dernier démarrage, et elles priment sur `.env`. Après avoir changé `.env`, dans un shell qui n'a pas chargé `.env` : `pm2 delete` des processus concernés, relancer le déploiement, puis vérifier `pm2 jlist`. Constaté en staging le 3 novembre 2026 ; la production doit suivre la même étape.

## Retour arrière pendant la transition

L'ancien code refuse les adresses `suppernote.com` au démarrage. Revenir à une version antérieure à cette PR impose de restaurer aussi le `.env` d'avant (`*.bak-avant-suppernote-*`), puis `pm2 delete` et redémarrage. Le premier test de retour arrière du workflow staging échoue pour cette raison ; il passe dès que la release précédente contient cette PR.

## Ne pas figer le staging sur le nouveau domaine avant la fusion

Le code de `main` refuse `suppernote.com`. Si le `.env` de staging y passe avant la fusion, tout déploiement de `main` échoue en staging et la production ne reçoit plus rien (constaté le 3 novembre 2026 avec #606). Pour qualifier la branche : changer `.env` et `PUBLIC_API_URL_STAGING`, lancer `deploy-staging.yml` sur la branche, puis tout remettre et relancer `main`. Le passage définitif du staging se fait juste avant la fusion.

Qualifié ainsi le 3 novembre 2026 : déploiement, smoke tests et E2E verts, retour arrière vert sur la branche. Non testés : connexion réelle, webhooks entrants.
