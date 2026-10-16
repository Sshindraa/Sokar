import { describe, expect, it } from 'vitest';
import {
  buildServiceSuspendedEmail,
  buildTrialEndingEmail,
  type ActivityRecap,
} from '../billing-notification-emails';

const busy: ActivityRecap = { calls: 47, reservations: 18, covers: 52, phoneReservations: 15 };
const silent: ActivityRecap = { calls: 0, reservations: 0, covers: 0, phoneReservations: 0 };
const trialEndsAt = new Date('2026-10-30T10:00:00.000Z');

describe('e-mail de fin d’essai', () => {
  it('fait le bilan de l’essai et mène à l’ajout de la carte', () => {
    const email = buildTrialEndingEmail({
      restaurantName: 'Le Bistrot',
      trialEndsAt,
      recap: busy,
      dashboardUrl: 'https://sokar.tech/',
      now: new Date('2026-10-27T10:00:00.000Z'),
    });
    expect(email.html).toContain('>3</td>');
    expect(email.html).toContain('d’essai restants');
    expect(email.html).toContain('src="https://sokar.tech/apple-touch-icon.png"');
    expect(email.html).toContain('>52<');
    expect(email.subject).toBe('Le Bistrot : votre essai Sokar se termine vendredi 30 octobre');
    expect(email.html).toContain(
      'Sokar a décroché 47 appels et pris 18 réservations pour vous (52 couverts).',
    );
    expect(email.html).toContain('href="https://sokar.tech/dashboard/settings#settings-plan"');
    expect(email.html).toContain('Ajouter ma carte');
  });

  it('signale un renvoi de ligne probablement absent quand aucun appel n’est arrivé', () => {
    const email = buildTrialEndingEmail({
      restaurantName: 'Le Bistrot',
      trialEndsAt,
      recap: silent,
      dashboardUrl: 'https://sokar.tech',
    });
    expect(email.html).toContain('n’a encore reçu aucun appel');
    expect(email.html).toContain('renvoi de votre ligne');
  });

  it('accorde le singulier et échappe le nom du restaurant', () => {
    const email = buildTrialEndingEmail({
      restaurantName: 'Chez <Léa> & Co',
      trialEndsAt,
      recap: { calls: 1, reservations: 1, covers: 1, phoneReservations: 1 },
      dashboardUrl: 'https://sokar.tech',
    });
    expect(email.html).toContain(
      'Sokar a décroché 1 appel et pris 1 réservation pour vous (1 couvert).',
    );
    expect(email.html).toContain('Chez &lt;Léa&gt; &amp; Co');
    expect(email.html).not.toContain('<Léa>');
    expect(email.html).toContain(
      '<title>Chez &lt;Léa&gt; &amp; Co : votre essai Sokar se termine vendredi 30 octobre</title>',
    );
  });
});

describe('e-mail de service suspendu', () => {
  it('rappelle ce que l’essai a apporté et mène à la réactivation', () => {
    const email = buildServiceSuspendedEmail({
      restaurantName: 'Le Bistrot',
      endedFromTrial: true,
      recap: busy,
      dashboardUrl: 'https://sokar.tech',
    });
    expect(email.subject).toBe('Le Bistrot : votre assistant Sokar ne répond plus');
    expect(email.html).toContain('Pendant votre essai, voici ce qu’il a fait pour vous');
    expect(email.html).toContain('>47<');
    expect(email.html).toContain('Votre essai gratuit est terminé');
    expect(email.html).toContain('href="https://sokar.tech/pricing"');
  });

  it('parle d’abonnement terminé après une résiliation', () => {
    const email = buildServiceSuspendedEmail({
      restaurantName: 'Le Bistrot',
      endedFromTrial: false,
      recap: silent,
      dashboardUrl: 'https://sokar.tech',
    });
    expect(email.html).toContain('Votre abonnement Sokar est terminé');
    expect(email.html).not.toContain('Pendant votre');
  });
});
