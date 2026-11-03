import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import messages from '../../../../messages/fr.json';
import { ServiceFillReport, type ServiceFillReportData } from './ServiceFillReport';

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

const base: ServiceFillReportData = {
  treated: { customers: 40, covers: 60, coversPerCustomer: 1.5, reservedCustomers: 12 },
  holdout: { customers: 25, covers: 25, coversPerCustomer: 1, reservedCustomers: 4 },
  difference: 0.5,
  conclusive: true,
  effect: { difference: 5.5, margin95: 8.5 },
  byTier: {},
  netEffect30d: null,
  truncated: false,
};

function renderFill(fill: Partial<ServiceFillReportData>) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <ServiceFillReport fill={{ ...base, ...fill }} />
    </NextIntlClientProvider>,
  );
}

describe('ServiceFillReport : mesure de l’effet', () => {
  it('affiche « entre −3 et +14 points »', () => {
    renderFill({});

    expect(screen.getByText(/entre −3 et \+14 points/)).toBeInTheDocument();
  });

  it('« Pas encore de preuve d’effet » si la marge contient 0', () => {
    renderFill({});

    expect(screen.getByText('Pas encore de preuve d’effet')).toBeInTheDocument();
  });

  it('preuve d’effet si la marge exclut 0, sans chiffre de couverts gagnés', () => {
    renderFill({
      treated: { customers: 100, covers: 40, coversPerCustomer: 0.4, reservedCustomers: 30 },
      holdout: { customers: 50, covers: 5, coversPerCustomer: 0.1, reservedCustomers: 5 },
      effect: { difference: 20, margin95: 12.2 },
    });

    expect(screen.queryByText('Pas encore de preuve d’effet')).not.toBeInTheDocument();
    expect(screen.getByText(/entre \+8 et \+32 points/)).toBeInTheDocument();
    expect(screen.getByText('Effet démontré')).toBeInTheDocument();
  });

  it('4 réservants sur 40 contre 0 sur 20 : pas une preuve, même si la marge exclut 0', () => {
    renderFill({
      treated: { customers: 40, covers: 6, coversPerCustomer: 0.15, reservedCustomers: 4 },
      holdout: { customers: 20, covers: 0, coversPerCustomer: 0, reservedCustomers: 0 },
      effect: { difference: 10, margin95: 9 },
    });

    expect(screen.getByText('Pas encore de preuve d’effet')).toBeInTheDocument();
    expect(screen.queryByText('Effet démontré')).not.toBeInTheDocument();
  });

  it('3 réservants sur 10 contre 0 sur 5, non concluant : jamais de preuve d’effet, même si la marge exclut 0', () => {
    renderFill({
      treated: { customers: 10, covers: 6, coversPerCustomer: 0.6, reservedCustomers: 3 },
      holdout: { customers: 5, covers: 0, coversPerCustomer: 0, reservedCustomers: 0 },
      difference: 0.6,
      conclusive: false,
      effect: { difference: 30, margin95: 28.4 },
    });

    expect(screen.getByText('Pas encore de preuve d’effet')).toBeInTheDocument();
    expect(screen.queryByText('Effet démontré')).not.toBeInTheDocument();
  });

  it('fill.proven vrai l’emporte sur le calcul local', () => {
    renderFill({
      // Le calcul local dirait « pas de preuve » : 3 réservants côté témoin.
      holdout: { customers: 25, covers: 3, coversPerCustomer: 0.12, reservedCustomers: 3 },
      proven: true,
    });

    expect(screen.getByText('Effet démontré')).toBeInTheDocument();
    expect(screen.queryByText('Pas encore de preuve d’effet')).not.toBeInTheDocument();
  });

  it('fill.proven faux l’emporte sur le calcul local', () => {
    renderFill({
      treated: { customers: 100, covers: 40, coversPerCustomer: 0.4, reservedCustomers: 30 },
      holdout: { customers: 50, covers: 5, coversPerCustomer: 0.1, reservedCustomers: 5 },
      effect: { difference: 20, margin95: 12.2 },
      proven: false,
    });

    expect(screen.getByText('Pas encore de preuve d’effet')).toBeInTheDocument();
    expect(screen.queryByText('Effet démontré')).not.toBeInTheDocument();
  });

  it('campagne tronquée : message dédié', () => {
    renderFill({ truncated: true, conclusive: false, effect: { difference: 20, margin95: 5 } });

    expect(screen.getByText(/service s’est rempli/)).toBeInTheDocument();
    expect(screen.queryByText('Effet démontré')).not.toBeInTheDocument();
  });

  it('netEffect30d null : « Disponible 30 jours après l’envoi »', () => {
    renderFill({});

    expect(screen.getByText('Disponible 30 jours après l’envoi')).toBeInTheDocument();
  });

  it('netEffect30d calculé : couverts par client, sans écart en couverts', () => {
    renderFill({
      netEffect30d: {
        treatedCoversPerCustomer: 2.5,
        holdoutCoversPerCustomer: 1.25,
        difference: 1.25,
      },
    });

    expect(screen.queryByText('Disponible 30 jours après l’envoi')).not.toBeInTheDocument();
    expect(screen.getByText(/2\.50 contre 1\.25/)).toBeInTheDocument();
  });

  it('byTier : liste compacte des paliers présents', () => {
    renderFill({
      byTier: {
        CRENEAU: {
          treated: { customers: 10, reservedCustomers: 3 },
          holdout: { customers: 5, reservedCustomers: 0 },
        },
      },
    });

    expect(screen.getByText(/Habitués du créneau/)).toBeInTheDocument();
    expect(screen.getByText(/3 sur 10 contre 0 sur 5/)).toBeInTheDocument();
    expect(screen.queryByText(/Clients connus/)).not.toBeInTheDocument();
  });

  it('ancienne réponse sans les nouveaux champs : rendu inchangé', () => {
    render(
      <NextIntlClientProvider locale="fr" messages={messages}>
        <ServiceFillReport
          fill={{
            treated: { customers: 40, covers: 60, coversPerCustomer: 1.5 },
            holdout: { customers: 25, covers: 25, coversPerCustomer: 1 },
            difference: 0.5,
            conclusive: true,
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(screen.queryByText(/Pas encore de preuve/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Disponible 30 jours/)).not.toBeInTheDocument();
  });
});
