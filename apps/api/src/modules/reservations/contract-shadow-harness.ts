/**
 * Comparateur shadow strictement read-only.
 *
 * Ce module ne connaît ni Prisma, ni Redis, ni les providers de notification.
 * Il compare uniquement des résultats déjà normalisés. Il n'est pas branché
 * au trafic réel : les callbacks de `runReservationShadowComparison` sont
 * réservés aux tests ou à un futur harness explicitement read-only.
 */

export type ReservationContractOutcome = 'committed' | 'reused' | 'conflict' | 'not_found';

export type ReservationContractSnapshot = {
  outcome: ReservationContractOutcome;
  status: string | null;
  state: string | null;
  idempotency: 'keyed' | 'unkeyed' | 'reused' | 'not_applicable';
  auditEvents: readonly string[];
  notificationJobs: readonly string[];
  capacity: 'reserved' | 'released' | 'unchanged' | 'conflict';
  hold: 'none' | 'active' | 'consumed' | 'released';
};

export type ReservationContractSnapshotInput = Partial<ReservationContractSnapshot>;

export type ReservationShadowComparison = {
  equal: boolean;
  differences: readonly string[];
  legacy: ReservationContractSnapshot;
  agentic: ReservationContractSnapshot;
};

const SNAPSHOT_FIELDS = [
  'outcome',
  'status',
  'state',
  'idempotency',
  'auditEvents',
  'notificationJobs',
  'capacity',
  'hold',
] as const satisfies readonly (keyof ReservationContractSnapshot)[];

/** Normalise un résultat sans conserver d'identifiant ou de donnée client. */
export function normalizeReservationContractResult(
  input: ReservationContractSnapshotInput,
): ReservationContractSnapshot {
  return {
    outcome: input.outcome ?? 'not_found',
    status: input.status ?? null,
    state: input.state ?? null,
    idempotency: input.idempotency ?? 'not_applicable',
    auditEvents: [...(input.auditEvents ?? [])],
    notificationJobs: [...(input.notificationJobs ?? [])],
    capacity: input.capacity ?? 'unchanged',
    hold: input.hold ?? 'none',
  };
}

/** Compare deux sorties de chemins sans effectuer d'effet de bord. */
export function compareReservationContractResults(
  legacyInput: ReservationContractSnapshotInput,
  agenticInput: ReservationContractSnapshotInput,
): ReservationShadowComparison {
  const legacy = normalizeReservationContractResult(legacyInput);
  const agentic = normalizeReservationContractResult(agenticInput);
  const differences = SNAPSHOT_FIELDS.filter(
    (field) => JSON.stringify(legacy[field]) !== JSON.stringify(agentic[field]),
  );

  return {
    equal: differences.length === 0,
    differences,
    legacy,
    agentic,
  };
}

/**
 * Exécute deux fournisseurs de résultats pré-normalisés pour les tests.
 * Le harness ne fournit aucun accès DB/provider et n'est appelé par aucun
 * entrypoint de production.
 */
export async function runReservationShadowComparison(args: {
  legacy: () => Promise<ReservationContractSnapshotInput>;
  agentic: () => Promise<ReservationContractSnapshotInput>;
}): Promise<ReservationShadowComparison> {
  const legacy = await args.legacy();
  const agentic = await args.agentic();
  return compareReservationContractResults(legacy, agentic);
}
