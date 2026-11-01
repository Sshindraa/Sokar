import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/fr.json';
import { ServiceFillReport } from './ServiceFillReport';

function renderReport(conclusive: boolean) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ServiceFillReport
        fill={{
          treated: { customers: 40, covers: 60, coversPerCustomer: 1.5 },
          holdout: { customers: conclusive ? 25 : 8, covers: 8, coversPerCustomer: 1 },
          difference: 0.5,
          conclusive,
        }}
      />
    </NextIntlClientProvider>,
  );
}

describe('ServiceFillReport', () => {
  it('compare destinataires et témoin par client', () => {
    renderReport(true);

    expect(screen.getByText('Service visé')).toBeInTheDocument();
    expect(screen.getByText('Destinataires (40)')).toBeInTheDocument();
    expect(screen.getByText('Témoin (25)')).toBeInTheDocument();
    expect(screen.getByText('+0.50')).toBeInTheDocument();
    expect(screen.queryByText(/Non concluant/)).not.toBeInTheDocument();
  });

  it('signale « non concluant » sous 20 clients témoins', () => {
    renderReport(false);

    expect(
      screen.getByText('Non concluant : moins de 20 clients dans le témoin.'),
    ).toBeInTheDocument();
  });
});
