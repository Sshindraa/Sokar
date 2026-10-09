'use client';

/**
 * Barrel file — re-exporte tous les steps d'onboarding.
 *
 * Chaque step vit dans son propre fichier sous `./steps/`.
 * Ce fichier maintient le registry (STEP_COMPONENTS, STEP_KEYS, STEP_META)
 * consommé par onboarding-modal.tsx et onboarding-nav-footer.tsx.
 */

import { ONBOARDING_TASK_KEYS, type OnboardingTaskKey, type StepProps } from './types';

// ─── VOICE STEPS ──────────────────────────────────────────────
export { RestaurantStep } from './steps/RestaurantStep';
export { HoursStep } from './steps/HoursStep';
export { FloorStep } from './steps/FloorStep';
export { KnowledgeStep } from './steps/KnowledgeStep';
export { PhoneStep } from './steps/PhoneStep';

// ─── CONNECT STEPS ────────────────────────────────────────────
export { ConnectIdentityStep } from './steps/ConnectIdentityStep';
export { ConnectLocationStep } from './steps/ConnectLocationStep';
export { ConnectCuisineStep } from './steps/ConnectCuisineStep';
export { ConnectActivationStep } from './steps/ConnectActivationStep';

// Re-export StepProps for backwards compatibility
export type { StepProps } from './types';

// ─── STEP REGISTRY ─────────────────────────────────────────────

import { RestaurantStep } from './steps/RestaurantStep';
import { HoursStep } from './steps/HoursStep';
import { FloorStep } from './steps/FloorStep';
import { KnowledgeStep } from './steps/KnowledgeStep';
import { PhoneStep } from './steps/PhoneStep';
import { ConnectIdentityStep } from './steps/ConnectIdentityStep';
import { ConnectActivationStep } from './steps/ConnectActivationStep';

export const STEP_COMPONENTS: Record<OnboardingTaskKey, (props: StepProps) => React.JSX.Element> = {
  restaurant: RestaurantStep,
  hours: HoursStep,
  floor: FloorStep,
  knowledge: KnowledgeStep,
  phone: PhoneStep,
  // Anciennes URL : la page intermédiaire est remplacée par l’entrée Sokar Connect.
  channels: ConnectIdentityStep,
  'connect-identity': ConnectIdentityStep,
  'connect-location': ConnectIdentityStep,
  'connect-cuisine': ConnectIdentityStep,
  'connect-activation': ConnectActivationStep,
};

export { ONBOARDING_TASK_KEYS as STEP_KEYS } from './types';

export const STEP_META: Record<
  OnboardingTaskKey,
  { title: string; group: 'voice' | 'connect'; index: number }
> = {
  restaurant: { title: 'Commençons par votre restaurant', group: 'voice', index: 1 },
  hours: {
    title: 'Horaires de réservation',
    group: 'voice',
    index: 2,
  },
  floor: { title: 'Salle et règles', group: 'voice', index: 3 },
  knowledge: { title: 'Consignes & démo', group: 'voice', index: 4 },
  phone: { title: 'Mise en service des appels', group: 'voice', index: 5 },
  channels: { title: 'Identité publique', group: 'connect', index: 1 },
  'connect-identity': { title: 'Votre page', group: 'connect', index: 1 },
  'connect-location': { title: 'Localisation', group: 'connect', index: 2 },
  'connect-cuisine': { title: 'Cuisine & ambiance', group: 'connect', index: 3 },
  'connect-activation': { title: 'Publication', group: 'connect', index: 2 },
};

/** Nombre d'étapes de chaque groupe, pour les compteurs « n/N ». */
export const STEP_GROUP_SIZE: Record<'voice' | 'connect', number> = {
  voice: Object.entries(STEP_META).filter(
    ([key, meta]) =>
      ONBOARDING_TASK_KEYS.includes(key as OnboardingTaskKey) && meta.group === 'voice',
  ).length,
  connect: Object.entries(STEP_META).filter(
    ([key, meta]) =>
      ONBOARDING_TASK_KEYS.includes(key as OnboardingTaskKey) && meta.group === 'connect',
  ).length,
};
