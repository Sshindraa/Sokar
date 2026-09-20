import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoyaltyPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    get: apiMocks.get,
    post: apiMocks.post,
    patch: apiMocks.patch,
  }),
}));

const benefit = {
  id: 'benefit-1',
  key: 'birthday-dessert',
  name: 'Dessert anniversaire',
  description: 'À servir avec le café.',
  rule: 'BIRTHDAY_MONTH',
  ruleValue: null,
  costCents: 500,
  currency: 'EUR',
  validityDays: 30,
  maxUsesPerCustomer: 1,
  status: 'ACTIVE',
  grantCount: 1,
};

const grant = {
  id: 'grant-1',
  benefitId: 'benefit-1',
  customerId: 'customer-1',
  reservationId: null,
  status: 'ISSUED',
  issuedAt: '2026-09-14T10:00:00.000Z',
  expiresAt: '2026-10-14T10:00:00.000Z',
  redeemedAt: null,
  voidedAt: null,
  redemptionNote: null,
  benefit: {
    key: 'birthday-dessert',
    name: 'Dessert anniversaire',
    costCents: 500,
    currency: 'EUR',
  },
  customerName: 'Alice Martin',
  phoneLast4: '1234',
};

const customers = [
  {
    id: 'customer-1',
    name: 'Alice Martin',
    phone: '+33601021234',
    visitCount: 3,
    loyaltyScore: 7.5,
    isVip: false,
    notes: null,
    lastSeenAt: null,
  },
  {
    id: 'customer-2',
    name: 'Bob VIP',
    phone: '+33655667788',
    visitCount: 12,
    loyaltyScore: 9.5,
    isVip: true,
    notes: null,
    lastSeenAt: null,
  },
];

