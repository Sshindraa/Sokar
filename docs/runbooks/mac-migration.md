# Runbook — Mac Migration

One-off procedure to clone the Sokar environment from one Mac to another (Hermes config + profiles, SSH keys, `.env` Sokar, `.zshrc` aliases). Not for daily use.

## Source Mac

```zsh
cd ~/Projects/Sokar/docs/archive/operations/mac-migration-<DATE>
./bundle.sh
# → produces ./out/sokar-mac-migration-<TS>.tar.gz.enc + .sha256 + PASSPHRASE-<TS>.txt
```

## Target Mac

Transport the archive + passphrase over a separate channel, then after cloning this repo (to have `install.sh`):

```zsh
cd docs/archive/operations/mac-migration-<DATE>
./install.sh /path/to/sokar-mac-migration-*.tar.gz.enc
# → decrypts, restores, verifies (config.yaml, auth.json, SSH pmbtc, profiles)
source ~/.zshrc
hermes doctor && ssh pmbtc 'hostname && pwd'
```

Details, contents, and what is **not** in the bundle (debug sessions, `node_modules`, local DBs): `docs/archive/operations/mac-migration-<DATE>/README.md`.
