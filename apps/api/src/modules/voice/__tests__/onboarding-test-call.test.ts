import { describe, expect, it, vi } from 'vitest';
import {
  ONBOARDING_TEST_CALL_KIND,
  ONBOARDING_TEST_CALL_MESSAGE,
  handleOnboardingTestCallEvent,
  isOnboardingTestCall,
  parseClientState,
} from '../onboarding-test-call';

function encode(state: unknown): string {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

function fakeActions() {
  return {
    speak: vi.fn(async (_callControlId: string, _text: string) => undefined),
    hangup: vi.fn(async (_callControlId: string) => undefined),
  };
}

describe('parseClientState', () => {
  it('décode un état client encodé en base64', () => {
    expect(
      parseClientState(encode({ kind: ONBOARDING_TEST_CALL_KIND, restaurantId: 'r1' })),
    ).toEqual({ kind: 'onboarding_test_call', restaurantId: 'r1' });
  });

  it('renvoie null pour un état absent ou illisible', () => {
    expect(parseClientState(undefined)).toBeNull();
    expect(parseClientState('pas du base64 json')).toBeNull();
  });
});

describe('isOnboardingTestCall', () => {
  it('reconnaît uniquement le type d’appel de test de l’onboarding', () => {
    expect(isOnboardingTestCall({ kind: ONBOARDING_TEST_CALL_KIND })).toBe(true);
    expect(isOnboardingTestCall({ kind: 'autre_flux' })).toBe(false);
    expect(isOnboardingTestCall(null)).toBe(false);
  });
});

describe('handleOnboardingTestCallEvent', () => {
  it('fait entendre le message de test dès que le gérant décroche', async () => {
    const actions = fakeActions();

    await expect(handleOnboardingTestCallEvent('call.answered', 'v3:abc', actions)).resolves.toBe(
      'spoken',
    );
    expect(actions.speak).toHaveBeenCalledWith('v3:abc', ONBOARDING_TEST_CALL_MESSAGE);
    expect(actions.hangup).not.toHaveBeenCalled();
  });

  it('raccroche une fois la lecture terminée', async () => {
    const actions = fakeActions();

    await expect(
      handleOnboardingTestCallEvent('call.speak.ended', 'v3:abc', actions),
    ).resolves.toBe('hung_up');
    expect(actions.hangup).toHaveBeenCalledWith('v3:abc');
    expect(actions.speak).not.toHaveBeenCalled();
  });

  it('ignore les autres événements sans agir sur l’appel', async () => {
    const actions = fakeActions();

    await expect(handleOnboardingTestCallEvent('call.initiated', 'v3:abc', actions)).resolves.toBe(
      'ignored',
    );
    expect(actions.speak).not.toHaveBeenCalled();
    expect(actions.hangup).not.toHaveBeenCalled();
  });

  it('dit le message en français, à la forme de politesse, sans donnée personnelle', () => {
    expect(ONBOARDING_TEST_CALL_MESSAGE).toMatch(/Vous pouvez raccrocher/);
    expect(ONBOARDING_TEST_CALL_MESSAGE).not.toMatch(/\d{6,}|@/);
  });
});
