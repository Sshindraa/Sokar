import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const rootEnv = path.resolve(__dirname, '../../../.env');
const localEnv = path.resolve(__dirname, '../../../.env.local');

// Production : .env obligatoire.
// Développement/test : fallback sur .env.local si .env n'existe pas.
const envFile = fs.existsSync(rootEnv) ? rootEnv : localEnv;

dotenv.config({ path: envFile });
