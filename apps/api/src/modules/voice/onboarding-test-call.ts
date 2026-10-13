import { telnyxFetch } from '../../shared/telnyx/http-agent';

/**
 * Appel de test sortant du provisioning : Sokar appelle le gérant, lit un message court puis raccroche.
 * Ses événements ne désignent pas un restaurant par le numéro appelé (c'est le numéro du gérant), donc
 * ils ne passent pas par la résolution de restaurant de l'appel entrant.
 */
export const ONBOARDING_TEST_CALL_KIND = 'onboarding_test_call';

export const ONBOARDING_TEST_CALL_MESSAGE =
  'Bonjour. Ceci est un appel de test de Sokar. La liaison téléphonique fonctionne. Vous pouvez raccrocher.';

export interface OnboardingTestCallActions {
  speak(callControlId: string, text: string): Promise<void>;
  hangup(callControlId: string): Promise<void>;
}

export type OnboardingTestCallOutcome = 'spoken' | 'hung_up' | 'ignored';

export function parseClientState(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function isOnboardingTestCall(state: Record<string, unknown> | null): boolean {
  return state?.kind === ONBOARDING_TEST_CALL_KIND;
}

export async function handleOnboardingTestCallEvent(
  eventType: string,
  callControlId: string,
  actions: OnboardingTestCallActions = telnyxOnboardingTestCallActions,
): Promise<OnboardingTestCallOutcome> {
  switch (eventType) {
    case 'call.answered':
      await actions.speak(callControlId, ONBOARDING_TEST_CALL_MESSAGE);
      return 'spoken';
    case 'call.speak.ended':
      await actions.hangup(callControlId);
      return 'hung_up';
    default:
      return 'ignored';
  }
}

async function postCallAction(
  callControlId: string,
  action: string,
  body?: unknown,
): Promise<void> {
  const res = await telnyxFetch(
    `/v2/calls/${encodeURIComponent(callControlId)}/actions/${action}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.TELNYX_API_KEY}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`Telnyx ${action} failed with HTTP ${res.status}`);
  }
}

export const telnyxOnboardingTestCallActions: OnboardingTestCallActions = {
  speak: (callControlId, text) =>
    postCallAction(callControlId, 'speak', { payload: text, voice: 'female', language: 'fr-FR' }),
  hangup: (callControlId) => postCallAction(callControlId, 'hangup'),
};
