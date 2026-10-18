'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { useApi } from '@/lib/api';
import { getErrorMessage } from '@/types/api';
import type {
  OnboardingAction,
  OnboardingRestaurant,
  OnboardingState,
  OnboardingStatus,
  OnboardingStep,
  OnboardingTaskKey,
  OnboardingTaskState,
} from './types';
import type { DayHours } from './hours';
import { getVisibleOnboardingState, resolveOnboardingTask } from './types';
import { usePlaceImportDraft } from './use-place-import-draft';

export type IdentityDraft = {
  restaurantId: string;
  slug: string;
  description: string;
  coverImageUrl: string;
  pageFields?: Pick<
    OnboardingRestaurant,
    | 'formattedAddress'
    | 'postalCode'
    | 'city'
    | 'country'
    | 'lat'
    | 'lng'
    | 'cuisineType'
    | 'priceRange'
    | 'dietary'
    | 'ambiance'
  >;
};

export type PlaceImportDraft = {
  placeId: string;
  name: string;
  /** Nom commercial déduit côté API (sans ville ni quartier) ; absent sur d'anciens brouillons. */
  displayName?: string;
  phoneE164: string;
  formattedAddress: string;
  postalCode: string;
  city: string;
  country: string;
  lat?: number;
  lng?: number;
  openingHours: Record<string, DayHours>;
  hoursNeedReview: string[];
};

type OnboardingContextValue = {
  setRestaurantDraft: (fields: Partial<OnboardingRestaurant>) => void;
  identityDraft: IdentityDraft | null;
  setIdentityDraft: (draft: IdentityDraft | null) => void;
  placeImportDraft: PlaceImportDraft | null;
  setPlaceImportDraft: (draft: PlaceImportDraft | null) => void;
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
  // In-dashboard modal flow
  activeStep: OnboardingTaskKey | null;
  openStepModal: (task: OnboardingTaskKey) => void;
  closeStepModal: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);
const hasClerkKey = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function previewStep(
  key: OnboardingTaskKey,
  title: string,
  description: string,
  group: 'voice' | 'connect',
  index: number,
  status: OnboardingStatus,
  required = false,
): OnboardingStep {
  const state: OnboardingTaskState =
    status === 'blocked'
      ? { status, reason: 'Aperçu : Google OAuth demande une configuration Clerk/API.' }
      : { status };
  return { key, title, description, required, group, index, status, state };
}

