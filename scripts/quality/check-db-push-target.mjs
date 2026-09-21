#!/usr/bin/env node
/**
 * Garde-fou `prisma db push` (R1-5).
 *
 * `db push` aligne le schéma sans migration ni trace dans `_prisma_migrations`.
 * C'est le bon outil en local, et un outil dangereux ailleurs : il peut
 * supprimer une colonne, recréer une contrainte ou vider une table sans laisser
 * de fichier à relire. La règle du dépôt (« jamais `db push` sur une base
 * distante sans confirmation explicite ») n'était jusqu'ici qu'une convention
 * écrite dans `AGENTS.md`.
 *
 * L'incident du 2026-06-28 a montré le coût de ce genre de convention : un
 * `db:seed` lancé sur la base de production avec `NODE_ENV` absent a publié neuf
 * fiches fictives dans le sitemap. Le seed a depuis un garde-fou basé sur la
 * cible réelle (`prisma/seed-demo-guard.ts`) ; `db push` n'en avait pas.
 *
 * Ce script refuse donc toute cible non locale, sauf opt-in explicite :
 *
 *   SOKAR_ALLOW_REMOTE_DB_PUSH=I-UNDERSTAND-DB-PUSH-IS-DESTRUCTIVE pnpm db:push
 *
 * Il n'imprime jamais l'URL complète (elle contient le mot de passe) : seule
 * l'adresse `hôte:port/base` est affichée.
 *
 * Usage:
 *   node scripts/quality/check-db-push-target.mjs             # vérifie la cible
 *   node scripts/quality/check-db-push-target.mjs --self-test  # teste la logique
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Sortie CLI : le depot interdit console.log dans les scripts versionnes. */
const writeOut = (message = '') => process.stdout.write(`${message}\n`);
const writeErr = (message = '') => process.stderr.write(`${message}\n`);

/** Fichiers lus dans l'ordre, le premier `DATABASE_URL` trouvé gagne. */
const ENV_FILES = [path.join(ROOT, 'packages/database/.env'), path.join(ROOT, '.env.local')];

/**
 * Hôtes considérés comme la machine du développeur. Volontairement limité au
 * loopback : `lvh.me` résout vers 127.0.0.1 mais reste un nom public, donc il
 * est traité comme distant — c'est exactement le cas qui a servi à reproduire
 * l'incident du seed.
 */
export const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const REMOTE_PUSH_OPT_IN = 'SOKAR_ALLOW_REMOTE_DB_PUSH';
export const REMOTE_PUSH_ACKNOWLEDGEMENT = 'I-UNDERSTAND-DB-PUSH-IS-DESTRUCTIVE';

/** Lecture minimale de `.env` : `KEY=VALUE`, guillemets optionnels. */
export function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

export function resolveDatabaseUrl(env, fileContents = []) {
  const fromEnv = typeof env.DATABASE_URL === 'string' ? env.DATABASE_URL.trim() : '';
  if (fromEnv) return { url: fromEnv, source: 'environnement' };
  for (const contents of fileContents) {
    const parsed = parseEnvFile(contents);
    if (parsed.DATABASE_URL) return { url: parsed.DATABASE_URL, source: 'fichier .env' };
  }
  return { url: '', source: 'absent' };
}

export function parseDatabaseTarget(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) return null;
  try {
    const url = new URL(rawUrl.trim());
    return {
      host: url.hostname,
      port: url.port || null,
      database: url.pathname.replace(/^\//, '') || null,
      isLocal: LOCAL_DATABASE_HOSTS.has(url.hostname),
    };
  } catch {
    return null;
  }
}

/** Adresse affichable : jamais d'utilisateur, jamais de mot de passe. */
export function describeTarget(target) {
  if (!target) return 'cible illisible';
  const port = target.port ? `:${target.port}` : '';
  const database = target.database ? `/${target.database}` : '';
  return `${target.host}${port}${database}`;
}

export function evaluateDbPushTarget(env) {
  const target = parseDatabaseTarget(env.DATABASE_URL);

  if (!target) {
    return {
      allowed: false,
      code: 'missing-target',
      reason:
        'DATABASE_URL est absente ou illisible. `prisma db push` ne peut pas être lancé sans cible connue.',
    };
  }
  if (target.isLocal) {
    return { allowed: true, code: 'local', target };
  }
  if ((env.NODE_ENV ?? '').trim() === 'production') {
    return {
      allowed: false,
      code: 'production',
      target,
      reason:
        'NODE_ENV=production. Une base de production se fait migrer avec `prisma migrate deploy`, jamais avec `db push`.',
    };
  }
  if ((env[REMOTE_PUSH_OPT_IN] ?? '').trim() === REMOTE_PUSH_ACKNOWLEDGEMENT) {
    return { allowed: true, code: 'remote-opt-in', target };
  }
  return {
    allowed: false,
    code: 'remote',
    target,
    reason:
      `La cible ${describeTarget(target)} n'est pas locale. ` +
      "`db push` n'écrit aucune migration : sur une base partagée, préférer `prisma migrate deploy`. " +
      `Pour forcer malgré tout : ${REMOTE_PUSH_OPT_IN}=${REMOTE_PUSH_ACKNOWLEDGEMENT}.`,
  };
}

