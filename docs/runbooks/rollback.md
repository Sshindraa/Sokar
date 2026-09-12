# Runbook — Rollback

> **Statut : ACTIF — audité le 12 septembre 2026.** Le rollback applicatif et l'option de
> restauration DB sont implémentés ; une restauration vierge a été exercée. Le RTO complet d'un
> rollback production avec reprise métier reste à mesurer. Voir
> [`../DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md).

## Staging

```zsh
ssh deploy@sokar
cd /opt/sokar-staging
bash scripts/deploy.sh --env staging rollback
```

## Production

```zsh
ssh deploy@sokar
cd /opt/sokar
bash scripts/deploy.sh --env prod --confirm-production rollback
```

## Rollback vers une release spécifique

```zsh
bash scripts/deploy.sh --env prod --confirm-production rollback 20260726T194319Z
```

## Rollback avec restauration DB

Par défaut, le rollback restaure uniquement les artefacts (API, dashboard, connect).
Pour restaurer aussi la base de données depuis la backup horodatée dans le dossier
de release, ajouter `--with-db-rollback` :

```zsh
bash scripts/deploy.sh --env prod --confirm-production rollback --with-db-rollback
```

> ⚠️ Le rollback DB restaure la backup prise **avant** le build de la release cible.
> Toute donnée écrite après cette backup sera perdue.

> Sans `--with-db-rollback`, un rollback applicatif ne restaure pas la base de données.
> Planifier le rollback DB séparément si des migrations ont été appliquées.

## Mesure du restore vierge

Le test reproductible se lance depuis le VPS et crée puis supprime une base temporaire :

```zsh
cd /opt/sokar
/usr/bin/time -p bash scripts/database/test-restore-vierge.sh
```

La répétition du 7 septembre 2026 à 22:04 UTC a restauré `20260907T020001Z.dump` (130 148 octets) dans `sokar_restore_test_20260907220422`, vérifié 32 tables, 73 contraintes, 117 index et les deux index critiques `agentic_holds`, puis supprimé la base. Le dump avait 20 h 05 d’âge ; le temps total mesuré était de 4,00 s. Ces chiffres décrivent le RPO observable et le RTO d’une restauration vierge. Le RTO production complet doit inclure arrêt/reprise API, bascule de base et smoke métier ; il n’est pas encore validé.
