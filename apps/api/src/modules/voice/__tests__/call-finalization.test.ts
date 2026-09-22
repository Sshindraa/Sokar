import { describe, expect, it, vi } from 'vitest';
import {
  deriveCallIntent,
  finalizeVoiceCall,
  pickDuration,
  pickIntent,
  pickOutcome,
  pickTranscript,
  planCallFinalization,
  resolveVoiceOutcome,
  type CallFinalizationDependencies,
  type CallFinalizationSnapshot,
  type VoiceCallFacts,
  type VoiceFinalizationHints,
} from '../call-finalization.service';

function facts(overrides: Partial<VoiceCallFacts> = {}): VoiceCallFacts {
  return {
    reservationCreated: false,
    handoffAccepted: false,
    handoffFailed: false,
    messageRecorded: false,
    reservationIntent: false,
    informational: false,
    errored: false,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CallFinalizationSnapshot> = {}): CallFinalizationSnapshot {
  return {
    id: 'call-1',
    restaurantId: 'rest-1',
    callSid: 'leg-1',
    callerPhone: null,
    durationSec: null,
    transcript: null,
    intent: null,
    outcome: null,
    sttProvider: null,
    llmProvider: null,
    ttsProvider: null,
    reservationCreated: false,
    messageRecorded: false,
    ...overrides,
  };
}

function hints(overrides: Partial<VoiceFinalizationHints> = {}): VoiceFinalizationHints {
  return { source: 'hangup', ...overrides };
}

/**
 * Faux client Prisma minimal : une ligne `Call` en mémoire, verrou no-op et
 * transaction directe. Suffit à exercer le chemin réel de finalisation.
 */
function makeFakeDb(initial: Partial<CallFinalizationSnapshot> | null) {
  const rows = new Map<string, Record<string, unknown>>();
  if (initial) {
    const callSid = initial.callSid ?? 'leg-1';
    rows.set(callSid, {
      id: initial.id ?? 'call-1',
      restaurantId: initial.restaurantId ?? 'rest-1',
      callSid,
      callerPhone: initial.callerPhone ?? null,
      durationSec: initial.durationSec ?? null,
      transcript: initial.transcript ?? null,
      intent: initial.intent ?? null,
      outcome: initial.outcome ?? null,
      sttProvider: initial.sttProvider ?? null,
      llmProvider: initial.llmProvider ?? null,
      ttsProvider: initial.ttsProvider ?? null,
      reservation: initial.reservationCreated ? { id: 'res-1' } : null,
      messages: initial.messageRecorded ? [{ id: 'msg-1' }] : [],
    });
  }

  const db = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    call: {
      findUnique: vi.fn(async ({ where }: { where: { callSid: string } }) => {
        return rows.get(where.callSid) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'created-1', reservation: null, messages: [], ...data };
        rows.set(String(data.callSid), row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { callSid: string }; data: object }) => {
        const row = { ...(rows.get(where.callSid) ?? {}), ...data };
        rows.set(where.callSid, row);
        return row;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
  return db as unknown as CallFinalizationDependencies['db'] & {
    call: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
}

describe('call finalization — décision par les faits', () => {
  it('classe la réservation réelle au-dessus de tout le reste', () => {
    expect(
      resolveVoiceOutcome(
        facts({
          reservationCreated: true,
          handoffAccepted: true,
          errored: true,
          informational: true,
        }),
      ),
    ).toBe('RESERVED');
    expect(resolveVoiceOutcome(facts({ handoffAccepted: true, errored: true }))).toBe('HANDOFF');
    expect(resolveVoiceOutcome(facts({ errored: true, informational: true }))).toBe('ERROR');
    expect(resolveVoiceOutcome(facts({ informational: true }))).toBe('INFO');
    expect(resolveVoiceOutcome(facts())).toBe('NO_ACTION');
  });

  it('distingue un message enregistré d’un simple abandon', () => {
    expect(resolveVoiceOutcome(facts({ messageRecorded: true }))).toBe('MESSAGE');
    // Un message reste au-dessus d'une panne tardive : l'humain a bien été
    // saisi du sujet avant l'incident de transport.
    expect(resolveVoiceOutcome(facts({ messageRecorded: true, errored: true }))).toBe('MESSAGE');
    // Et un transfert accepté reste préféré au message.
    expect(resolveVoiceOutcome(facts({ messageRecorded: true, handoffAccepted: true }))).toBe(
      'HANDOFF',
    );
  });

  it('distingue l’intention de réserver du succès de la réservation', () => {
    const plan = planCallFinalization(
      snapshot(),
      hints({ transcript: 'Je voudrais réserver une table pour quatre personnes' }),
    );
    expect(plan.intent).toBe('RESERVATION');
    expect(plan.facts.reservationIntent).toBe(true);
    expect(plan.outcome).toBe('NO_ACTION');
  });

  it('déduit l’intention du dialogue quand la transcription est absente', () => {
    expect(deriveCallIntent({ conversationIntent: 'reservation' })).toBe('RESERVATION');
    expect(deriveCallIntent({ conversationIntent: 'cancel' })).toBe('CANCEL');
    expect(deriveCallIntent({ transcript: 'Quels sont vos horaires ?' })).toBe('HOURS');
    expect(deriveCallIntent({})).toBeNull();
  });
});

describe('call finalization — écriture monotone', () => {
  it('ne remplace jamais une transcription complète par une plus courte', () => {
    expect(pickTranscript('Bonjour je voudrais réserver', 'Bonjour')).toBe(
      'Bonjour je voudrais réserver',
    );
    expect(pickTranscript('Bonjour', null)).toBe('Bonjour');
    expect(pickTranscript('Bonjour', 'Bonjour je voudrais réserver')).toBe(
      'Bonjour je voudrais réserver',
    );
    expect(pickTranscript(null, null)).toBeNull();
  });

  it('ne laisse pas une durée tardive nulle effacer une durée connue', () => {
    expect(pickDuration(42, null)).toBe(42);
    expect(pickDuration(42, 0)).toBe(42);
    expect(pickDuration(null, 0)).toBe(0);
    expect(pickDuration(42, 47.6)).toBe(48);
  });

  it('ne régresse jamais vers un outcome plus faible', () => {
    expect(pickOutcome('RESERVED', 'NO_ACTION')).toBe('RESERVED');
    expect(pickOutcome('HANDOFF', 'NO_ACTION')).toBe('HANDOFF');
    expect(pickOutcome('MESSAGE', 'NO_ACTION')).toBe('MESSAGE');
    expect(pickOutcome('HANDOFF', 'MESSAGE')).toBe('HANDOFF');
    expect(pickOutcome('INFO', 'ERROR')).toBe('INFO');
    expect(pickOutcome('NO_ACTION', 'RESERVED')).toBe('RESERVED');
    expect(pickOutcome(null, 'NO_ACTION')).toBe('NO_ACTION');
  });

  it('conserve une intention déjà identifiée', () => {
    expect(pickIntent('RESERVATION', null)).toBe('RESERVATION');
    expect(pickIntent('HOURS', null)).toBe('HOURS');
    expect(pickIntent('HOURS', 'RESERVATION')).toBe('RESERVATION');
    expect(pickIntent(null, 'CANCEL')).toBe('CANCEL');
  });

  it('n’écrit rien quand un rejeu porte exactement les mêmes faits', () => {
    const first = planCallFinalization(
      snapshot({ transcript: 'Bonjour', outcome: 'NO_ACTION', intent: 'HOURS' }),
      hints({ transcript: 'Bonjour', sttProvider: 'elevenlabs-scribe-v2-realtime' }),
    );
    const second = planCallFinalization(
      snapshot({
        transcript: 'Bonjour',
        outcome: 'NO_ACTION',
        intent: 'HOURS',
        sttProvider: first.data.sttProvider ?? null,
        llmProvider: first.data.llmProvider ?? null,
        ttsProvider: first.data.ttsProvider ?? null,
      }),
      hints({ transcript: 'Bonjour', sttProvider: 'elevenlabs-scribe-v2-realtime' }),
    );
    expect(second.updatedFields).toEqual([]);
  });
});

describe('finalizeVoiceCall — idempotence et ordre des événements', () => {
  it('crée la ligne manquante puis rejoue sans réécrire', async () => {
    const fake = makeFakeDb(null);
    const first = await finalizeVoiceCall(
      'leg-1',
      hints({ restaurantId: 'rest-1', transcript: 'Bonjour', durationSec: 30 }),
      { db: fake },
    );
    expect(first.created).toBe(true);
    expect(first.updatedFields).toContain('outcome');
    expect(first.outcome).toBe('NO_ACTION');

    const second = await finalizeVoiceCall(
      'leg-1',
      hints({ restaurantId: 'rest-1', transcript: 'Bonjour', durationSec: 30 }),
      { db: fake },
    );
    expect(second.created).toBe(false);
    expect(second.updatedFields).toEqual([]);
    expect(fake.call.create).toHaveBeenCalledTimes(1);
  });

  it('refuse de créer une ligne orpheline sans restaurant', async () => {
    const fake = makeFakeDb(null);
    const result = await finalizeVoiceCall('leg-orphan', hints({}), { db: fake });
    expect(result.skippedReason).toBe('unknown_restaurant');
    expect(fake.call.create).not.toHaveBeenCalled();
  });

  it('préserve la transcription quand les événements arrivent à l’envers', async () => {
    const fake = makeFakeDb(null);
    // 1. La route `/end` arrive en premier avec une transcription partielle.
    await finalizeVoiceCall(
      'leg-1',
      hints({ source: 'end-webhook', restaurantId: 'rest-1', transcript: 'Bonjour' }),
      { db: fake },
    );
    // 2. Le hangup arrive après, avec la transcription complète de la session.
    const late = await finalizeVoiceCall(
      'leg-1',
      hints({
        source: 'hangup',
        transcript: 'Bonjour je voudrais réserver pour quatre personnes',
        durationSec: 61,
      }),
      { db: fake },
    );
    expect(late.updatedFields).toContain('transcript');
    expect(late.updatedFields).toContain('durationSec');
    expect(late.intent).toBe('RESERVATION');
    expect(late.outcome).toBe('NO_ACTION');
  });

  it('ne réécrit pas une transcription plus courte ni une durée absente', async () => {
    const fake = makeFakeDb({
      transcript: 'Bonjour je voudrais réserver pour quatre personnes',
      durationSec: 61,
      outcome: 'NO_ACTION',
      intent: 'RESERVATION',
      sttProvider: 'elevenlabs-scribe-v2-realtime',
      llmProvider: 'groq',
      ttsProvider: 'cartesia-sonic',
    });
    const result = await finalizeVoiceCall(
      'leg-1',
      hints({ source: 'hangup', transcript: 'Bonjour', durationSec: null }),
      { db: fake },
    );
    expect(result.updatedFields).toEqual([]);
    expect(fake.call.update).not.toHaveBeenCalled();
  });

  it('n’annonce jamais RESERVED sans réservation réellement rattachée', async () => {
    const fake = makeFakeDb({ outcome: 'NO_ACTION', intent: 'RESERVATION' });
    const result = await finalizeVoiceCall('leg-1', hints({}), { db: fake });
    expect(result.outcome).toBe('NO_ACTION');
  });

  it('écrit RESERVED quand une réservation est réellement rattachée', async () => {
    const fake = makeFakeDb({ reservationCreated: true, outcome: 'NO_ACTION' });
    const result = await finalizeVoiceCall('leg-1', hints({}), { db: fake });
    expect(result.outcome).toBe('RESERVED');
    expect(result.facts.reservationCreated).toBe(true);
  });

  it('remonte l’erreur base pour laisser le worker réessayer', async () => {
    const failing = {
      $transaction: vi.fn().mockRejectedValue(new Error('db down')),
    } as unknown as CallFinalizationDependencies['db'];
    await expect(finalizeVoiceCall('leg-1', hints({}), { db: failing })).rejects.toThrow('db down');
  });
});

describe('finalizeVoiceCall — récupération commerciale', () => {
  const deps = (
    fake: CallFinalizationDependencies['db'],
    enqueueRecovery: CallFinalizationDependencies['enqueueRecovery'],
  ): CallFinalizationDependencies => ({
    db: fake,
    enqueueRecovery,
    loadRestaurantContext: async () => ({
      id: 'rest-1',
      name: 'Le Bistrot',
      slug: 'le-bistrot',
      phoneNumber: '+33100000000',
    }),
  });

  it('déclenche la récupération quand aucune réservation n’existe', async () => {
    const fake = makeFakeDb(null);
    const enqueueRecovery = vi.fn().mockResolvedValue(undefined);
    const callHints = hints({
      source: 'end-webhook',
      restaurantId: 'rest-1',
      transcript: 'Je voudrais réserver une table demain soir',
      to: '+33100000000',
      customerPhone: '+33600000000',
    });

    const first = await finalizeVoiceCall('leg-1', callHints, deps(fake, enqueueRecovery));
    expect(enqueueRecovery).toHaveBeenCalledTimes(1);
    expect(enqueueRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        callId: 'created-1',
        restaurantId: 'rest-1',
        customerPhone: '+33600000000',
        reason: 'no_action_with_intent',
      }),
      'leg-1',
    );
    expect(first.updatedFields).toContain('recovery');

    // Un rejeu réutilise le même `jobId` côté queue et le claim du worker,
    // qui garantissent un seul envoi.
    await finalizeVoiceCall('leg-1', callHints, deps(fake, enqueueRecovery));
    expect(enqueueRecovery).toHaveBeenCalledTimes(2);
  });

  it('ne récupère rien quand la réservation a finalement été créée', async () => {
    const fake = makeFakeDb({ reservationCreated: true, intent: 'RESERVATION' });
    const enqueueRecovery = vi.fn().mockResolvedValue(undefined);
    const result = await finalizeVoiceCall(
      'leg-1',
      hints({ transcript: 'Je voudrais réserver', customerPhone: '+33600000000' }),
      deps(fake, enqueueRecovery),
    );
    expect(result.outcome).toBe('RESERVED');
    expect(enqueueRecovery).not.toHaveBeenCalled();
  });

  it('ne récupère rien après un transfert accepté ou un message enregistré', async () => {
    const handoff = makeFakeDb({ intent: 'RESERVATION' });
    const enqueueHandoff = vi.fn().mockResolvedValue(undefined);
    const handoffResult = await finalizeVoiceCall(
      'leg-1',
      hints({ handoffConclusion: 'manager_transfer_accepted', customerPhone: '+33600000000' }),
      deps(handoff, enqueueHandoff),
    );
    expect(handoffResult.outcome).toBe('HANDOFF');
    expect(enqueueHandoff).not.toHaveBeenCalled();

    const message = makeFakeDb({ intent: 'RESERVATION', messageRecorded: true });
    const enqueueMessage = vi.fn().mockResolvedValue(undefined);
    const messageResult = await finalizeVoiceCall(
      'leg-1',
      hints({ customerPhone: '+33600000000' }),
      deps(message, enqueueMessage),
    );
    expect(messageResult.outcome).toBe('MESSAGE');
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it('récupère l’appel abandonné grâce au numéro persisté sur la ligne', async () => {
    // Cas du rattrapage : le webhook de fin n'est jamais arrivé, donc aucun
    // hint ne porte le numéro. Sans `callerPhone` persisté, la récupération
    // commerciale était impossible.
    const fake = makeFakeDb({
      intent: 'RESERVATION',
      callerPhone: '+33600000000',
      transcript: 'Je voudrais réserver une table demain soir',
    });
    const enqueueRecovery = vi.fn().mockResolvedValue(undefined);

    const result = await finalizeVoiceCall(
      'leg-1',
      hints({ source: 'sweep', restaurantId: 'rest-1' }),
      deps(fake, enqueueRecovery),
    );

    expect(result.updatedFields).toContain('recovery');
    expect(enqueueRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ customerPhone: '+33600000000' }),
      'leg-1',
    );
  });

  it('ne récupère rien quand la ligne n’a ni hint ni numéro persisté', async () => {
    const fake = makeFakeDb({ intent: 'RESERVATION' });
    const enqueueRecovery = vi.fn().mockResolvedValue(undefined);

    await finalizeVoiceCall(
      'leg-1',
      hints({ source: 'sweep', restaurantId: 'rest-1' }),
      deps(fake, enqueueRecovery),
    );

    expect(enqueueRecovery).not.toHaveBeenCalled();
  });

  it('marque un transfert refusé comme handoff_dropped', async () => {
    const fake = makeFakeDb({ intent: 'RESERVATION' });
    const enqueueRecovery = vi.fn().mockResolvedValue(undefined);
    await finalizeVoiceCall(
      'leg-1',
      hints({ handoffConclusion: 'manager_transfer_failed', customerPhone: '+33600000000' }),
      deps(fake, enqueueRecovery),
    );
    expect(enqueueRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'handoff_dropped' }),
      'leg-1',
    );
  });

  it('ne récupère rien sans numéro de rappel', async () => {
    const fake = makeFakeDb({ intent: 'RESERVATION' });
    const enqueueRecovery = vi.fn().mockResolvedValue(undefined);
    await finalizeVoiceCall('leg-1', hints({}), deps(fake, enqueueRecovery));
    expect(enqueueRecovery).not.toHaveBeenCalled();
  });
});
