#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const gatesPath = path.join(repositoryRoot, 'docs', 'release', 'product-gates.json');

const requiredGateIds = [
  'P0_USAGE',
  'P1_ESSENTIAL',
  'P2_CRM',
  'P3_MARKETING',
  'P4_ATTRIBUTION',
  'P5_PAYMENTS',
  'P6_POS',
  'P7_CUSTOMER_GROUP',
  'P8_REPUTATION',
  'P9_ECOSYSTEM',
  'PILOTS',
];
const validStatuses = new Set(['OPEN', 'LOCAL_ONLY', 'CLOSED']);

function fail(message) {
  console.error(`❌ Product release gate: ${message}`);
  process.exitCode = 1;
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(gatesPath, 'utf8'));
} catch (error) {
  fail(`impossible de lire ${path.relative(repositoryRoot, gatesPath)}`);
  if (error instanceof Error) console.error(`   ${error.message}`);
  process.exit();
}

if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.gates)) {
  fail('manifest invalide: schemaVersion=1 et gates[] sont requis');
  process.exit();
}

const gateIds = new Set(manifest.gates.map((gate) => gate?.id).filter(Boolean));
if (gateIds.size !== manifest.gates.length) {
  fail('manifest invalide: les identifiants de porte doivent être uniques');
  process.exit();
}
const missingGateIds = requiredGateIds.filter((id) => !gateIds.has(id));
if (missingGateIds.length > 0) {
  fail(`manifest incomplet: portes requises absentes (${missingGateIds.join(', ')})`);
  process.exit();
}

const invalidStatusGates = manifest.gates.filter((gate) => !validStatuses.has(gate?.status));
if (invalidStatusGates.length > 0) {
  fail(
    `manifest invalide: statut attendu OPEN, LOCAL_ONLY ou CLOSED (${invalidStatusGates
      .map((gate) => gate?.id ?? 'sans-id')
      .join(', ')})`,
  );
  process.exit();
}

const invalidEvidenceGates = manifest.gates.filter(
  (gate) =>
    !Array.isArray(gate?.evidence) ||
    gate.evidence.length === 0 ||
    gate.evidence.some(
      (evidence) =>
        typeof evidence !== 'string' ||
        evidence.trim().length === 0 ||
        !fs.existsSync(path.resolve(repositoryRoot, evidence)),
    ),
);
if (invalidEvidenceGates.length > 0) {
  fail(
    `manifest incomplet: chaque porte doit référencer des preuves existantes (${invalidEvidenceGates
      .map((gate) => gate?.id ?? 'sans-id')
      .join(', ')})`,
  );
  process.exit();
}

const invalidBlockerGates = manifest.gates.filter(
  (gate) =>
    gate?.status !== 'CLOSED' &&
    (!Array.isArray(gate?.blockers) ||
      gate.blockers.length === 0 ||
      gate.blockers.some((blocker) => typeof blocker !== 'string' || blocker.trim().length === 0)),
);
if (invalidBlockerGates.length > 0) {
  fail(
    `manifest incomplet: chaque porte non fermée doit lister ses bloqueurs (${invalidBlockerGates
      .map((gate) => gate?.id ?? 'sans-id')
      .join(', ')})`,
  );
  process.exit();
}

const invalidClosedBlockers = manifest.gates.filter(
  (gate) => gate?.status === 'CLOSED' && Array.isArray(gate?.blockers) && gate.blockers.length > 0,
);
if (invalidClosedBlockers.length > 0) {
  fail(
    `manifest incohérent: une porte CLOSED ne peut pas conserver de bloqueurs (${invalidClosedBlockers
      .map((gate) => gate?.id ?? 'sans-id')
      .join(', ')})`,
  );
  process.exit();
}

const openGates = manifest.gates.filter((gate) => gate?.status !== 'CLOSED');
const freezeActive = manifest.productionFreeze === true;

if (freezeActive || openGates.length > 0) {
  const reason = freezeActive
    ? 'le gel production est actif'
    : 'au moins une porte de sortie n’est pas CLOSED';
  fail(reason);
  for (const gate of openGates) {
    const statusLabel =
      gate.status === 'LOCAL_ONLY'
        ? 'LOCAL_ONLY — livraison locale présente, preuves externes ouvertes'
        : gate.status;
    const evidence =
      Array.isArray(gate.evidence) && gate.evidence.length > 0
        ? ` — preuve: ${gate.evidence.join(', ')}`
        : '';
    console.error(`   • ${gate.id}: ${gate.label ?? 'sans libellé'} [${statusLabel}]${evidence}`);
    for (const blocker of gate.blockers ?? []) console.error(`     - reste: ${blocker}`);
  }
  process.exit();
}

process.stdout.write(`✅ Product release gates closed (${manifest.gates.length} gates).\n`);
