import { beforeEach, expect, it, vi } from 'vitest';
import { ONBOARDING_TASK_KEYS } from '@/features/onboarding/types';
import OnboardingStepPage from './page';

const redirect = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ redirect }));

beforeEach(() => {
  redirect.mockReset();
  redirect.mockImplementation(() => {
    throw new Error('redirect');
  });
});

it.each(ONBOARDING_TASK_KEYS)('ouvre %s dans le parcours principal', async (step) => {
  await expect(OnboardingStepPage({ params: Promise.resolve({ step }) })).rejects.toThrow(
    'redirect',
  );
  const target = step === 'channels' ? 'connect-identity' : step;
  expect(redirect).toHaveBeenCalledWith(`/onboarding?step=${target}`);
});

it('renvoie une ancienne étape inconnue vers le restaurant', async () => {
  await expect(
    OnboardingStepPage({ params: Promise.resolve({ step: 'unknown' }) }),
  ).rejects.toThrow('redirect');
  expect(redirect).toHaveBeenCalledWith('/onboarding?step=restaurant');
});

it.each(['channels', 'connect-location', 'connect-cuisine'])(
  'conserve le lien historique %s',
  async (step) => {
    await expect(OnboardingStepPage({ params: Promise.resolve({ step }) })).rejects.toThrow(
      'redirect',
    );
    expect(redirect).toHaveBeenCalledWith('/onboarding?step=connect-identity');
  },
);
