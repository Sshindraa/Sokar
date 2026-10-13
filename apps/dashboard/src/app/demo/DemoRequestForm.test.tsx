import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DemoRequestForm from './DemoRequestForm';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText('Nom de votre établissement'), {
    target: { value: 'Le Bistrot du Coin' },
  });
  fireEvent.change(screen.getByLabelText('Adresse e-mail professionnelle'), {
    target: { value: 'contact@bistrot.example' },
  });
}

function submitButton() {
  return screen.getByRole('button', { name: 'Demander une démonstration' });
}

function sentBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
}

describe('DemoRequestForm', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("demande seulement l'établissement et un e-mail, sans compte, et renvoie vers la politique de confidentialité", () => {
    render(<DemoRequestForm />);

    expect(screen.getByLabelText('Nom de votre établissement')).toBeRequired();
    expect(screen.getByLabelText('Adresse e-mail professionnelle')).toBeRequired();
    expect(screen.getByLabelText('Téléphone (facultatif)')).not.toBeRequired();
    expect(screen.getByRole('link', { name: 'Créer votre compte' })).toHaveAttribute(
      'href',
      '/register',
    );
    expect(screen.getByRole('link', { name: 'politique de confidentialité' })).toHaveAttribute(
      'href',
      '/privacy',
    );
  });

  it('envoie la demande et garde la confirmation affichée', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { id: 'dr_1', status: 'NEW' } }, 201));
    render(<DemoRequestForm />);
    fillRequiredFields();

    fireEvent.click(submitButton());

    expect(await screen.findByText('Demande bien enregistrée')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/proxy/public/demo-requests');
    expect(sentBodies()[0]).toEqual(
      expect.objectContaining({
        establishmentName: 'Le Bistrot du Coin',
        contactEmail: 'contact@bistrot.example',
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
  });

  it('ignore un second clic pendant l’envoi pour ne créer qu’une seule demande', async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));
    render(<DemoRequestForm />);
    fillRequiredFields();

    const button = submitButton();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it('propose de réessayer après une erreur réseau avec la même clé d’idempotence', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ data: { id: 'dr_1', status: 'NEW' } }, 201));
    render(<DemoRequestForm />);
    fillRequiredFields();

    fireEvent.click(submitButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Votre demande n’a pas pu être enregistrée',
    );

    fireEvent.click(submitButton());
    expect(await screen.findByText('Demande bien enregistrée')).toBeInTheDocument();

    const [first, second] = sentBodies();
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('signale les informations refusées par le serveur sans afficher de confirmation', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: 'VALIDATION_ERROR', fields: ['contactEmail'] }, 400),
    );
    render(<DemoRequestForm />);
    fillRequiredFields();

    fireEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent('Vérifiez les informations saisies');
    expect(screen.queryByText('Demande bien enregistrée')).not.toBeInTheDocument();
  });
});
