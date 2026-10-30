import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TeamCard } from './team-card';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  refresh: vi.fn(),
  role: 'OWNER' as string | undefined,
  status: 'ready' as 'idle' | 'ready',
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: mocks.get, post: mocks.post, patch: mocks.patch, del: mocks.del }),
}));
vi.mock('@/features/sites/site-context', () => ({
  useSiteSelection: () => ({
    status: mocks.status,
    refresh: mocks.refresh,
    activeSite: mocks.role ? { id: 'site-1', role: mocks.role } : undefined,
  }),
}));

const TEAM = {
  members: [
    {
      userId: 'u-owner',
      name: 'Camille Martin',
      email: 'camille@example.com',
      role: 'OWNER',
      isYou: true,
    },
    {
      userId: 'u-staff',
      name: 'Léo Serveur',
      email: 'leo@example.com',
      role: 'STAFF',
      isYou: false,
    },
  ],
  invitations: [
    {
      id: 'inv_1',
      email: 'nouveau@example.com',
      role: 'READ_ONLY',
      createdAt: '2026-10-12T08:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'OWNER';
  mocks.status = 'ready';
  mocks.get.mockResolvedValue(TEAM);
  mocks.post.mockResolvedValue({});
  mocks.patch.mockResolvedValue({});
  mocks.del.mockResolvedValue({});
});

it('liste les membres et les invitations en attente', async () => {
  render(<TeamCard />);

  const members = await screen.findByRole('region', { name: 'Membres' });
  expect(within(members).getByText('Camille Martin')).toBeInTheDocument();
  expect(within(members).getByText('(vous)')).toBeInTheDocument();
  expect(within(members).getByText('Léo Serveur')).toBeInTheDocument();
  const pending = screen.getByRole('region', { name: 'Invitations en attente' });
  expect(within(pending).getByText('nouveau@example.com')).toBeInTheDocument();
  expect(within(pending).getByText('Lecture seule')).toBeInTheDocument();
});

it('ne laisse modifier ni soi-même ni le propriétaire', async () => {
  render(<TeamCard />);
  await screen.findByText('Léo Serveur');

  expect(screen.queryByLabelText('Rôle de Camille Martin')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Rôle de Léo Serveur')).toHaveValue('STAFF');
  expect(screen.getAllByRole('button', { name: 'Retirer' })).toHaveLength(1);
  // Le rôle propriétaire n'est proposé nulle part.
  expect(screen.queryByRole('option', { name: 'Propriétaire' })).not.toBeInTheDocument();
});

it('invite avec le rôle choisi puis recharge l’équipe', async () => {
  render(<TeamCard />);
  await screen.findByText('Léo Serveur');

  fireEvent.change(screen.getByLabelText('Adresse e-mail à inviter'), {
    target: { value: 'marie@example.com' },
  });
  fireEvent.change(screen.getByLabelText('Rôle de la personne invitée'), {
    target: { value: 'MANAGER' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer l’invitation' }));

  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('team/invitations', {
      email: 'marie@example.com',
      role: 'MANAGER',
    }),
  );
  expect(await screen.findByText('Invitation envoyée à marie@example.com.')).toBeInTheDocument();
  expect(mocks.get).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText('Adresse e-mail à inviter')).toHaveValue('');
});

it('affiche le refus du serveur sans effacer l’adresse saisie', async () => {
  mocks.post.mockRejectedValue(new Error('Une invitation est déjà en attente pour cette adresse.'));
  render(<TeamCard />);
  await screen.findByText('Léo Serveur');

  fireEvent.change(screen.getByLabelText('Adresse e-mail à inviter'), {
    target: { value: 'marie@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Envoyer l’invitation' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('déjà en attente');
  expect(screen.getByLabelText('Adresse e-mail à inviter')).toHaveValue('marie@example.com');
});

it('change le rôle d’un membre', async () => {
  render(<TeamCard />);
  await screen.findByText('Léo Serveur');

  fireEvent.change(screen.getByLabelText('Rôle de Léo Serveur'), { target: { value: 'MANAGER' } });

  await waitFor(() =>
    expect(mocks.patch).toHaveBeenCalledWith('team/members/u-staff', { role: 'MANAGER' }),
  );
  expect(await screen.findByText('Le rôle de Léo Serveur a été modifié.')).toBeInTheDocument();
});

it('demande une confirmation avant de retirer un membre', async () => {
  render(<TeamCard />);
  await screen.findByText('Léo Serveur');

  fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
  expect(mocks.del).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));

  await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('team/members/u-staff'));
  expect(
    await screen.findByText('Léo Serveur ne fait plus partie de l’équipe.'),
  ).toBeInTheDocument();
});

it('propose de transmettre la propriété et de choisir son propre accès', async () => {
  render(<TeamCard />);
  await screen.findByText('Léo Serveur');
  fireEvent.click(screen.getByRole('button', { name: 'Transférer la propriété' }));
  expect(mocks.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Votre accès après transfert'), {
    target: { value: 'READ_ONLY' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmer le transfert à Léo Serveur' }));
  await waitFor(() =>
    expect(mocks.post).toHaveBeenCalledWith('team/transfer-ownership', {
      targetUserId: 'u-staff',
      previousOwnerAccess: 'READ_ONLY',
    }),
  );
  expect(mocks.refresh).toHaveBeenCalled();
});

it('annule une invitation en attente', async () => {
  render(<TeamCard />);
  await screen.findByText('nouveau@example.com');

  fireEvent.click(screen.getByRole('button', { name: 'Annuler l’invitation' }));

  await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('team/invitations/inv_1'));
});

it('gère le chargement et l’erreur de chargement avec un bouton Réessayer', async () => {
  mocks.get.mockRejectedValueOnce(new Error('Le service de connexion est indisponible.'));
  render(<TeamCard />);

  expect(await screen.findByRole('alert')).toHaveTextContent('indisponible');
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

  expect(await screen.findByText('Léo Serveur')).toBeInTheDocument();
});

it.each(['MANAGER', 'STAFF', 'READ_ONLY', undefined])(
  'reste invisible, sans appel, pour le rôle %s',
  (role) => {
    mocks.role = role;
    const { container } = render(<TeamCard />);

    expect(container).toBeEmptyDOMElement();
    expect(mocks.get).not.toHaveBeenCalled();
  },
);
