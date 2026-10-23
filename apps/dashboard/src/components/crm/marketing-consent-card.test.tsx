import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
import { MarketingConsentCard } from './marketing-consent-card';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  orgId: 'org_test_123' as string | undefined,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({
    get: apiMocks.get,
    post: apiMocks.post,
    del: apiMocks.del,
    orgId: apiMocks.orgId,
  }),
}));

const PERMISSIONS_PATH = 'crm/customers/customer-1/marketing-permissions';

const granted = {
  channel: 'EMAIL',
  status: 'OPTED_IN',
  source: 'CONNECT',
  consentedAt: '2026-10-20T10:00:00.000Z',
  withdrawnAt: null,
};
const withdrawn = {
  channel: 'SMS',
  status: 'OPTED_OUT',
  source: 'UNSUBSCRIBE_LINK',
  consentedAt: null,
  withdrawnAt: '2026-10-21T10:00:00.000Z',
};

function rowFor(label: 'E-mail' | 'SMS') {
  return screen.getByText(label, { selector: 'p' }).closest('li') as HTMLElement;
}

describe('MarketingConsentCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockResolvedValue({ data: [] });
    apiMocks.post.mockResolvedValue({ data: {} });
    apiMocks.del.mockResolvedValue({ data: {} });
  });

  it('shows a loading state, then "jamais demandé" for each channel when nothing is stored', async () => {
    render(<MarketingConsentCard customerId="customer-1" email="alice@example.com" />);
    expect(screen.getByRole('status', { name: /chargement/i })).toBeInTheDocument();

    expect(await screen.findAllByText('Jamais demandé')).toHaveLength(2);
    expect(apiMocks.get).toHaveBeenCalledWith(PERMISSIONS_PATH);
    expect(screen.getAllByRole('button', { name: 'Enregistrer un accord' })).toHaveLength(2);
  });

  it('shows the state, date and source of each channel', async () => {
    apiMocks.get.mockResolvedValue({ data: [granted, withdrawn] });
    render(<MarketingConsentCard customerId="customer-1" email="alice@example.com" />);

    const email = within(await waitFor(() => rowFor('E-mail')));
    expect(email.getByText('Accord donné')).toBeInTheDocument();
    expect(
      email.getByText(/Donné le 20 octobre 2026 · Page de réservation Sokar Connect/),
    ).toBeInTheDocument();
    const sms = within(rowFor('SMS'));
    expect(sms.getByText('Accord retiré')).toBeInTheDocument();
    expect(sms.getByText(/Retiré le 21 octobre 2026 · Lien de désinscription/)).toBeInTheDocument();
  });

  it('shows an error with a retry and recovers', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(500, { error: 'boom' }));
    render(<MarketingConsentCard customerId="customer-1" email="alice@example.com" />);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(await screen.findAllByText('Jamais demandé')).toHaveLength(2);
  });

  it('records an oral agreement only after the team confirmed it, with the chosen method', async () => {
    render(<MarketingConsentCard customerId="customer-1" email="alice@example.com" />);
    await screen.findAllByText('Jamais demandé');

    fireEvent.click(
      within(rowFor('E-mail')).getByRole('button', { name: 'Enregistrer un accord' }),
    );
    const submit = screen.getByRole('button', { name: 'Enregistrer l’accord' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('checkbox')).not.toBeChecked();

    fireEvent.change(screen.getByLabelText(/comment l’accord a-t-il été recueilli/i), {
      target: { value: 'PHONE' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    apiMocks.get.mockResolvedValue({ data: [granted] });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(`${PERMISSIONS_PATH}/EMAIL/consent`, {
        method: 'PHONE',
      }),
    );
    expect(await screen.findByText('Accord enregistré.')).toBeInTheDocument();
    expect(within(rowFor('E-mail')).getByText('Accord donné')).toBeInTheDocument();
  });

  it('blocks the e-mail agreement when the customer has no address', async () => {
    render(<MarketingConsentCard customerId="customer-1" email={null} />);
    await screen.findAllByText('Jamais demandé');

    const email = within(rowFor('E-mail'));
    expect(email.getByText(/aucune adresse e-mail sur cette fiche/i)).toBeInTheDocument();
    expect(email.getByRole('button', { name: 'Enregistrer un accord' })).toBeDisabled();
    expect(
      within(rowFor('SMS')).getByRole('button', { name: 'Enregistrer un accord' }),
    ).toBeEnabled();
  });

  it('shows the server refusal when recording fails', async () => {
    apiMocks.post.mockRejectedValue(toApiError(409, { error: 'CUSTOMER_EMAIL_REQUIRED' }));
    render(<MarketingConsentCard customerId="customer-1" email="alice@example.com" />);
    await screen.findAllByText('Jamais demandé');

    fireEvent.click(
      within(rowFor('E-mail')).getByRole('button', { name: 'Enregistrer un accord' }),
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’accord' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /ajoutez d’abord une adresse e-mail/i,
    );
  });

  it('withdraws a granted agreement only after a second confirmation', async () => {
    apiMocks.get.mockResolvedValue({ data: [granted] });
    render(<MarketingConsentCard customerId="customer-1" email="alice@example.com" />);
    await screen.findByText('Accord donné');

    fireEvent.click(screen.getByRole('button', { name: 'Retirer l’accord' }));
    expect(apiMocks.del).not.toHaveBeenCalled();
    expect(
      screen.getByText(/ne recevra plus de messages marketing par e-mail/i),
    ).toBeInTheDocument();

    apiMocks.get.mockResolvedValue({
      data: [
        {
          ...granted,
          status: 'OPTED_OUT',
          withdrawnAt: '2026-10-22T10:00:00.000Z',
          source: 'DASHBOARD_WITHDRAWAL',
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));

    await waitFor(() => expect(apiMocks.del).toHaveBeenCalledWith(`${PERMISSIONS_PATH}/EMAIL`));
    expect(
      await screen.findByText(/Retiré le 22 octobre 2026 · Retiré par le restaurant/),
    ).toBeInTheDocument();
  });

  it('never uses informal « tu » wording', async () => {
    apiMocks.get.mockResolvedValue({ data: [granted] });
    const { container } = render(
      <MarketingConsentCard customerId="customer-1" email="alice@example.com" />,
    );
    await screen.findByText('Accord donné');
    fireEvent.click(screen.getAllByRole('button', { name: 'Enregistrer un accord' })[0]);
    expect(container.textContent).not.toMatch(/\b(tu|ton|ta|tes|toi)\b/i);
  });
});
