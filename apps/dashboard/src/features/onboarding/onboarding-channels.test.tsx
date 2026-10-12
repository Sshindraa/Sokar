import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { OnboardingChannels } from './onboarding-channels';
import type { OnboardingStep, OnboardingTaskKey } from './types';

const KEYS: OnboardingTaskKey[] = [
  'restaurant',
  'hours',
  'floor',
  'knowledge',
  'phone',
  'connect-identity',
  'connect-activation',
];

function steps(completed: OnboardingTaskKey[]): OnboardingStep[] {
  return KEYS.map((key, index) => {
    const status = completed.includes(key) ? 'completed' : 'pending';
    return {
      key,
      title: key,
      description: '',
      required: false,
      group: key.startsWith('connect') ? 'connect' : 'voice',
      index,
      status,
      state: { status },
    } as OnboardingStep;
  });
}

const SOCLE: OnboardingTaskKey[] = ['restaurant', 'hours', 'floor'];

it('signale le numéro Sokar en attente sans bloquer la configuration du téléphone', () => {
  const onOpen = vi.fn();
  render(<OnboardingChannels steps={steps(SOCLE)} phoneAssigned={false} onOpen={onOpen} />);
  expect(screen.getByText('Numéro Sokar en cours d’attribution')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'votre espace s’ouvrira une fois ce numéro attribué et vos deux canaux prêts',
  );
  const configure = screen.getByRole('button', { name: 'Configurer : Téléphone' });
  expect(configure).toBeEnabled();
  fireEvent.click(configure);
  expect(onOpen).toHaveBeenCalledWith('knowledge');
});

it('garde l’attente affichée quand les consignes sont faites mais pas l’appel', () => {
  render(
    <OnboardingChannels
      steps={steps([...SOCLE, 'knowledge'])}
      phoneAssigned={false}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText('Numéro Sokar en cours d’attribution')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reprendre : Téléphone' })).toBeEnabled();
});

it('n’affiche aucune attente quand le numéro est attribué', () => {
  render(<OnboardingChannels steps={steps(SOCLE)} phoneAssigned onOpen={vi.fn()} />);
  expect(screen.queryByText('Numéro Sokar en cours d’attribution')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Activez vos deux canaux, dans l’ordre de votre choix, pour ouvrir votre espace.',
  );
});

it('affiche le téléphone prêt une fois l’étape Appels terminée', () => {
  render(
    <OnboardingChannels
      steps={steps([...SOCLE, 'knowledge', 'phone'])}
      phoneAssigned={false}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.queryByText('Numéro Sokar en cours d’attribution')).not.toBeInTheDocument();
  expect(screen.getByText('Prêt')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Encore un canal à activer pour ouvrir votre espace.',
  );
});
