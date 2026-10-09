'use client';

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Armchair } from 'lucide-react';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, SubmitButton } from '../ui';
import type { PracticalInfo, StepProps } from '../types';
import {
  CANCELLATION_PRESETS,
  COMMON_SIZES,
  CUSTOM_CANCELLATION,
  DEFAULT_DURATION,
  DEFAULT_MAX_PARTY,
  DURATIONS,
  MAX_DURATION,
  MIN_DURATION,
  OTHER_SIZES,
  durationLabel,
  firstPositive,
  hasStoredRules,
  plural,
  tablesPayload,
  type FloorResponse,
  type TableCounts,
} from './floor-config';
import { PanelRail, RoomRecap, RulesPanel, TablesPanel, type PanelId } from './FloorPanels';
import {
  PRACTICAL_REQUIRED,
  PracticalFields,
  buildPracticalChanges,
  initialPracticalInfo,
  isHttpUrl,
  missingPracticalQuestions,
} from './PracticalFields';

const CONTINUE_LABEL: Record<PanelId, string> = {
  room: 'Continuer',
  practical: 'Continuer',
};

/**
 * Salle, règles de réservation et informations pratiques : une seule étape, trois sections guidées.
 * Une seule section est ouverte à la fois (jamais de scroll) ; chaque « Continuer » enregistre sa
 * section, et la dernière valide l'étape. Les trois sections sont obligatoires : sans table il n'y a
 * pas de créneau, sans règles pas de durée, sans réponses pratiques l'assistant ne sait pas répondre.
 */
