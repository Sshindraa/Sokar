import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

// En production (PM2 --env-file=.env), le fichier app-local est la source de
// vérité. En dev, on fallback sur le .env du repo root puis .env.local.
// L'ancien code chargeait toujours ../../../.env (repo root), ce qui divergeait
// silencieusement du fichier chargé par PM2 (apps/api/.env).
const appEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '../../../.env');
const localEnv = path.resolve(__dirname, '../../../.env.local');

const envFile = fs.existsSync(appEnv) ? appEnv : fs.existsSync(rootEnv) ? rootEnv : localEnv;

dotenv.config({ path: envFile });

// ─── Defaults dev (ergonomie out-of-the-box) ─────────────────────────────
// En dev/test, si les 4 vars URL ne sont pas positionnées (pas de apps/api/.env
// ni .env.local complet), on injecte des valeurs localhost avant le parse Zod.
// Cela restaure le confort "pnpm dev marche sans .env dédié" qui existait avant
// la validation centralisée, sans réintroduire le risque en prod (où le refine
// sur l'allowlist s'applique et où ces defaults ne sont jamais injectés).
const nodeEnv = process.env.NODE_ENV ?? 'development';
if (nodeEnv !== 'production') {
  process.env.PUBLIC_URL ??= 'http://localhost:4000';
  process.env.SITE_URL ??= 'http://localhost:4002';
  process.env.DASHBOARD_URL ??= 'http://localhost:3000';
  process.env.API_URL ??= 'http://localhost:4000';
}

// ─── Validation centralisée (fail-fast au démarrage) ─────────────────────
// Remplace les fallbacks dispersés `process.env.X ?? 'https://...'` qui ont
// causé plusieurs bugs de domaine en prod (commits d8849c3, c6d4ebe, 5bf1137,
// fb89267, ed16dfe). En production, un host hors allowlist fait échouer le
// démarrage plutôt que d'utiliser silencieusement une mauvaise valeur.

const PROD_HOST_ALLOWLIST = [
  'sokar.tech',
  'api.sokar.tech',
  'app.sokar.tech',
  'widget.sokar.tech',
  // Staging — mêmes contraintes que la prod (NODE_ENV=production).
  'staging.sokar.tech',
  'api-staging.sokar.tech',
  // localhost autorisé en prod pour ne pas casser un test qui tournerait
  // NODE_ENV=production par erreur sans configurer les vraies valeurs.
  // Si ce devient trop permissif, retirer localhost de l'allowlist prod.
  'localhost',
];

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PUBLIC_URL: z.string().url('PUBLIC_URL must be a valid URL'),
    SITE_URL: z.string().url('SITE_URL must be a valid URL'),
    DASHBOARD_URL: z.string().url('DASHBOARD_URL must be a valid URL'),
    API_URL: z.string().url('API_URL must be a valid URL'),
    // CORS — allowlist explicite des origins navigateur (comma-separated)
    CORS_ORIGINS: z.string().optional(),
    // Clés API critiques — validées au démarrage en production
    TELNYX_API_KEY: z.string().optional(),
    DEEPGRAM_API_KEY: z.string().optional(),
    CARTESIA_API_KEY: z.string().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      // En production, tous les hosts URL doivent être dans l'allowlist
      const urls = [data.PUBLIC_URL, data.SITE_URL, data.DASHBOARD_URL, data.API_URL];
      return urls.every((url) => {
        try {
          const host = new URL(url).hostname;
          return PROD_HOST_ALLOWLIST.includes(host);
        } catch {
          return false;
        }
      });
    },
    {
      message: `En production, les hosts URL doivent être dans l'allowlist: ${PROD_HOST_ALLOWLIST.join(', ')}`,
      path: ['PUBLIC_URL'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      // En production, CORS_ORIGINS doit être défini explicitement
      // (pas de fallback hardcoded — cf. audit sécurité Phase 1)
      return !!data.CORS_ORIGINS;
    },
    {
      message:
        'En production, CORS_ORIGINS doit être défini explicitement (ex: "https://sokar.tech,https://www.sokar.tech"). Aucun fallback hardcoded.',
      path: ['CORS_ORIGINS'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      // En production, les clés API voice doivent être présentes
      // (sauf si la voice est explicitement désactivée — staging)
      const voiceDisabled = process.env.VOICE_DISABLED === 'true';
      if (voiceDisabled) return true;
      return !!data.TELNYX_API_KEY && data.TELNYX_API_KEY.length >= 20;
    },
    {
      message:
        'En production, TELNYX_API_KEY doit être définie (≥20 chars). Pour désactiver la voice (staging), set VOICE_DISABLED=true.',
      path: ['TELNYX_API_KEY'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      const voiceDisabled = process.env.VOICE_DISABLED === 'true';
      if (voiceDisabled) return true;
      return !!data.DEEPGRAM_API_KEY && data.DEEPGRAM_API_KEY.length >= 20;
    },
    {
      message:
        'En production, DEEPGRAM_API_KEY doit être définie (≥20 chars). Pour désactiver la voice (staging), set VOICE_DISABLED=true.',
      path: ['DEEPGRAM_API_KEY'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV !== 'production') return true;
      const voiceDisabled = process.env.VOICE_DISABLED === 'true';
      if (voiceDisabled) return true;
      return !!data.CARTESIA_API_KEY && data.CARTESIA_API_KEY.length >= 20;
    },
    {
      message:
        'En production, CARTESIA_API_KEY doit être définie (≥20 chars). Pour désactiver la voice (staging), set VOICE_DISABLED=true.',
      path: ['CARTESIA_API_KEY'],
    },
  );

function parseEnv() {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    console.error("\n❌ Validation des variables d'environnement échouée:\n");
    for (const issue of result.error.issues) {
      const field = issue.path.join('.');
      console.error(`  • ${field || '(root)'}: ${issue.message}`);
    }
    console.error('\nLe démarrage est interrompu. Corrigez les variables ci-dessus.\n');
    process.exit(1);
  }
  return result.data;
}

export const env = parseEnv();
