#!/usr/bin/env node
/**
 * Vérifie que le catalogue Stripe configuré correspond au catalogue produit.
 *
 * Pourquoi : le code ne contrôle que le préfixe `price_` des identifiants. Rien
 * n'empêche aujourd'hui de pointer `STRIPE_PRICE_ESSENTIAL_MONTHLY` vers l'ancien
 * prix 149 € et d'encaisser le mauvais montant. Ce script lit chaque prix côté
 * Stripe et compare montant, devise, cadence et état.
 *
 * Lecture seule : aucune création, modification ou suppression côté Stripe.
 *
 * Usage (les identifiants sont lus dans l'environnement) :
 *   node --env-file=/opt/sokar/apps/api/.env scripts/ops/verify-stripe-catalog.mjs
 *   node --env-file=.env scripts/ops/verify-stripe-catalog.mjs --json
 *
 * Les montants annuels reprennent la grille du runbook Stripe (-20 % sur
 * 12 mensualités). Chaque montant peut être surchargé par
 * `STRIPE_EXPECTED_<SUFFIXE>` (ex. `STRIPE_EXPECTED_ESSENTIAL_ANNUAL=199000`)
 * le jour où la grille change, sans toucher au script.
 */

const STRIPE_API = 'https://api.stripe.com/v1/prices';

/** Catalogue mensuel : montants en centimes, décidés par le produit. */
export const EXPECTED_CATALOG = [
  {
    env: 'STRIPE_PRICE_ESSENTIAL_MONTHLY',
    label: 'Essential mensuel',
    interval: 'month',
    amount: 19900,
  },
  {
    env: 'STRIPE_PRICE_ESSENTIAL_ANNUAL',
    label: 'Essential annuel (-20 %)',
    interval: 'year',
    amount: 191040,
  },
  { env: 'STRIPE_PRICE_PRO_MONTHLY', label: 'Pro mensuel', interval: 'month', amount: 29900 },
  { env: 'STRIPE_PRICE_PRO_ANNUAL', label: 'Pro annuel (-20 %)', interval: 'year', amount: 287040 },
  {
    env: 'STRIPE_PRICE_MULTI_SITE_MONTHLY',
    label: 'Multi-site mensuel (base)',
    interval: 'month',
    amount: 24900,
  },
  {
    env: 'STRIPE_PRICE_MULTI_SITE_ANNUAL',
    label: 'Multi-site annuel (base, -20 %)',
    interval: 'year',
    amount: 239040,
  },
  {
    env: 'STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY',
    label: 'Multi-site mensuel (site sup.)',
    interval: 'month',
    amount: 9900,
  },
  {
    env: 'STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL',
    label: 'Multi-site annuel (site sup., -20 %)',
    interval: 'year',
    amount: 95040,
  },
];

/** `STRIPE_PRICE_ESSENTIAL_MONTHLY` → `STRIPE_EXPECTED_ESSENTIAL_MONTHLY`. */
export function expectedAmountEnvName(envName) {
  return envName.replace(/^STRIPE_PRICE_/, 'STRIPE_EXPECTED_');
}

/**
 * Compare un prix attendu à la réponse Stripe. Retourne la liste des écarts
 * (vide si conforme). `expectedAmount: null` signifie « montant non contrôlé ».
 */
export function comparePrice(expected, actual, expectedAmount = null) {
  if (!actual || actual.error) {
    return [`prix introuvable côté Stripe (${actual?.error ?? 'réponse vide'})`];
  }

  const problems = [];
  if (actual.active === false) problems.push('prix archivé (active=false)');
  if ((actual.currency ?? '').toLowerCase() !== 'eur') {
    problems.push(`devise ${actual.currency ?? 'inconnue'} au lieu de eur`);
  }
  if (actual.recurring?.interval !== expected.interval) {
    problems.push(
      `cadence ${actual.recurring?.interval ?? 'absente'} au lieu de ${expected.interval}`,
    );
  }
  if (actual.recurring?.interval_count != null && actual.recurring.interval_count !== 1) {
    problems.push(`interval_count ${actual.recurring.interval_count} au lieu de 1`);
  }
  if (expectedAmount != null && actual.unit_amount !== expectedAmount) {
    problems.push(
      `montant ${actual.unit_amount ?? 'absent'} au lieu de ${expectedAmount} centimes`,
    );
  }

  return problems;
}

async function fetchPrice(id, secretKey) {
  try {
    const response = await fetch(`${STRIPE_API}/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (response.status === 404) return { error: '404' };
    if (!response.ok) return { error: `HTTP ${response.status}` };
    return await response.json();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const json = process.argv.includes('--json');
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();

  if (!secretKey) {
    process.stderr.write('STRIPE_SECRET_KEY absent : rien à vérifier.\n');
    return 2;
  }

  const missing = EXPECTED_CATALOG.filter((entry) => !process.env[entry.env]?.trim());
  if (missing.length > 0) {
    process.stderr.write(
      `Identifiants manquants : ${missing.map((entry) => entry.env).join(', ')}\n`,
    );
    return 1;
  }

  const ids = EXPECTED_CATALOG.map((entry) => process.env[entry.env].trim());
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

  const rows = [];
  for (const entry of EXPECTED_CATALOG) {
    const id = process.env[entry.env].trim();
    const override = process.env[expectedAmountEnvName(entry.env)];
    const expectedAmount = override ? Number.parseInt(override, 10) : entry.amount;

    const actual = await fetchPrice(id, secretKey);
    const problems = comparePrice(entry, actual, expectedAmount);
    if (duplicates.includes(id)) problems.push('identifiant dupliqué entre deux variables');

    rows.push({
      label: entry.label,
      env: entry.env,
      priceId: id,
      amount: actual?.unit_amount ?? null,
      currency: actual?.currency ?? null,
      interval: actual?.recurring?.interval ?? null,
      active: actual?.active ?? null,
      expectedAmount,
      problems,
    });
  }

  const failures = rows.filter((row) => row.problems.length > 0);

  if (json) {
    process.stdout.write(`${JSON.stringify({ rows, failures: failures.length }, null, 2)}\n`);
  } else {
    for (const row of rows) {
      const amount =
        row.amount == null ? '?' : `${(row.amount / 100).toFixed(2)} ${row.currency ?? ''}`.trim();
      const expected =
        row.expectedAmount == null ? 'non contrôlé' : `${(row.expectedAmount / 100).toFixed(2)} €`;
      const status = row.problems.length === 0 ? 'ok' : `ÉCART : ${row.problems.join(' ; ')}`;
      process.stdout.write(
        `${row.label.padEnd(32)} ${row.priceId.padEnd(28)} ${amount.padEnd(14)} attendu ${expected.padEnd(12)} ${status}\n`,
      );
    }
  }

  if (failures.length > 0) {
    process.stderr.write(
      `\n${failures.length} prix non conformes. Ne pas activer BILLING_CHECKOUT_ENABLED avant correction.\n`,
    );
    return 1;
  }

  return 0;
}

if (process.argv[1] && process.argv[1].endsWith('verify-stripe-catalog.mjs')) {
  process.exitCode = await main();
}
