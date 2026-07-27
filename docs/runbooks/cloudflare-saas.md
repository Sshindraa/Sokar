# Runbook — Cloudflare for SaaS (Premium Subdomain P2)

## Objectif

Permet aux restaurants d'utiliser leur propre domaine (ex: `reserve.chezmario.fr`)
pour leur page de réservation Sokar. Cloudflare gère le SSL automatiquement
(no certbot) et route le trafic vers l'origin `sokar.tech`.

## Prérequis

- Le domaine `sokar.tech` doit être géré par Cloudflare (DNS + proxy orange cloud).
- Le VPS doit être accessible depuis Cloudflare (ports 80/443 ouverts).

## Configuration Cloudflare (one-time)

### 1. Activer Cloudflare for SaaS

1. Dashboard Cloudflare → **sokar.tech** → **SSL/TLS** → **Custom Hostnames**
2. Cliquer **Enable Cloudflare for SaaS**
3. Définir le **fallback origin** : `sokar.tech`
4. Attendre que le statut passe à **Active**

### 2. Créer un API Token

1. Dashboard Cloudflare → **My Profile** → **API Tokens** → **Create Token**
2. Utiliser le template **Edit zone DNS** ou créer un custom token avec :
   - **Zone.SaaS** : Edit (pour gérer les Custom Hostnames)
   - **Zone.DNS** : Read (pour vérifier les CNAME)
   - **Zone** : Read (pour lister les zones)
3. **Zone Resources** : Include → Specific zone → `sokar.tech`
4. Copier le token (il ne sera plus affiché)

### 3. Récupérer le Zone ID

1. Dashboard Cloudflare → **sokar.tech** → **Overview**
2. En bas à droite : **Zone ID** → copier

### 4. Configurer les variables d'env sur le VPS

```zsh
ssh deploy@sokar
cd /opt/sokar/apps/api
cp .env .env.backup.$(date +%Y%m%d%H%M%S)
nano .env
```

Ajouter à la fin :

```env
CLOUDFLARE_API_TOKEN="votre-token-ici"
CLOUDFLARE_ZONE_ID="votre-zone-id-ici"
CLOUDFLARE_SAAS_FALLBACK_ORIGIN="sokar.tech"
```

Puis redémarrer l'API :

```zsh
cd /opt/sokar
pm2 restart sokar-api
```

### 5. Vérifier

```zsh
# Sur le VPS
curl -s http://127.0.0.1:4000/health | jq .
# Doit retourner 200 OK
```

## Flux restaurateur (2 clics)

1. Le restaurateur va dans **Dashboard → Connect → Domaine personnalisé**
2. Il entre `reserve.chezmario.fr` et clique **Configurer le domaine**
3. L'API provisionne un Custom Hostname sur Cloudflare (statut `pending`)
4. Le dashboard affiche les instructions CNAME :
   - `reserve.chezmario.fr` → `sokar.tech`
5. Le restaurateur configure le CNAME chez son registrar (OVH, Gandi, etc.)
6. Il clique **Vérifier le DNS** → l'API vérifie le CNAME localement (`dig`) + rafraîchit le statut Cloudflare
7. Cloudflare provisionne le SSL automatiquement (quelques minutes)
8. La page `https://reserve.chezmario.fr` est live

## Monitoring

- **Statut CF** : visible dans le dashboard restaurant (champ `customDomainStatus`)
- **Métriques** : `sokar_connect_custom_domain_total` (à implémenter si besoin)
- **Logs** : `grep "CF Custom Hostname" /opt/sokar/apps/api/logs/*.log`

## Troubleshooting

### Le statut reste `pending`

1. Vérifier que le CNAME est bien configuré : `dig CNAME reserve.chezmario.fr`
2. Le CNAME doit pointer vers `sokar.tech` (pas vers l'IP du VPS)
3. Attendre la propagation DNS (TTL du registrar, généralement 5-30 min)

### Le statut est `dns_validated` mais pas `active`

1. Le SSL est en cours de provisionnement (Cloudflare)
2. Attendre 5-15 min
3. Vérifier dans le dashboard Cloudflare → **Custom Hostnames**

### Erreur 502 sur le custom domain

1. Vérifier que Nginx route bien le trafic : `curl -H "Host: reserve.chezmario.fr" http://127.0.0.1/`
2. Le server block catch-all (`server_name _`) doit être actif
3. Vérifier que le fallback origin est bien `sokar.tech` dans Cloudflare

### Le restaurateur veut changer de domaine

1. Il entre le nouveau domaine dans le dashboard
2. L'API supprime l'ancien Custom Hostname sur Cloudflare + en crée un nouveau
3. Les CNAME doivent être reconfigurés chez le registrar

### Le restaurateur veut supprimer le domaine

1. Il clique sur le bouton **X** dans le dashboard
2. L'API supprime le Custom Hostname sur Cloudflare + clear DB
3. Le domaine ne pointe plus vers Sokar

## Rollback

En cas de problème, on peut désactiver Cloudflare for SaaS :

1. Supprimer les variables d'env `CLOUDFLARE_*` sur le VPS
2. Redémarrer l'API : `pm2 restart sokar-api`
3. Les custom domains existants restent en DB mais ne sont plus provisionnés
4. Les restaurateurs doivent reconfigurer leur DNS pour pointer vers `sokar.tech` directement

## Coûts

Cloudflare for SaaS : **$0.10 par custom hostname par mois** (au-delà du free tier de 100).
Voir https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/pricing/