describe('LoyaltyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('loyalty/benefits')) return Promise.resolve({ data: [benefit] });
      if (path.startsWith('loyalty/grants')) return Promise.resolve({ data: [grant] });
      if (path.startsWith('customers')) return Promise.resolve({ data: customers, total: 2 });
      return Promise.resolve({ data: [] });
    });
    apiMocks.post.mockImplementation((path: string) => {
      if (path === 'loyalty/benefits') return Promise.resolve({ data: benefit });
      if (path === 'loyalty/grants') {
        return Promise.resolve({
          data: { ...grant, code: 'ABC123DEF456', replayed: false },
        });
      }
      if (path === 'loyalty/grants/grant-1/void') {
        return Promise.resolve({
          data: { ...grant, status: 'VOID', voidedAt: '2026-09-14T11:00:00.000Z' },
        });
      }
      return Promise.resolve({
        data: { ...grant, status: 'REDEEMED', redeemedAt: '2026-09-14T11:00:00.000Z' },
      });
    });
    apiMocks.patch.mockResolvedValue({ data: { ...benefit, status: 'INACTIVE' } });
  });

  it('charge les règles, les attributions, les clients et les métriques', async () => {
    render(<LoyaltyPage />);

    expect(await screen.findByRole('heading', { name: 'Attentions clients' })).toBeInTheDocument();
    expect(await screen.findAllByText(/Dessert anniversaire/)).not.toHaveLength(0);
    expect(await screen.findAllByText(/Alice Martin/)).not.toHaveLength(0);
    expect(screen.getByText('Attentions à utiliser')).toBeInTheDocument();
    expect(screen.getByText('Taux d’utilisation')).toBeInTheDocument();
    expect(screen.getAllByText('1').length).toBeGreaterThanOrEqual(1);
    expect(await screen.findAllByText(/5,00/)).not.toHaveLength(0);
  });

  it('crée une attention avec des libellés métier et des valeurs par défaut', async () => {
    render(<LoyaltyPage />);
    await screen.findByRole('heading', { name: 'Attentions clients' });

    fireEvent.change(screen.getByLabelText('Nom de l’attention'), {
      target: { value: 'Café VIP' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’attention' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('loyalty/benefits', {
        key: 'cafe-vip',
        name: 'Café VIP',
        description: null,
        rule: 'ANY',
        validityDays: 30,
        maxUsesPerCustomer: 1,
      }),
    );
    expect(
      await screen.findByText(
        'Attention enregistrée. Elle peut maintenant être attribuée à un client.',
      ),
    ).toBeInTheDocument();
  });

  it('convertit les montants en euros vers les centimes attendus par l’API', async () => {
    render(<LoyaltyPage />);
    await screen.findByRole('heading', { name: 'Attentions clients' });

    fireEvent.change(screen.getByLabelText('Nom de l’attention'), {
      target: { value: 'Menu fidélité' },
    });
    fireEvent.change(screen.getByLabelText('Qui peut recevoir cette attention ?'), {
      target: { value: 'MIN_ESTIMATED_SPEND' },
    });
    fireEvent.change(screen.getByLabelText('Dépense cumulée minimale (€)'), {
      target: { value: '100,50' },
    });
    fireEvent.change(screen.getByLabelText('Coût unitaire estimé (€)'), {
      target: { value: '8,50' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’attention' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('loyalty/benefits', {
        key: 'menu-fidelite',
        name: 'Menu fidélité',
        description: null,
        rule: 'MIN_ESTIMATED_SPEND',
        ruleValue: 10050,
        costCents: 850,
        validityDays: 30,
        maxUsesPerCustomer: 1,
      }),
    );
  });

  it('attribue une attention à un client et affiche le code une seule fois', async () => {
    render(<LoyaltyPage />);
    await screen.findByRole('heading', { name: 'Attentions clients' });

    fireEvent.change(screen.getByLabelText('Client destinataire'), {
      target: { value: 'customer-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Attribuer l’attention' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        'loyalty/grants',
        { benefitId: 'benefit-1', customerId: 'customer-2' },
        { headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) },
      ),
    );
    expect(await screen.findByText('Code à remettre au client')).toBeInTheDocument();
    expect(screen.getByText('ABC123DEF456')).toBeInTheDocument();
  });

  it('valide une attention avec son attribution et son code', async () => {
    render(<LoyaltyPage />);
    await screen.findByRole('heading', { name: 'Attentions clients' });

    fireEvent.change(screen.getByLabelText('Attention à valider'), {
      target: { value: 'grant-1' },
    });
    fireEvent.change(screen.getByLabelText('Code de validation'), {
      target: { value: 'abc123def456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Valider l’attention' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('loyalty/grants/grant-1/redeem', {
        code: 'ABC123DEF456',
      }),
    );
    expect(
      await screen.findByText(
        'Attention validée. Elle est maintenant comptabilisée comme utilisée.',
      ),
    ).toBeInTheDocument();
  });

  it('permet d’annuler une attribution en attente avec confirmation', async () => {
    render(<LoyaltyPage />);
    await screen.findByRole('heading', { name: 'Attentions clients' });

    fireEvent.click(screen.getByRole('button', { name: 'Annuler l’attribution' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/ne pourra plus être validée/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler l’attribution' }));

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('loyalty/grants/grant-1/void', {}),
    );
    expect(
      await screen.findByText('Attribution annulée. Elle ne peut plus être validée en salle.'),
    ).toBeInTheDocument();
  });

  it('explique le verrouillage avec un message compréhensible', async () => {
    apiMocks.get.mockRejectedValue(new Error('LOYALTY_DISABLED'));
    render(<LoyaltyPage />);

    expect(await screen.findByText('Le module est momentanément verrouillé')).toBeInTheDocument();
    expect(
      screen.getByText(/aucune donnée ne sera créée tant qu’il reste verrouillé/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer l’attention' })).toBeDisabled();
  });

  it('propose clairement de passer à Pro quand la fidélité est hors formule', async () => {
    apiMocks.get.mockRejectedValue(new Error('CAPABILITY_NOT_INCLUDED'));
    render(<LoyaltyPage />);

    expect(await screen.findByRole('link', { name: 'Passer à Pro' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(screen.getByRole('button', { name: 'Vérifier mon accès' })).toBeInTheDocument();
  });
});
