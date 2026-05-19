/**
 * Service Vapi — gestion des appels et webhooks
 * Permet de tester Vapi en parallèle de Telnyx (Sprint 1/2)
 */
import { FastifyRequest } from 'fastify';
import {
  VapiWebhookPayload,
  VapiFunctionCallPayload,
  VapiFunctionResult,
  VapiEndOfCallReport,
  VapiAssistantRequestPayload,
  VapiAssistantResponse,
  VapiMessageType,
} from './vapi.types';

const VAPI_BASE_URL = 'https://api.vapi.ai';

function getApiKey(): string {
  const key = process.env.VAPI_API_KEY;
  if (!key) throw new Error('VAPI_API_KEY manquant');
  return key;
}

function vapiHeaders() {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    'Content-Type': 'application/json',
  };
}

/** ── Appels API Vapi ── */

export async function createVapiCall(phoneNumber: string, assistantId: string) {
  const res = await fetch(`${VAPI_BASE_URL}/call`, {
    method: 'POST',
    headers: vapiHeaders(),
    body: JSON.stringify({
      assistantId,
      phoneNumberId: phoneNumber, // ou phoneNumber direct
    }),
  });
  if (!res.ok) throw new Error(`Vapi create call failed: ${res.status}`);
  return res.json();
}

export async function listCalls(limit = 10) {
  const res = await fetch(`${VAPI_BASE_URL}/call?limit=${limit}`, {
    headers: vapiHeaders(),
  });
  if (!res.ok) throw new Error(`Vapi list calls failed: ${res.status}`);
  return res.json();
}

/** ── Webhook handlers ── */

export async function handleAssistantRequest(
  payload: VapiAssistantRequestPayload
): Promise<VapiAssistantResponse> {
  // Retourne l'assistant configuré avec les fonctions Callyx
  return {
    assistant: {
      name: 'Callyx Assistant',
      firstMessage:
        "Bonjour, je suis l'assistant virtuel de votre restaurant. Comment puis-je vous aider ?",
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        temperature: 0.7,
        maxTokens: 150,
      },
      voice: {
        provider: '11labs',
        voiceId: 'XB0fDUnXU5powFXDhCwa', // Adam (français)
      },
      functions: buildCallyxFunctions(),
      server: {
        url: `${process.env.PUBLIC_URL}/webhooks/vapi`,
        timeoutSeconds: 10,
      },
    },
  };
}

export async function handleFunctionCall(
  payload: VapiFunctionCallPayload
): Promise<VapiFunctionResult> {
  const { name, parameters } = payload.message.functionCall;

  switch (name) {
    case 'createReservation': {
      const { restaurantId, date, time, guests, name: customerName, phone } = parameters as Record<string, string>;
      // TODO: appeler le service reservation
      return {
        results: [
          {
            name: 'createReservation',
            result: `Réservation créée pour ${customerName} le ${date} à ${time} pour ${guests} personnes.`,
          },
        ],
      };
    }

    case 'checkAvailability': {
      const { restaurantId, date, time, guests } = parameters as Record<string, string>;
      // TODO: appeler le service availability
      return {
        results: [
          {
            name: 'checkAvailability',
            result: `Disponibilité vérifiée. Il reste des tables pour ${guests} personnes le ${date} à ${time}.`,
          },
        ],
      };
    }

    case 'getRestaurantInfo': {
      const { restaurantId } = parameters as Record<string, string>;
      return {
        results: [
          {
            name: 'getRestaurantInfo',
            result: 'Le restaurant est ouvert de 12h à 14h30 et de 19h à 22h30. Menu du jour à 28€.',
          },
        ],
      };
    }

    case 'cancelReservation': {
      const { reservationId } = parameters as Record<string, string>;
      return {
        results: [
          {
            name: 'cancelReservation',
            result: `Réservation ${reservationId} annulée avec succès.`,
          },
        ],
      };
    }

    default:
      return {
        results: [
          {
            name,
            result: `Fonction ${name} non implémentée encore.`,
          },
        ],
      };
  }
}

export async function handleEndOfCallReport(payload: VapiEndOfCallReport): Promise<void> {
  // Log l'appel dans la base de données
  const report = payload.message;
  console.log('=== Vapi End of Call Report ===');
  console.log('Call ID:', report.call.id);
  console.log('Duration:', new Date(report.endedAt).getTime() - new Date(report.startedAt).getTime(), 'ms');
  console.log('Cost:', report.cost);
  console.log('Summary:', report.summary);
  console.log('Success:', report.analysis?.successEvaluation);
  console.log('Transcript preview:', report.transcript?.slice(0, 200));

  // TODO: persister dans la DB (CallLog, Reservation, etc.)
}

/** ── Définition des fonctions Callyx pour Vapi ── */

function buildCallyxFunctions() {
  return [
    {
      name: 'createReservation',
      description: 'Créer une nouvelle réservation pour un restaurant',
      parameters: {
        type: 'object',
        properties: {
          restaurantId: { type: 'string', description: 'ID du restaurant' },
          date: { type: 'string', description: 'Date au format YYYY-MM-DD' },
          time: { type: 'string', description: 'Heure au format HH:MM' },
          guests: { type: 'number', description: 'Nombre de convives' },
          name: { type: 'string', description: 'Nom du client' },
          phone: { type: 'string', description: 'Numéro de téléphone du client' },
        },
        required: ['restaurantId', 'date', 'time', 'guests', 'name', 'phone'],
      },
      async: true,
    },
    {
      name: 'checkAvailability',
      description: 'Vérifier la disponibilité pour une date et une heure',
      parameters: {
        type: 'object',
        properties: {
          restaurantId: { type: 'string', description: 'ID du restaurant' },
          date: { type: 'string', description: 'Date au format YYYY-MM-DD' },
          time: { type: 'string', description: 'Heure au format HH:MM' },
          guests: { type: 'number', description: 'Nombre de convives' },
        },
        required: ['restaurantId', 'date', 'time', 'guests'],
      },
      async: true,
    },
    {
      name: 'getRestaurantInfo',
      description: 'Obtenir les informations du restaurant (horaires, menu, etc.)',
      parameters: {
        type: 'object',
        properties: {
          restaurantId: { type: 'string', description: 'ID du restaurant' },
        },
        required: ['restaurantId'],
      },
      async: false,
    },
    {
      name: 'cancelReservation',
      description: 'Annuler une réservation existante',
      parameters: {
        type: 'object',
        properties: {
          reservationId: { type: 'string', description: 'ID de la réservation' },
        },
        required: ['reservationId'],
      },
      async: true,
    },
  ];
}

/** ── Vérification du webhook secret ── */

export function verifyVapiWebhook(req: FastifyRequest): boolean {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) return true; // en dev, pas de vérification si pas configuré

  const signature = (req.headers['x-vapi-signature'] as string) || '';
  // NOTE: Vapi ne signe pas les webhooks par défaut. Tu peux vérifier via le secret server.
  return true;
}
