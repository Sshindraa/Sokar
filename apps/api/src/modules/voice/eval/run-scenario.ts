/**
 * Joue un scénario de bout en bout : le LLM appelant parle, l'agent répond
 * par le vrai pipeline (simulateur), puis les contrôles et le juge notent.
 */
import { buildSystemPrompt, type OpeningHours } from '../prompts';
import { CallSessionManager } from '../stream/manager';
import { simulateCallerUtterance, startSimulatedCall } from '../stream/simulator';
import {
  evaluateConversation,
  type CheckResult,
  type CreatedReservation,
  type RecordedToolCall,
  type TranscriptLine,
} from './checks';
import {
  judgeNaturalness,
  nextCallerUtterance,
  type EvalLlmConfig,
  type NaturalnessScore,
} from './eval-llm';
import { DEFAULT_AVAILABLE_SLOTS, RESTAURANT_PRESETS, type Scenario } from './scenario';

/** Effets observés pendant un scénario, alimentés par les faux services. */
export interface ScenarioRuntime {
  availableSlots: string[];
  /** Horaires du restaurant du scénario : un jour fermé n'a aucun créneau. */
  openingHours: OpeningHours;
  toolCalls: RecordedToolCall[];
  createdReservations: CreatedReservation[];
  returnedSlots: string[];
}

export function createScenarioRuntime(scenario: Scenario): ScenarioRuntime {
  return {
    availableSlots: scenario.availableSlots ?? DEFAULT_AVAILABLE_SLOTS,
    openingHours: RESTAURANT_PRESETS[scenario.restaurant].openingHours as OpeningHours,
    toolCalls: [],
    createdReservations: [],
    returnedSlots: [],
  };
}

export interface ScenarioReport {
  id: string;
  category: string;
  passed: boolean;
  critical: boolean;
  checks: CheckResult[];
  naturalness: NaturalnessScore | null;
  callerTurns: number;
  endedByCaller: boolean;
  transcript: TranscriptLine[];
  error?: string;
}

const TIMEZONE = 'Europe/Paris';

function localDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Enregistre chaque outil demandé (y compris ceux refusés par la policy)
 * sans changer son exécution.
 */
export function instrumentToolCalls(
  mgr: CallSessionManager,
  getRuntime: () => ScenarioRuntime | null,
): void {
  const target = mgr as unknown as {
    executeTool: (session: unknown, name: string, argsJson: string, ...rest: unknown[]) => unknown;
  };
  const original = target.executeTool.bind(mgr);
  target.executeTool = (session, name, argsJson, ...rest) => {
    let args: Record<string, unknown> = {};
    try {
      args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
    } catch {
      args = { raw: argsJson };
    }
    getRuntime()?.toolCalls.push({ name, args });
    return original(session, name, argsJson, ...rest);
  };
}

export async function runScenario(
  scenario: Scenario,
  config: EvalLlmConfig,
  runtime: ScenarioRuntime,
  now = new Date(),
): Promise<ScenarioReport> {
  const preset = RESTAURANT_PRESETS[scenario.restaurant];
  const systemPrompt = buildSystemPrompt(
    {
      name: preset.name,
      openingHours: preset.openingHours as OpeningHours,
      timezone: TIMEZONE,
      personality: null,
    },
    now,
  );
  const mgr = CallSessionManager.getInstance();
  const { session, greeting } = await startSimulatedCall(
    {
      callControlId: `eval-${scenario.id}-${now.getTime()}`,
      restaurantId: preset.id,
      restaurantName: preset.name,
      systemPrompt,
      managerPhone: preset.managerPhone,
      timezone: TIMEZONE,
    },
    mgr,
  );

  const transcript: TranscriptLine[] = [{ speaker: 'agent', text: greeting }];
  let callerTurns = 0;
  let endedByCaller = false;
  let error: string | undefined;
  // Marge au-delà du maximum attendu pour mesurer un dépassement.
  const hardCap = scenario.expected.maxTurns + 3;

  try {
    while (callerTurns < hardCap && !session.ended) {
      const caller =
        callerTurns === 0 && scenario.opening
          ? { text: scenario.opening, ended: false }
          : await nextCallerUtterance(config, scenario, preset.name, transcript);
      if (caller.text) {
        callerTurns++;
        transcript.push({ speaker: 'caller', text: caller.text });
        const turn = await simulateCallerUtterance(session, caller.text, {
          mgr,
          languageCode: scenario.language,
        });
        const reply = turn.speech.join(' ').trim();
        if (reply) transcript.push({ speaker: 'agent', text: reply });
      }
      if (caller.ended || session.ended || session.ending || session.handoffInProgress) {
        endedByCaller = caller.ended;
        break;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    mgr.delete(session.callControlId);
  }

  const openingTimes = Object.values(preset.openingHours).flatMap((slot) =>
    slot ? [slot.open, slot.close] : [],
  );
  const checks = evaluateConversation({
    scenario,
    transcript,
    toolCalls: runtime.toolCalls,
    createdReservations: runtime.createdReservations,
    returnedSlots: runtime.returnedSlots,
    openingTimes,
    today: localDate(now),
    callerTurns,
  });
  if (error) checks.push({ name: 'no_error', passed: false, detail: error });

  let naturalness: NaturalnessScore | null = null;
  try {
    naturalness = await judgeNaturalness(config, transcript);
  } catch (err) {
    naturalness = { score: 0, comment: `juge indisponible : ${String(err)}` };
  }

  return {
    id: scenario.id,
    category: scenario.category,
    passed: checks.every((check) => check.passed),
    critical: checks.some((check) => check.critical),
    checks,
    naturalness,
    callerTurns,
    endedByCaller,
    transcript,
    ...(error ? { error } : {}),
  };
}
