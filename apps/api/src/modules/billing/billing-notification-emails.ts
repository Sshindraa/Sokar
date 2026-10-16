/**
 * E-mails de fin d'essai et de service suspendu. Ils partent du bilan réel de l'essai (appels
 * décrochés, réservations prises) : le restaurateur voit ce qu'il garde ou ce qu'il perd, pas un
 * simple rappel de paiement. Même mise en page que les relances d'onboarding.
 */

export type BillingNotificationKind = 'trial-ending' | 'service-suspended';

/** Activité de Sokar pour le restaurant depuis le début de l'essai ou de l'abonnement. */
export type ActivityRecap = {
  /** Appels reçus par l'assistant. */
  calls: number;
  /** Réservations prises (hors annulées), tous canaux. */
  reservations: number;
  /** Couverts de ces réservations. */
  covers: number;
  /** Réservations prises au téléphone par l'assistant. */
  phoneReservations: number;
};

export type BillingEmail = { subject: string; html: string };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Paris',
  });
}

function layout(args: {
  title: string;
  paragraphs: string[];
  highlight?: string;
  cta: { label: string; href: string };
  restaurantName: string;
}): string {
  const paragraphs = args.paragraphs
    .map((text) => `<p style="margin:0 0 12px;line-height:1.5">${text}</p>`)
    .join('\n        ');
  const highlight = args.highlight
    ? `<p style="margin:0 0 16px;padding:14px 16px;background:#f1f5f9;border-radius:8px;line-height:1.5;font-weight:600">${args.highlight}</p>`
    : '';
  return `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <h1 style="font-size:22px;margin:0 0 12px">${args.title}</h1>
        ${highlight}
        ${paragraphs}
        <a href="${escapeHtml(args.cta.href)}"
           style="display:inline-block;margin-top:4px;background:#0f172a;color:white;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">
          ${args.cta.label} →
        </a>
        <p style="margin-top:24px;color:#64748b;font-size:13px">
          Vous recevez cet e-mail parce que vous avez un compte Sokar pour ${escapeHtml(args.restaurantName)}.
        </p>
      </div>
    `;
}

/** Phrase de bilan, ou `null` quand l'assistant n'a encore reçu aucun appel. */
function recapSentence(recap: ActivityRecap): string | null {
  if (recap.calls === 0) return null;
  const calls = plural(recap.calls, 'appel', 'appels');
  if (recap.reservations === 0) return `Sokar a décroché ${calls} pour vous.`;
  const reservations = plural(recap.reservations, 'réservation', 'réservations');
  const covers = plural(recap.covers, 'couvert', 'couverts');
  return `Sokar a décroché ${calls} et pris ${reservations} pour vous (${covers}).`;
}

export function buildTrialEndingEmail(args: {
  restaurantName: string;
  trialEndsAt: Date;
  recap: ActivityRecap;
  dashboardUrl: string;
}): BillingEmail {
  const name = escapeHtml(args.restaurantName);
  const base = args.dashboardUrl.replace(/\/+$/, '');
  const endsOn = formatDate(args.trialEndsAt);
  const recap = recapSentence(args.recap);
  const cta = { label: 'Ajouter ma carte', href: `${base}/dashboard/settings#settings-plan` };

  if (!recap) {
    // Aucun appel en 11 jours : le plus probable est un renvoi de ligne pas encore activé.
    return {
      subject: `${args.restaurantName} : votre essai Sokar se termine ${endsOn}`,
      html: layout({
        restaurantName: args.restaurantName,
        title: `${name}, votre assistant n’a encore reçu aucun appel`,
        paragraphs: [
          `Votre essai gratuit se termine ${endsOn}, et votre numéro Sokar n’a reçu aucun appel pour l’instant.`,
          'Le plus souvent, c’est que le renvoi de votre ligne vers Sokar n’est pas encore activé. Une fois fait, l’assistant décroche à votre place pendant le service.',
          'Pour continuer après l’essai, ajoutez une carte bancaire : vous ne serez débité qu’à la fin de l’essai.',
        ],
        cta,
      }),
    };
  }

  return {
    subject: `${args.restaurantName} : votre essai Sokar se termine ${endsOn}`,
    html: layout({
      restaurantName: args.restaurantName,
      title: `${name}, votre essai gratuit se termine ${endsOn}`,
      highlight: recap,
      paragraphs: [
        'Pour que l’assistant continue de répondre à vos clients après cette date, ajoutez une carte bancaire depuis votre espace. Vous ne serez débité qu’à la fin de l’essai.',
        'Sans carte, l’assistant cessera de décrocher à la fin de l’essai.',
      ],
      cta,
    }),
  };
}

export function buildServiceSuspendedEmail(args: {
  restaurantName: string;
  /** L'abonnement s'est terminé à la fin de l'essai (et non après une résiliation). */
  endedFromTrial: boolean;
  recap: ActivityRecap;
  dashboardUrl: string;
}): BillingEmail {
  const name = escapeHtml(args.restaurantName);
  const base = args.dashboardUrl.replace(/\/+$/, '');
  const recap = recapSentence(args.recap);
  const ended = args.endedFromTrial
    ? 'Votre essai gratuit est terminé'
    : 'Votre abonnement Sokar est terminé';
  const recapIntro = args.endedFromTrial ? 'Pendant votre essai, ' : 'Pendant votre abonnement, ';

  return {
    subject: `${args.restaurantName} : votre assistant Sokar ne répond plus`,
    html: layout({
      restaurantName: args.restaurantName,
      title: `${name}, votre assistant ne répond plus aux appels`,
      ...(recap ? { highlight: `${recapIntro}${recap}` } : {}),
      paragraphs: [
        `${ended} : depuis, l’assistant ne décroche plus et vos clients ne peuvent plus réserver par téléphone avec Sokar.`,
        'Vos réglages, votre salle et votre fichier client sont conservés. Choisissez une formule et l’assistant reprend immédiatement, sans rien reconfigurer.',
      ],
      cta: { label: 'Réactiver mon assistant', href: `${base}/pricing` },
    }),
  };
}
