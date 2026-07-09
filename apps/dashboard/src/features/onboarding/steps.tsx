'use client';

/**
 * Barrel file — re-exporte tous les steps d'onboarding.
 *
 * Chaque step vit dans son propre fichier sous `./steps/`.
 * Ce fichier maintient le registry (STEP_COMPONENTS, STEP_KEYS, STEP_META)
 * consommé par onboarding-modal.tsx et onboarding-nav-footer.tsx.
 */

import type { OnboardingTaskKey, StepProps } from './types';

// ─── VOICE STEPS ──────────────────────────────────────────────
export { RestaurantStep } from './steps/RestaurantStep';
export { HoursStep } from './steps/HoursStep';
export { KnowledgeStep } from './steps/KnowledgeStep';
export { CalendarStep } from './steps/CalendarStep';
export { PhoneStep } from './steps/PhoneStep';

// ─── CONNECT STEPS ────────────────────────────────────────────
export { ConnectIdentityStep } from './steps/ConnectIdentityStep';
export { ConnectLocationStep } from './steps/ConnectLocationStep';
export { ConnectCuisineStep } from './steps/ConnectCuisineStep';
export { ConnectCapacityStep } from './steps/ConnectCapacityStep';
export { ConnectActivationStep } from './steps/ConnectActivationStep';

// Re-export StepProps for backwards compatibility
export type { StepProps } from './types';

// ─── STEP REGISTRY ─────────────────────────────────────────────

import { RestaurantStep } from './steps/RestaurantStep';
import { HoursStep } from './steps/HoursStep';
import { KnowledgeStep } from './steps/KnowledgeStep';
import { CalendarStep } from './steps/CalendarStep';
import { PhoneStep } from './steps/PhoneStep';
import { ConnectIdentityStep } from './steps/ConnectIdentityStep';
import { ConnectLocationStep } from './steps/ConnectLocationStep';
import { ConnectCuisineStep } from './steps/ConnectCuisineStep';
import { ConnectCapacityStep } from './steps/ConnectCapacityStep';
import { ConnectActivationStep } from './steps/ConnectActivationStep';

export const STEP_COMPONENTS: Record<OnboardingTaskKey, (props: StepProps) => React.JSX.Element> = {
  restaurant: RestaurantStep,
  hours: HoursStep,
  knowledge: KnowledgeStep,
  calendar: CalendarStep,
  phone: PhoneStep,
  'connect-identity': ConnectIdentityStep,
  'connect-location': ConnectLocationStep,
  'connect-cuisine': ConnectCuisineStep,
  'connect-capacity': ConnectCapacityStep,
  'connect-activation': ConnectActivationStep,
};

export const STEP_KEYS: OnboardingTaskKey[] = [
  'restaurant',
  'hours',
  'knowledge',
  'calendar',
  'phone',
  'connect-identity',
  'connect-location',
  'connect-cuisine',
  'connect-capacity',
  'connect-activation',
];

export const STEP_META: Record<
  OnboardingTaskKey,
  { title: string; group: 'voice' | 'connect'; index: number }
> = {
  restaurant: { title: 'Identité du restaurant', group: 'voice', index: 1 },
  hours: { title: 'Quand répondre et réserver', group: 'voice', index: 2 },
  knowledge: { title: "Ce que l'assistant doit savoir", group: 'voice', index: 3 },
  calendar: { title: 'Connexion au planning', group: 'voice', index: 4 },
  phone: { title: 'Mise en service des appels', group: 'voice', index: 5 },
  'connect-identity': { title: 'Identité publique', group: 'connect', index: 1 },
  'connect-location': { title: 'Localisation', group: 'connect', index: 2 },
  'connect-cuisine': { title: 'Cuisine & ambiance', group: 'connect', index: 3 },
  'connect-capacity': { title: 'Capacité & règles', group: 'connect', index: 4 },
  'connect-activation': { title: 'Activation & preview', group: 'connect', index: 5 },
};
