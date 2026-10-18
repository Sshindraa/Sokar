import { telnyxFetch } from '../../shared/telnyx/http-agent';

/**
 * Appel entrant d'un restaurant dont l'abonnement est terminé. Le restaurant renvoie souvent encore
 * sa ligne vers Sokar : sans réponse, ses clients appelleraient dans le vide. Sokar décroche, lit un
 * message court au nom du restaurant, puis raccroche ; aucune session vocale ni écriture métier.
 * Même mécanique que l'appel de test de l'onboarding (`client_state` porté par l'appel).
 */
export const SUSPENDED_CALL_KIND = 'billing_suspended_call';

export function suspendedCallMessage(restaurantName: string | null | undefined): string {
  const name = restaurantName?.trim();
  return [
    name ? `Bonjour, vous êtes bien chez ${name}.` : 'Bonjour.',
    'Nous ne pouvons pas prendre votre appel pour le moment.',
    'Merci de rappeler un peu plus tard. Au revoir.',
  ].join(' ');
}

export interface SuspendedCallActions {
  answer(callControlId: string, clientState: string): Promise<void>;
  speak(callControlId: string, text: string, clientState: string): Promise<void>;
  hangup(callControlId: string): Promise<void>;
}

export type SuspendedCallOutcome = 'spoken' | 'hung_up' | 'ignored';

export function isSuspendedCall(state: Record<string, unknown> | null): boolean {
  return state?.kind === SUSPENDED_CALL_KIND;
}

function encodeState(restaurantName: string | null | undefined): string {
  return Buffer.from(
    JSON.stringify({ kind: SUSPENDED_CALL_KIND, name: restaurantName?.slice(0, 80) ?? null }),
  ).toString('base64');
}

/** Décroche l'appel ; la suite arrive par les webhooks `call.answered` puis `call.speak.ended`. */
export async function answerSuspendedCall(
  callControlId: string,
  restaurantName: string | null | undefined,
  actions: SuspendedCallActions = telnyxSuspendedCallActions,
): Promise<void> {
  await actions.answer(callControlId, encodeState(restaurantName));
}

export async function handleSuspendedCallEvent(
  eventType: string,
  callControlId: string,
  state: Record<string, unknown>,
  actions: SuspendedCallActions = telnyxSuspendedCallActions,
): Promise<SuspendedCallOutcome> {
  switch (eventType) {
    case 'call.answered': {
      const name = typeof state.name === 'string' ? state.name : null;
      await actions.speak(callControlId, suspendedCallMessage(name), encodeState(name));
      return 'spoken';
    }
    case 'call.speak.ended':
      await actions.hangup(callControlId);
      return 'hung_up';
    default:
      return 'ignored';
  }
}

async function postCallAction(callControlId: string, action: string, body: unknown): Promise<void> {
  const res = await telnyxFetch(
    `/v2/calls/${encodeURIComponent(callControlId)}/actions/${action}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`Telnyx ${action} failed with HTTP ${res.status}`);
  }
}

export const telnyxSuspendedCallActions: SuspendedCallActions = {
  answer: (callControlId, clientState) =>
    postCallAction(callControlId, 'answer', { client_state: clientState }),
  speak: (callControlId, text, clientState) =>
    postCallAction(callControlId, 'speak', {
      payload: text,
      voice: 'female',
      language: 'fr-FR',
      client_state: clientState,
    }),
  hangup: (callControlId) => postCallAction(callControlId, 'hangup', {}),
};