export function FloorStep({ onComplete }: StepProps) {
  const { get, put, patch, orgId } = useApi();
  const { state, updateTask } = useOnboarding();
  const exposure = state?.restaurant.exposureSettings;
  const specials = (exposure?.capacitySpecials ?? {}) as Record<string, unknown>;

  // ── Tables ──────────────────────────────────────────────────────────────
  const [counts, setCounts] = useState<TableCounts>({});
  const [extraSizes, setExtraSizes] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // ── Règles ──────────────────────────────────────────────────────────────
  const [partyLimit, setPartyLimit] = useState<number | null>(exposure?.maxPartySize ?? null);
  const [duration, setDuration] = useState(
    firstPositive(
      specials.serviceDurationMinutes,
      specials.defaultServiceDurationMinutes,
      specials.serviceDuration,
    ) ?? DEFAULT_DURATION,
  );
  // Tant que l'utilisateur n'a pas choisi, le groupe maximum suit la plus grande table.
  const storedPolicy =
    typeof specials.cancellationPolicy === 'string' ? specials.cancellationPolicy.trim() : '';
  const storedPreset = CANCELLATION_PRESETS.find((preset) => preset.text === storedPolicy);
  const [cancellation, setCancellation] = useState<string>(
    storedPreset
      ? storedPreset.id
      : storedPolicy
        ? CUSTOM_CANCELLATION
        : CANCELLATION_PRESETS[0].id,
  );
  const [customPolicy, setCustomPolicy] = useState(storedPreset ? '' : storedPolicy);
  const [depositRequired, setDepositRequired] = useState(
    Boolean(specials.depositRequired ?? exposure?.depositRequired),
  );
  const [depositAmount, setDepositAmount] = useState(Number(specials.depositAmount) || 15);
  const [depositThreshold, setDepositThreshold] = useState(Number(specials.depositThreshold) || 0);

  // ── Informations pratiques ──────────────────────────────────────────────
  const [initialPractical] = useState<PracticalInfo>(() =>
    initialPracticalInfo(state?.restaurant.practicalInfo, state?.restaurant.ambiance),
  );
  const [initialDietary] = useState<string[]>(() => state?.restaurant.dietary ?? []);
  const [practical, setPractical] = useState<PracticalInfo>(initialPractical);
  const [dietary, setDietary] = useState<string[]>(initialDietary);
  const [showMissing, setShowMissing] = useState(false);

  // ── Parcours ────────────────────────────────────────────────────────────
  const [active, setActive] = useState<PanelId | null>(null);
  const [done, setDone] = useState<Record<PanelId, boolean>>({
    room: false,
    practical: missingPracticalQuestions(initialPractical).length === 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // Dernières valeurs enregistrées : une section déjà à jour n'est pas réécrite.
  const savedTables = useRef<string | null>(null);
  const savedRules = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await get<FloorResponse>('restaurant/onboarding/floor');
      const loaded: TableCounts = Object.fromEntries(
        data.tables.map((row) => [row.capacity, row.count]),
      );
      setCounts(loaded);
      setExtraSizes(
        data.tables.map((row) => row.capacity).filter((size) => !COMMON_SIZES.includes(size)),
      );
      savedTables.current = JSON.stringify(tablesPayload(loaded));
      setDone((current) => ({
        ...current,
        room: data.stats.tableCount > 0 && hasStoredRules(specials),
      }));
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Impossible de charger votre salle.'));
    } finally {
      setLoading(false);
    }
    // `orgId` change quand on bascule d'établissement : on recharge sa salle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  // On ouvre la première section à compléter, une fois la salle connue.
  useEffect(() => {
    if (loading || active !== null) return;
    setActive(!done.room ? 'room' : 'practical');
  }, [loading, active, done]);

  const sizes = useMemo(
    () => [...new Set([...COMMON_SIZES, ...extraSizes])].sort((a, b) => a - b),
    [extraSizes],
  );
  const addableSizes = OTHER_SIZES.filter((size) => !sizes.includes(size));

  const totals = useMemo(() => {
    const entries = Object.entries(counts).map(([size, count]) => [Number(size), count] as const);
    return {
      tables: entries.reduce((sum, [, count]) => sum + count, 0),
      seats: entries.reduce((sum, [size, count]) => sum + size * count, 0),
      largest: entries.reduce((max, [size, count]) => (count > 0 ? Math.max(max, size) : max), 0),
    };
  }, [counts]);

  // La taille maximale d'un groupe se déduit des tables : elle ne peut pas dépasser la plus grande.
  const partyCapacity = totals.largest > 0 ? totals.largest : DEFAULT_MAX_PARTY;
  const maxParty = partyLimit ?? partyCapacity;

  const durationOptions = DURATIONS.includes(duration)
    ? DURATIONS
    : [...DURATIONS, duration].sort((a, b) => a - b);
  const policyText =
    cancellation === CUSTOM_CANCELLATION
      ? customPolicy.trim()
      : (CANCELLATION_PRESETS.find((preset) => preset.id === cancellation)?.text ?? '');
  const depositInvalid =
    depositRequired &&
    !(
      Number.isFinite(depositAmount) &&
      depositAmount > 0 &&
      Number.isInteger(depositThreshold) &&
      depositThreshold >= 0
    );

  const menuUrl = practical.menuUrl?.trim() ?? '';
  const menuUrlInvalid = menuUrl !== '' && !isHttpUrl(menuUrl);
  const missingQuestions = missingPracticalQuestions(practical);

  const tablesProblem = totals.tables > 0 ? '' : 'Ajoutez au moins une table.';
  const rulesProblem =
    duration < MIN_DURATION || duration > MAX_DURATION
      ? 'Choisissez la durée d’un repas.'
      : !policyText
        ? 'Précisez votre condition d’annulation.'
        : depositInvalid
          ? 'Complétez le montant de l’acompte.'
          : '';
  const practicalProblem =
    missingQuestions.length > 0
      ? `Il reste à répondre : ${missingQuestions.map((question) => question.label.toLowerCase()).join(', ')}.`
      : menuUrlInvalid
        ? 'Saisissez une adresse de menu complète, par exemple https://monrestaurant.fr/menu.'
        : '';

  function rulesPayload() {
    return {
      maxPartySize: maxParty,
      capacitySpecials: {
        totalCapacity: totals.seats,
        serviceDurationMinutes: duration,
        cancellationPolicy: policyText,
        depositRequired,
        depositAmount,
        depositThreshold,
      },
    };
  }

  // Un état déjà enregistré (règles stockées) sert de référence pour ne pas le réécrire.
  useEffect(() => {
    if (!loading && savedRules.current === null && hasStoredRules(specials)) {
      savedRules.current = JSON.stringify(rulesPayload());
    }
    // Calculé une seule fois, au premier rendu qui suit le chargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  async function saveTables() {
    const key = JSON.stringify(tablesPayload(counts));
    if (savedTables.current === key) return;
    await put('restaurant/onboarding/floor', { tables: tablesPayload(counts) });
    savedTables.current = key;
  }

  async function saveRules() {
    const payload = rulesPayload();
    const key = JSON.stringify(payload);
    if (savedRules.current === key) return;
    await patch(`restaurants/${orgId}/connect`, payload);
    savedRules.current = key;
  }

  async function savePractical() {
    const changes = buildPracticalChanges(initialPractical, practical);
    const dietaryChanged =
      dietary.length !== initialDietary.length ||
      dietary.some((item) => !initialDietary.includes(item));
    if (Object.keys(changes).length > 0 || dietaryChanged) {
      await put('restaurant/onboarding/practical', { practicalInfo: changes, dietary });
    }
  }

  function go(panel: PanelId) {
    setError('');
    setActive(panel);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || loading || !active) return;
    setError('');

    const checks: Array<[PanelId, string]> = [
      ['room', tablesProblem || rulesProblem],
      ['practical', practicalProblem],
    ];
    // Valide la section ouverte, et à la dernière tout le reste : on renvoie à la première à corriger.
    const toCheck = active === 'practical' ? checks : checks.filter(([panel]) => panel === active);
    const failing = toCheck.find(([, problem]) => problem);
    if (failing) {
      if (failing[0] === 'practical') setShowMissing(true);
      setActive(failing[0]);
      setError(failing[1]);
      return;
    }

    setSaving(true);
    try {
      if (active === 'room') {
        await saveTables();
        await saveRules();
        setDone((current) => ({ ...current, room: true }));
        setActive('practical');
      } else {
        await saveTables();
        await saveRules();
        await savePractical();
        const updated = await updateTask('complete', 'floor');
        if (!updated) throw new Error('completion failed');
        onComplete('knowledge');
      }
    } catch (err: unknown) {
      setError(
        getErrorMessage(err, 'La sauvegarde a échoué. Vos réponses sont conservées, réessayez.'),
      );
    } finally {
      setSaving(false);
    }
  }

  const answered = PRACTICAL_REQUIRED.length - missingQuestions.length;
  const railItems = [
    {
      id: 'room' as const,
      title: 'Salle & conditions',
      summary: done.room
        ? `${plural(totals.tables, 'table', 'tables')} · ${durationLabel(duration)} par repas`
        : totals.tables > 0
          ? `${plural(totals.tables, 'table', 'tables')} · règles à confirmer`
          : 'À renseigner',
      done: done.room && totals.tables > 0,
    },
    {
      id: 'practical' as const,
      title: 'Infos pratiques',
      summary: `${answered}/${PRACTICAL_REQUIRED.length} réponses`,
      done: done.practical && missingQuestions.length === 0,
    },
  ];

  const current = active;

  return (
    <form
      id="onboarding-voice-form"
      noValidate
      onSubmit={handleSubmit}
      className="flex min-h-0 flex-1 flex-col gap-3"
    >
      <StepHeader
        icon={Armchair}
        title="Salle et règles"
        body="Vos tables, vos règles de réservation et l’essentiel à dire à vos clients : de quoi calculer vos disponibilités, au téléphone comme en ligne."
      />
      {/* Le texte garde sa taille ; les petits écrans permettent le défilement. */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-col gap-3">
          <PanelRail items={railItems} active={current} onSelect={go} />

          {/* Les sections sont superposées : la zone prend la hauteur de la plus haute, donc le
              facteur reste le même d'une section à l'autre et rien ne saute au changement. */}
          <div className="grid">
            <PanelSlot active={current === null}>
              <p role="status" className="text-sm text-muted-foreground">
                Chargement de votre salle…
              </p>
            </PanelSlot>

            <PanelSlot active={current === 'room'}>
              <div className="flex flex-col gap-3">
                <div className="grid items-stretch gap-6 lg:grid-cols-2">
                  <TablesPanel
                    compact
                    loading={loading}
                    loadError={loadError}
                    onRetry={() => void load()}
                    counts={counts}
                    sizes={sizes}
                    addableSizes={addableSizes}
                    totals={totals}
                    onCount={(size, value) => {
                      setError('');
                      setCounts((previous) => ({ ...previous, [size]: value }));
                    }}
                    onTemplate={(template) => {
                      setError('');
                      setCounts(template);
                      setExtraSizes((previous) =>
                        previous.filter((size) => (template[size] ?? 0) > 0),
                      );
                    }}
                    onAddSize={(size) => setExtraSizes((previous) => [...previous, size])}
                  />
                  <RulesPanel
                    compact
                    values={{
                      maxParty,
                      duration,
                      durationOptions,
                      cancellation,
                      customPolicy,
                      policyText,
                      depositRequired,
                      depositAmount,
                      depositThreshold,
                    }}
                    onDuration={(value) => {
                      setError('');
                      setDuration(value);
                    }}
                    onCancellation={(value) => {
                      setError('');
                      setCancellation(value);
                    }}
                    onCustomPolicy={(value) => {
                      setError('');
                      setCustomPolicy(value);
                    }}
                    onDepositRequired={(value) => {
                      setError('');
                      setDepositRequired(value);
                    }}
                    onDepositAmount={setDepositAmount}
                    onDepositThreshold={setDepositThreshold}
                  />
                </div>
                <RoomRecap key={partyCapacity} maxParty={maxParty} onChange={setPartyLimit} />
              </div>
            </PanelSlot>

            <PanelSlot active={current === 'practical'}>
              <section
                aria-label="Informations pratiques"
                className="h-full rounded-2xl border border-border bg-background p-4"
              >
                <PracticalFields
                  info={practical}
                  dietary={dietary}
                  menuUrlInvalid={menuUrlInvalid}
                  showMissing={showMissing}
                  onChange={(key, value) => {
                    setError('');
                    setPractical((previous) => ({ ...previous, [key]: value }));
                  }}
                  onToggleDietary={(item) => {
                    setError('');
                    setDietary((previous) =>
                      previous.includes(item)
                        ? previous.filter((entry) => entry !== item)
                        : [...previous, item],
                    );
                  }}
                />
              </section>
            </PanelSlot>
          </div>
        </div>
      </div>

      {/* Une ligne est toujours réservée : une erreur n'agrandit ni ne réduit le reste de la page. */}
      <p role={error ? 'alert' : undefined} className="min-h-5 text-sm text-destructive">
        {error}
      </p>

      <SubmitButton saving={saving} disabled={loading || current === null || Boolean(loadError)}>
        {current ? CONTINUE_LABEL[current] : CONTINUE_LABEL.room}
      </SubmitButton>
    </form>
  );
}

/** Une section superposée aux autres ; les inactives restent mesurées mais invisibles et hors de portée. */
function PanelSlot({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <div
      className="col-start-1 row-start-1"
      aria-hidden={!active}
      inert={!active}
      style={active ? undefined : { visibility: 'hidden' }}
    >
      {children}
    </div>
  );
}
