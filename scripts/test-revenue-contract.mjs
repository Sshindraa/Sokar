/**
 * Test de contrat — Calcul Revenu & ROI Dashboard
 * Vérifie la logique mathématique du ROI service
 * Usage : node scripts/test-revenue-contract.mjs
 */

const DEFAULT_AVERAGE_TICKET = 35;
const THEFORK_COMMISSION_PER_PAX = 3;

// ─── Simule la logique de computeRoi ───────────────────────────────────────
function computeRevenue(reservations, plan = 'PRO') {
  const totalCouverts = reservations.reduce((s, r) => s + (r.partySize ?? 0), 0);

  const estimatedRevenue = reservations.reduce((s, r) => {
    const rev = Number(r.estimatedRevenue ?? 0);
    return s + (rev > 0 ? rev : (r.partySize ?? 0) * DEFAULT_AVERAGE_TICKET);
  }, 0);

  const theforkSavings = totalCouverts * THEFORK_COMMISSION_PER_PAX;
  const monthlyCost = { STARTER: 149, PRO: 249, PREMIUM: 249 }[plan] ?? 149;
  const roiMultiplier = monthlyCost > 0 ? Math.round((theforkSavings / monthlyCost) * 10) / 10 : 0;

  return {
    totalReservations: reservations.length,
    totalCouverts,
    estimatedRevenue: Math.round(estimatedRevenue),
    theforkSavings,
    monthlyCost,
    roiMultiplier,
  };
}

// ─── Assertions ────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(name, condition) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}`);
    failed++;
  }
}

console.log('\n━━━ Test Contract — Revenue & ROI Dashboard ━━━\n');

// 1. Réservations avec estimatedRevenue rempli
const reservationsWithRevenue = [
  { partySize: 4, estimatedRevenue: 160 },   // 4 × 40€
  { partySize: 2, estimatedRevenue: 70 },     // 2 × 35€
  { partySize: 6, estimatedRevenue: 210 },   // 6 × 35€
];
const roi1 = computeRevenue(reservationsWithRevenue, 'PRO');
assert('Revenu avec estimatedRevenue', roi1.estimatedRevenue === 440); // 160+70+210
assert('Couverts totals', roi1.totalCouverts === 12);
assert('TheFork savings', roi1.theforkSavings === 36); // 12 × 3€
assert('Monthly cost Pro', roi1.monthlyCost === 249);
assert('ROI multiplier', roi1.roiMultiplier === 0.1); // 36/249 = 0.144 → arrondi à 0.1

// 2. Réservations sans estimatedRevenue (fallback)
const reservationsWithoutRevenue = [
  { partySize: 4, estimatedRevenue: null },
  { partySize: 2, estimatedRevenue: 0 },     // 0 = pas de revenu → fallback
  { partySize: 3, estimatedRevenue: undefined },
];
const roi2 = computeRevenue(reservationsWithoutRevenue, 'STARTER');
assert('Fallback revenu 4 pers', roi2.estimatedRevenue === (4+2+3) * 35); // 9 × 35 = 315
assert('Couverts totals fallback', roi2.totalCouverts === 9);
assert('TheFork fallback', roi2.theforkSavings === 27); // 9 × 3€
assert('Monthly cost Starter', roi2.monthlyCost === 149);
assert('ROI multiplier fallback', roi2.roiMultiplier === 0.2); // 27/149 = 0.181 → 0.2

// 3. Mix — certains avec, certains sans
const reservationsMixed = [
  { partySize: 4, estimatedRevenue: 200 },   // utilise 200
  { partySize: 2, estimatedRevenue: null },  // fallback 2×35=70
  { partySize: 3, estimatedRevenue: 0 },     // fallback 3×35=105
];
const roi3 = computeRevenue(reservationsMixed, 'PRO');
assert('Mix revenu', roi3.estimatedRevenue === 375); // 200 + 70 + 105
assert('Mix TheFork', roi3.theforkSavings === 27); // 9 × 3€

// 4. Aucune réservation
const roi4 = computeRevenue([], 'PRO');
assert('Empty reservations', roi4.totalReservations === 0);
assert('Empty couverts', roi4.totalCouverts === 0);
assert('Empty revenue', roi4.estimatedRevenue === 0);
assert('Empty thefork', roi4.theforkSavings === 0);
assert('Empty ROI', roi4.roiMultiplier === 0);

// 5. Dashboard /dashboard/stats mapping simulation
function mapDashboardStats(apiResponse) {
  return {
    totalCalls: apiResponse.total_calls ?? 0,
    totalReservations: apiResponse.total_reservations ?? 0,
    answeredRate: apiResponse.answered_rate ?? 0,
    revenueRecovered: apiResponse.revenue_recovered ?? 0,
    theforkSavings: apiResponse.thefork_savings ?? 0,
    roiMultiplier: apiResponse.roi_multiplier ?? 0,
    period: apiResponse.period ?? '',
  };
}

const mockApiResponse = {
  total_calls: 42,
  total_reservations: 8,
  answered_rate: 95,
  revenue_recovered: 280,
  thefork_savings: 24,
  roi_multiplier: 0.1,
  period: '2026-06',
};
const mapped = mapDashboardStats(mockApiResponse);
assert('Dashboard mapping — calls', mapped.totalCalls === 42);
assert('Dashboard mapping — reservations', mapped.totalReservations === 8);
assert('Dashboard mapping — revenue', mapped.revenueRecovered === 280);
assert('Dashboard mapping — thefork', mapped.theforkSavings === 24);
assert('Dashboard mapping — roi', mapped.roiMultiplier === 0.1);
assert('Dashboard mapping — period', mapped.period === '2026-06');

// 6. MetricCard subtitle format
function formatSubtitle(theforkSavings) {
  return theforkSavings
    ? `+ ${theforkSavings.toLocaleString('fr-FR')} € économisés sur TheFork`
    : undefined;
}
assert('Subtitle format 24€', formatSubtitle(24) === '+ 24 € économisés sur TheFork');
assert('Subtitle format 1500€', formatSubtitle(1500).includes('1') && formatSubtitle(1500).includes('500'));
assert('Subtitle format 0', formatSubtitle(0) === undefined);
assert('Subtitle format null', formatSubtitle(null) === undefined);

// ─── Résumé ──────────────────────────────────────────────────────────────────
console.log(`\n━━━ Résultat : ${passed} passed, ${failed} failed ━━━\n`);
if (failed > 0) {
  process.exit(1);
}
