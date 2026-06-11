'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import type { OnboardingAction, OnboardingState, OnboardingTaskKey } from './types';

type OnboardingContextValue = {
  state: OnboardingState | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  updateTask: (
    action: OnboardingAction,
    task?: OnboardingTaskKey,
    options?: { reason?: string; metadata?: Record<string, unknown> },
  ) => Promise<OnboardingState | null>;
  openStep: (task: OnboardingTaskKey) => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const PREVIEW_STATE: OnboardingState = {
  onboardingDone: false,
  onboardingCompletedAt: null,
  onboardingActivatedAt: null,
  onboardingLastSeenAt: new Date().toISOString(),
  firstCallAt: null,
  completedCount: 1,
  totalCount: 5,
  progress: 20,
  currentStep: {
    key: 'hours',
    title: 'Quand répondre et réserver',
    description: 'Créneaux d’ouverture que l’assistant peut proposer.',
    required: false,
    index: 2,
    status: 'current',
    state: { status: 'current' },
  },
  steps: [
    {
      key: 'restaurant',
      title: 'Identité du restaurant',
      description: 'Nom, gérant et coordonnées de contact.',
      required: true,
      index: 1,
      status: 'completed',
      state: { status: 'completed' },
    },
    {
      key: 'hours',
      title: 'Quand répondre et réserver',
      description: 'Créneaux d’ouverture que l’assistant peut proposer.',
      required: false,
      index: 2,
      status: 'current',
      state: { status: 'current' },
    },
    {
      key: 'knowledge',
      title: 'Ce que l’assistant doit savoir',
      description: 'Ton, ambiance et consignes commerciales.',
      required: false,
      index: 3,
      status: 'pending',
      state: { status: 'pending' },
    },
    {
      key: 'calendar',
      title: 'Connexion au planning',
      description: 'Google Calendar ou fallback manuel.',
      required: false,
      index: 4,
      status: 'blocked',
      state: {
        status: 'blocked',
        reason: 'Aperçu : Google OAuth demande une configuration Clerk/API.',
      },
    },
    {
      key: 'phone',
      title: 'Mise en service des appels',
      description: 'Numéro Sokar et consignes de renvoi opérateur.',
      required: false,
      index: 5,
      status: 'pending',
      state: { status: 'pending' },
    },
  ],
  defaultHours: {
    tue: { open: '12:00', close: '22:00' },
    wed: { open: '12:00', close: '22:00' },
    thu: { open: '12:00', close: '22:00' },
    fri: { open: '12:00', close: '22:00' },
    sat: { open: '12:00', close: '22:00' },
  },
  restaurant: {
    id: 'preview',
    name: 'Le Bistrot Sokar',
    managerPhone: '+33600000000',
    managerEmail: 'gerant@sokar.local',
    phoneNumber: '+33100000000',
    phoneAssigned: true,
    openingHours: {},
    googleCalendarId: null,
    googleConnected: false,
    personality: null,
  },
};

function updatePreviewStep(
  current: OnboardingState,
  action: OnboardingAction,
  task?: OnboardingTaskKey,
) {
  if (!task || action === 'seen') return current;

  const steps = current.steps.map((step) => {
    if (action === 'start') {
      if (step.key === task && step.status !== 'completed') {
        return {
          ...step,
          status: 'current' as const,
          state: { ...step.state, status: 'current' as const },
        };
      }
      if (step.status === 'current') {
        return {
          ...step,
          status: 'pending' as const,
          state: { ...step.state, status: 'pending' as const },
        };
      }
    }

    if (step.key === task && action === 'complete') {
      return {
        ...step,
        status: 'completed' as const,
        state: { ...step.state, status: 'completed' as const },
      };
    }

    if (step.key === task && action === 'skip') {
      return {
        ...step,
        status: 'skipped' as const,
        state: { ...step.state, status: 'skipped' as const },
      };
    }

    return step;
  });

  const completedCount = steps.filter((step) => step.status === 'completed').length;
  const currentStep =
    steps.find((step) => step.status === 'current') ??
    steps.find((step) => step.status === 'blocked') ??
    steps.find((step) => step.status !== 'completed') ??
    steps[steps.length - 1];

  return {
    ...current,
    steps,
    currentStep,
    completedCount,
    progress: Math.round((completedCount / steps.length) * 100),
    onboardingDone: completedCount === steps.length,
  };
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  if (!hasClerkKey) {
    return <PreviewOnboardingProvider>{children}</PreviewOnboardingProvider>;
  }

  return <ApiOnboardingProvider>{children}</ApiOnboardingProvider>;
}

function PreviewOnboardingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<OnboardingState | null>(PREVIEW_STATE);

  const refresh = useCallback(async () => {
    setState((current) => current ?? PREVIEW_STATE);
  }, []);

  const updateTask = useCallback(async (action: OnboardingAction, task?: OnboardingTaskKey) => {
    let nextState: OnboardingState | null = null;
    setState((current) => {
      nextState = updatePreviewStep(current ?? PREVIEW_STATE, action, task);
      return nextState;
    });
    return nextState;
  }, []);

  const openStep = useCallback(
    async (task: OnboardingTaskKey) => {
      await updateTask('start', task);
      router.push(`/onboarding/${task}`);
    },
    [router, updateTask],
  );

  const value = useMemo(
    () => ({
      state,
      loading: false,
      error: '',
      refresh,
      updateTask,
      openStep,
    }),
    [state, refresh, updateTask, openStep],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

function ApiOnboardingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { get, patch, orgId } = useApi();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!orgId) return;

    setLoading(true);
    setError('');
    try {
      let data: OnboardingState;
      try {
        data = await get<OnboardingState>('restaurant/onboarding');
      } catch (err: any) {
        if (
          !String(err.message || '')
            .toLowerCase()
            .includes('not found')
        )
          throw err;
        await fetch('/api/auth/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        data = await get<OnboardingState>('restaurant/onboarding');
      }
      setState(data);
    } catch (err: any) {
      setError(err.message || 'Impossible de charger la mise en service');
    } finally {
      setLoading(false);
    }
  }, [get, orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const updateTask = useCallback(
    async (
      action: OnboardingAction,
      task?: OnboardingTaskKey,
      options?: { reason?: string; metadata?: Record<string, unknown> },
    ) => {
      if (!orgId) return null;

      setError('');
      try {
        const data = await patch<OnboardingState>('restaurant/onboarding', {
          action,
          task,
          ...options,
        });
        setState(data);
        return data;
      } catch (err: any) {
        setError(err.message || 'Impossible de mettre à jour la mise en service');
        return null;
      }
    },
    [orgId, patch],
  );

  const openStep = useCallback(
    async (task: OnboardingTaskKey) => {
      await updateTask('start', task);
      router.push(`/onboarding/${task}`);
    },
    [router, updateTask],
  );

  const value = useMemo(
    () => ({ state, loading, error, refresh, updateTask, openStep }),
    [state, loading, error, refresh, updateTask, openStep],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error('useOnboarding must be used inside OnboardingProvider');
  }
  return ctx;
}