function runSelfTest() {
  const cases = [
    {
      name: 'localhost → autorisé',
      env: { DATABASE_URL: 'postgresql://sokar:pw@localhost:5432/sokar' },
      allowed: true,
      code: 'local',
    },
    {
      name: '127.0.0.1 → autorisé',
      env: { DATABASE_URL: 'postgresql://sokar:pw@127.0.0.1:5432/sokar' },
      allowed: true,
      code: 'local',
    },
    {
      name: 'loopback IPv6 → autorisé',
      env: { DATABASE_URL: 'postgresql://sokar:pw@[::1]:5432/sokar' },
      allowed: true,
      code: 'local',
    },
    {
      name: 'hôte distant sans opt-in → refusé',
      env: { DATABASE_URL: 'postgresql://sokar:pw@db.sokar.tech:5432/sokar' },
      allowed: false,
      code: 'remote',
    },
    {
      name: 'hôte distant, NODE_ENV absent → refusé (incident du seed)',
      env: { DATABASE_URL: 'postgresql://sokar:pw@lvh.me:5432/sokar' },
      allowed: false,
      code: 'remote',
    },
    {
      name: 'NODE_ENV=production → refusé même avec opt-in',
      env: {
        DATABASE_URL: 'postgresql://sokar:pw@db.sokar.tech:5432/sokar',
        NODE_ENV: 'production',
        [REMOTE_PUSH_OPT_IN]: REMOTE_PUSH_ACKNOWLEDGEMENT,
      },
      allowed: false,
      code: 'production',
    },
    {
      name: 'opt-in exact → autorisé',
      env: {
        DATABASE_URL: 'postgresql://sokar:pw@db.sokar.tech:5432/sokar',
        [REMOTE_PUSH_OPT_IN]: REMOTE_PUSH_ACKNOWLEDGEMENT,
      },
      allowed: true,
      code: 'remote-opt-in',
    },
    {
      name: 'opt-in approximatif → refusé',
      env: {
        DATABASE_URL: 'postgresql://sokar:pw@db.sokar.tech:5432/sokar',
        [REMOTE_PUSH_OPT_IN]: 'true',
      },
      allowed: false,
      code: 'remote',
    },
    {
      name: 'DATABASE_URL absente → refusé',
      env: {},
      allowed: false,
      code: 'missing-target',
    },
    {
      name: 'DATABASE_URL illisible → refusé',
      env: { DATABASE_URL: 'pas-une-url' },
      allowed: false,
      code: 'missing-target',
    },
  ];

  let failures = 0;
  for (const testCase of cases) {
    const result = evaluateDbPushTarget(testCase.env);
    if (result.allowed !== testCase.allowed || result.code !== testCase.code) {
      failures += 1;
      writeErr(
        `  ❌ ${testCase.name} — attendu ${testCase.allowed}/${testCase.code}, obtenu ${result.allowed}/${result.code}`,
      );
    }
  }

  const envFile = parseEnvFile(
    ['# commentaire', 'DATABASE_URL="postgresql://sokar:pw@localhost:5432/sokar"', 'OTHER=1'].join(
      '\n',
    ),
  );
  if (envFile.DATABASE_URL !== 'postgresql://sokar:pw@localhost:5432/sokar') {
    failures += 1;
    writeErr('  ❌ parseEnvFile ne lit pas une valeur entre guillemets');
  }
  if (
    resolveDatabaseUrl({}, ['DATABASE_URL=postgresql://a@b:1/c']).url !== 'postgresql://a@b:1/c'
  ) {
    failures += 1;
    writeErr('  ❌ resolveDatabaseUrl ne retombe pas sur le fichier .env');
  }
  if (
    resolveDatabaseUrl({ DATABASE_URL: 'postgresql://env@localhost:5432/x' }, [
      'DATABASE_URL=postgresql://file@localhost:5432/x',
    ]).source !== 'environnement'
  ) {
    failures += 1;
    writeErr("  ❌ resolveDatabaseUrl doit laisser l'environnement primer sur le fichier");
  }
  if (describeTarget(parseDatabaseTarget('postgresql://u:secret@h:5432/db')).includes('secret')) {
    failures += 1;
    writeErr('  ❌ describeTarget ne doit jamais exposer le mot de passe');
  }

  const total = cases.length + 4;
  if (failures > 0) {
    writeErr(`check-db-push-target: ${failures}/${total} cas en échec`);
    process.exit(1);
  }
  writeOut(`check-db-push-target: ${total}/${total} cas OK`);
}

function main() {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
    return;
  }

  const fileContents = ENV_FILES.filter((file) => existsSync(file)).map((file) =>
    readFileSync(file, 'utf8'),
  );
  const { url, source } = resolveDatabaseUrl(process.env, fileContents);
  const result = evaluateDbPushTarget({ ...process.env, DATABASE_URL: url });

  if (result.allowed) {
    writeOut(
      `check-db-push-target: ${describeTarget(result.target)} (${result.code}, ${source}) — autorisé`,
    );
    return;
  }

  writeErr('');
  writeErr('❌ `db push` refusé par le garde-fou R1-5.');
  writeErr(`   ${result.reason}`);
  writeErr('');
  writeErr('   `db push` ne laisse aucune migration relisible : il est réservé à une base');
  writeErr('   locale jetable. Sur une base partagée, écrire une migration et la déployer.');
  writeErr('   Voir docs/runbooks/migration.md.');
  writeErr('');
  process.exit(1);
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main();
}
