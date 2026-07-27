# Runbook — Rollback

## Staging

```zsh
ssh deploy@sokar
cd /opt/sokar-staging
bash scripts/deploy-staging.sh rollback
```

## Production

```zsh
ssh deploy@sokar
cd /opt/sokar
bash scripts/deploy-vps.sh --confirm-production rollback
```

> An application rollback does not restore the database. Plan DB rollback separately.
