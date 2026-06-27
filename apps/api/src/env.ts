import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// En production (PM2 --env-file=.env), le fichier app-local est la source de
// vérité. En dev, on fallback sur le .env du repo root puis .env.local.
// L'ancien code chargeait toujours ../../../.env (repo root), ce qui divergeait
// silencieusement du fichier chargé par PM2 (apps/api/.env).
const appEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '../../../.env');
const localEnv = path.resolve(__dirname, '../../../.env.local');

const envFile = fs.existsSync(appEnv) ? appEnv : fs.existsSync(rootEnv) ? rootEnv : localEnv;

dotenv.config({ path: envFile });
