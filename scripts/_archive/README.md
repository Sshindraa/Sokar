# scripts/_archive

Scripts one-time déjà exécutés sur le VPS de production, conservés pour référence
historique et disaster recovery. **Ne pas ré-exécuter** sans vérifier que la
configuration cible correspond toujours à l'état attendu.

| Script | Rôle | Statut |
| --- | --- | --- |
| `install-deploy-privileges.sh` | Création du compte `deploy` + binaire `/usr/local/sbin/sokar-deploy-root` | Exécuté sur `sokar` (prod) |
| `install-r2-backup.sh` | Installation du wrapper cron `backup-postgres-r2.sh` + timers systemd | Exécuté sur `sokar` (prod) |
| `setup-origin-tls.sh` | Configuration Cloudflare Origin TLS (certificat origin) | Exécuté sur `sokar` (prod) |

## Scripts one-time NON archivés (réutilisables)

Ces scripts restent dans `scripts/ops/` car ils peuvent être nécessaires pour un
fresh setup ou disaster recovery :

- `scripts/ops/setup-staging.sh` — provisioning staging
- `scripts/ops/setup-swap.sh` — configuration swap VPS