const PREVIEW_STATE: OnboardingState = {
  onboardingDone: false,
  voiceOnboardingDone: false,
  connectOnboardingDone: false,
  minimumViableDone: false,
  onboardingCompletedAt: null,
  onboardingActivatedAt: null,
  onboardingLastSeenAt: new Date().toISOString(),
  firstCallAt: null,
  completedCount: 0,
  totalCount: 9,
  progress: 0,
  voiceProgress: 0,
  connectProgress: 0,
  currentStep: {
    key: 'restaurant',
    title: 'Commençons par votre restaurant',
    description: 'Nom et coordonnées de contact du restaurant.',
    required: true,
    group: 'voice',
    index: 1,
    status: 'current',
    state: { status: 'current' },
  },
  steps: [
    // Socle commun + assistant vocal
    previewStep(
      'restaurant',
      'Commençons par votre restaurant',
      'Nom et coordonnées de contact du restaurant.',
      'voice',
      1,
      'current',
      true,
    ),
    previewStep(
      'hours',
      'Horaires de réservation',
      'Jours et plages où le restaurant accepte les réservations.',
      'voice',
      2,
      'pending',
    ),
    previewStep(
      'floor',
      'Salle et règles',
      'Vos tables, vos règles de réservation et les informations pratiques que vos clients demandent.',
      'voice',
      3,
      'pending',
    ),
    previewStep(
      'knowledge',
      'Consignes & démo',
      'Ton, ambiance et consignes commerciales.',
      'voice',
      4,
      'pending',
    ),
    previewStep(
      'phone',
      'Mise en service des appels',
      'Numéro Sokar et consignes de renvoi opérateur.',
      'voice',
      5,
      'pending',
    ),
    // Sokar Connect group
    previewStep(
      'connect-identity',
      'Identité publique',
      'Slug, description et photo de couverture.',
      'connect',
      1,
      'pending',
    ),
    previewStep(
      'connect-location',
      'Localisation',
      'Adresse, coordonnées et carte.',
      'connect',
      2,
      'pending',
    ),
    previewStep(
      'connect-cuisine',
      'Cuisine & ambiance',
      'Type de cuisine, tarifs et spécificités.',
      'connect',
      3,
      'pending',
    ),
    previewStep(
      'connect-activation',
      'Activation & preview',
      'Mise en ligne de la page et des métadonnées.',
      'connect',
      4,
      'pending',
    ),
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
    name: '',
    managerPhone: '',
    managerEmail: '',
    phoneE164: null,
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

  const voiceSteps = steps.filter((s) => s.group === 'voice');
  const voiceCompleted = voiceSteps.filter((s) => s.status === 'completed').length;
  const voiceOnboardingDone = voiceCompleted === voiceSteps.length;
  const voiceProgress = Math.round((voiceCompleted / voiceSteps.length) * 100);

  const connectSteps = steps.filter((s) => s.group === 'connect');
  const connectCompleted = connectSteps.filter((s) => s.status === 'completed').length;
  const connectOnboardingDone = connectCompleted === connectSteps.length;
  const connectProgress = Math.round((connectCompleted / connectSteps.length) * 100);

  const completedCount = steps.filter((step) => step.status === 'completed').length;
  const currentStep =
    steps.find((step) => step.status === 'current') ??
    steps.find((step) => step.status === 'blocked') ??
    steps.find((step) => step.status !== 'completed') ??
    steps[steps.length - 1];

  const minimumViableDone = ['restaurant', 'hours', 'floor'].every(
    (key) => steps.find((s) => s.key === key)?.status === 'completed',
  );

  return {
    ...current,
    steps,
    currentStep,
    completedCount,
    progress: Math.round((completedCount / steps.length) * 100),
    onboardingDone: voiceOnboardingDone,
    voiceOnboardingDone,
    connectOnboardingDone,
    voiceProgress,
    connectProgress,
    minimumViableDone,
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
  const [state, setState] = useState<OnboardingState | null>(
    getVisibleOnboardingState(PREVIEW_STATE),
  );
  const previewState = useRef(getVisibleOnboardingState(PREVIEW_STATE));
  const [identityDraft, setIdentityDraft] = useState<IdentityDraft | null>(null);
  const [placeImportDraft, setPlaceImportDraft] = usePlaceImportDraft('preview');
  const [activeStep, setActiveStep] = useState<OnboardingTaskKey | null>(null);

  const refresh = useCallback(async () => {
    setState((current) => current ?? PREVIEW_STATE);
  }, []);

  const updateTask = useCallback(async (action: OnboardingAction, task?: OnboardingTaskKey) => {
    const nextState = updatePreviewStep(previewState.current, action, task);
    previewState.current = nextState;
    setState(nextState);
    return nextState;
  }, []);

  const openStep = useCallback(
    async (task: OnboardingTaskKey) => {
      const target = resolveOnboardingTask(task) ?? task;
      await updateTask('start', target);
      router.push(`/onboarding/${target}`);
    },
    [router, updateTask],
  );

  const openStepModal = useCallback((task: OnboardingTaskKey) => {
    setActiveStep(resolveOnboardingTask(task) ?? task);
  }, []);

  const setRestaurantDraft = useCallback((fields: Partial<OnboardingRestaurant>) => {
    const next = {
      ...previewState.current,
      restaurant: { ...previewState.current.restaurant, ...fields },
    };
    previewState.current = next;
    setState(next);
  }, []);
  const closeStepModal = useCallback(() => {
    setActiveStep(null);
  }, []);

  const value = useMemo(
    () => ({
      state,
      loading: false,
      error: '',
      refresh,
      updateTask,
      openStep,
      activeStep,
      openStepModal,
      closeStepModal,
      identityDraft,
      setIdentityDraft,
      setRestaurantDraft,
      placeImportDraft,
      setPlaceImportDraft,
    }),
    [
      state,
      refresh,
      updateTask,
      openStep,
      activeStep,
      openStepModal,
      closeStepModal,
      identityDraft,
      setRestaurantDraft,
      placeImportDraft,
      setPlaceImportDraft,
    ],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

function ApiOnboardingProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { get, patch, orgId } = useApi();
  const [state, setState] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [identityDraft, setIdentityDraft] = useState<IdentityDraft | null>(null);
  const [placeImportDraft, setPlaceImportDraft] = usePlaceImportDraft(orgId);
  const [activeStep, setActiveStep] = useState<OnboardingTaskKey | null>(null);

  const refresh = useCallback(async () => {
    if (!orgId) return;

    setLoading(true);
    setState(null);
    setError('');
    try {
      // Fire-and-forget : sync l'org Clerk en parallèle du fetch onboarding.
      // Avant, le sync n'était appelé qu'en cas de 404 (waterfall de 3 calls
      // séquentiels). Maintenant les 2 calls partent en même temps.
      const syncPromise = fetch('/api/auth/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }).catch(() => null); // sync est idempotent, erreur non bloquante

      let data: OnboardingState;
      try {
        data = await get<OnboardingState>('restaurant/onboarding');
      } catch (err: unknown) {
        if (!getErrorMessage(err, '').toLowerCase().includes('not found')) throw err;
        // 404 : attendre le sync puis retry une seule fois
        await syncPromise;
        data = await get<OnboardingState>('restaurant/onboarding');
      }
      setState(getVisibleOnboardingState(data));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Impossible de charger la mise en service'));
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
        const visible = getVisibleOnboardingState(data);
        setState(visible);
        return visible;
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Impossible de mettre à jour la mise en service'));
        return null;
      }
    },
    [orgId, patch],
  );

  const openStep = useCallback(
    async (task: OnboardingTaskKey) => {
      const target = resolveOnboardingTask(task) ?? task;
      await updateTask('start', target);
      router.push(`/onboarding/${target}`);
    },
    [router, updateTask],
  );

  const openStepModal = useCallback((task: OnboardingTaskKey) => {
    setActiveStep(resolveOnboardingTask(task) ?? task);
  }, []);

  const setRestaurantDraft = useCallback((fields: Partial<OnboardingRestaurant>) => {
    setState((current) =>
      current ? { ...current, restaurant: { ...current.restaurant, ...fields } } : current,
    );
  }, []);
  const closeStepModal = useCallback(() => {
    setActiveStep(null);
  }, []);

  const value = useMemo(
    () => ({
      state,
      loading,
      error,
      refresh,
      updateTask,
      openStep,
      activeStep,
      openStepModal,
      closeStepModal,
      identityDraft,
      setIdentityDraft,
      setRestaurantDraft,
      placeImportDraft,
      setPlaceImportDraft,
    }),
    [
      state,
      loading,
      error,
      refresh,
      updateTask,
      openStep,
      activeStep,
      openStepModal,
      closeStepModal,
      identityDraft,
      setRestaurantDraft,
      placeImportDraft,
      setPlaceImportDraft,
    ],
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
