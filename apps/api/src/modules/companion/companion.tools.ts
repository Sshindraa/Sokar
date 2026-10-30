/**
 * Outils en lecture seule du Companion. Chaque outil appelle en process le même calcul que l'écran
 * du dashboard et ne renvoie que des agrégats : jamais de nom, téléphone, e-mail ni texte libre client.
 */
import { z } from 'zod';
import { logger } from '../../shared/logger/pino';
import { computeRoi } from '../analytics/roi.service';
import { computeCallStats } from '../calls/call-stats';
import {
  computeDashboardStats,
  computeEmptySlots,
  computeNoShowStats,
} from '../dashboard/dashboard.routes';

const DASHBOARD_HREF = '/dashboard';
const SOURCE_HREFS: Record<string, string> = { call_stats: '/dashboard/calls' };
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const COMPANION_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'reservation_stats',
      description:
        'Réservations PRISES pendant la période (date de création), appels, couverts, CA estimé. 7d = 7 derniers jours, aujourd’hui compris ; 30d = 30 derniers jours, aujourd’hui compris.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', '7d', '30d'],
            description:
              'today : depuis minuit. 7d : 7 derniers jours (défaut). 30d : 30 derniers jours.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'call_stats',
      description:
        'Appels reçus par l’assistant téléphonique Léa : intention, résultat, hors horaires, durée moyenne. 7d = 7 derniers jours, aujourd’hui compris ; 30d = 30 derniers jours, aujourd’hui compris.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            enum: ['today', '7d', '30d'],
            description:
              'today : depuis minuit. 7d : 7 derniers jours (défaut). 30d : 30 derniers jours.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'upcoming_days',
      description:
        'Les 7 prochains jours : réservations et couverts PRÉVUS par jour, jours sous-réservés (moins de 3 réservations), CA non réalisé ESTIMÉ. revenueAtRisk et avgRevenuePerReservation valent 0 sans historique de 30 jours : ne les citez pas alors.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'no_shows',
      description:
        'Taux de no-show des 90 derniers jours, effet du rappel SMS, CA perdu ESTIMÉ. Avec moins de 20 réservations, ne tirez aucune conclusion ; revenueLost à 0 sans no-show ne se cite pas.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'monthly_roi',
      description:
        'Retour sur investissement d’un mois : réservations, couverts, CA et économies de commission TheFork ESTIMÉS, coût mensuel Sokar.',
      parameters: {
        type: 'object',
        properties: {
          month: {
            type: 'string',
            pattern: MONTH_PATTERN.source,
            description: 'Mois au format AAAA-MM.',
          },
        },
        required: ['month'],
        additionalProperties: false,
      },
    },
  },
];

const PeriodArgs = z.object({ period: z.enum(['today', '7d', '30d']).default('7d') });
const NoArgs = z.object({});
const MonthlyRoiArgs = z.object({ month: z.string().regex(MONTH_PATTERN) });

export interface CompanionToolResult {
  content: unknown;
  /** Présent seulement si l'outil a réussi : l'écran où l'équipe retrouve ces chiffres. */
  source?: { tool: string; href: string };
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return undefined;
  }
}

/**
 * Exécute un appel d'outil. Un argument invalide ou un échec ne lève jamais : le résultat d'erreur
 * repart au modèle, qui peut s'en servir pour répondre. Seul le nom de l'erreur est journalisé.
 */
export async function runCompanionTool(
  name: string,
  rawArgs: string,
  restaurantId: string,
): Promise<CompanionToolResult> {
  const args = parseArgs(rawArgs);
  const invalid = { content: { error: 'invalid_arguments' } };
  let result: Promise<unknown>;

  switch (name) {
    case 'reservation_stats': {
      const parsed = PeriodArgs.safeParse(args);
      if (!parsed.success) return invalid;
      result = computeDashboardStats(restaurantId, parsed.data.period);
      break;
    }
    case 'call_stats': {
      const parsed = PeriodArgs.safeParse(args);
      if (!parsed.success) return invalid;
      result = computeCallStats(restaurantId, parsed.data.period);
      break;
    }
    case 'upcoming_days': {
      if (!NoArgs.safeParse(args).success) return invalid;
      result = computeEmptySlots(restaurantId);
      break;
    }
    case 'no_shows': {
      if (!NoArgs.safeParse(args).success) return invalid;
      result = computeNoShowStats(restaurantId);
      break;
    }
    case 'monthly_roi': {
      const parsed = MonthlyRoiArgs.safeParse(args);
      if (!parsed.success) return invalid;
      result = computeRoi(restaurantId, parsed.data.month);
      break;
    }
    default:
      return { content: { error: 'unknown_tool' } };
  }

  try {
    return {
      content: await result,
      source: { tool: name, href: SOURCE_HREFS[name] ?? DASHBOARD_HREF },
    };
  } catch (error) {
    logger.warn(
      { tool: name, error: error instanceof Error ? error.name : 'unknown' },
      '[companion] outil en échec',
    );
    return { content: { error: 'tool_failed' } };
  }
}
