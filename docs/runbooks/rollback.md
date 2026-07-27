# Runbook — Rollback

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
