/**
 * E-mails de fin d'essai et de service suspendu. Ils partent du bilan réel de l'essai (appels
 * décrochés, réservations prises) : le restaurateur voit ce qu'il garde ou ce qu'il perd, pas un
 * simple rappel de paiement.
 *
 * Mise en page pour les messageries : tableaux, styles en ligne, aucune ressource externe, largeur
 * 560 px. Même identité que le dashboard : quasi-noir, crème, gris chaud, chiffres en gras.
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

// Palette du dashboard, en hex : les messageries n'interprètent pas les variables CSS.
const INK = '#141414';
const MUTED = '#6f6a64';
const LINE = '#e7e3dc';
const PAGE = '#f4f2ee';
const CARD = '#ffffff';
const TILE = '#f8f6f2';
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count.toLocaleString('fr-FR')} ${count > 1 ? pluralForm : singular}`;
}

function formatDate(date: Date, withWeekday = true): string {
  return date.toLocaleDateString('fr-FR', {
    ...(withWeekday ? { weekday: 'long' } : {}),
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Paris',
  });
}

/** Résumé en une phrase, ou `null` quand l'assistant n'a encore reçu aucun appel. */
function recapSentence(recap: ActivityRecap): string | null {
  if (recap.calls === 0) return null;
  const calls = plural(recap.calls, 'appel', 'appels');
  if (recap.reservations === 0) return `Sokar a décroché ${calls} pour vous.`;
  const reservations = plural(recap.reservations, 'réservation', 'réservations');
  const covers = plural(recap.covers, 'couvert', 'couverts');
  return `Sokar a décroché ${calls} et pris ${reservations} pour vous (${covers}).`;
}

// ─── Building blocks ────────────────────────────────────────────────────────

function paragraph(html: string, options: { muted?: boolean; size?: number } = {}): string {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:${options.size ?? 15}px;line-height:1.6;color:${options.muted ? MUTED : INK}">${html}</p>`;
}

function eyebrow(text: string): string {
  return `<p style="margin:0 0 10px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED}">${text}</p>`;
}

/** Three figures side by side, like the dashboard KPI cards. */
function recapTiles(recap: ActivityRecap): string {
  const tiles = [
    { value: recap.calls, label: 'Appels<br>décrochés' },
    { value: recap.reservations, label: 'Réservations<br>prises' },
    { value: recap.covers, label: 'Couverts<br>réservés' },
  ];
  const cells = tiles
    .map(
      (tile, index) => `
          <td width="33%" valign="top" style="padding:0 ${index < 2 ? '8px' : '0'} 0 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${TILE};border:1px solid ${LINE};border-radius:14px">
              <tr><td style="padding:16px 14px">
                <p style="margin:0;font-family:${FONT};font-size:28px;font-weight:800;line-height:1;letter-spacing:-0.5px;color:${INK}">${tile.value.toLocaleString('fr-FR')}</p>
                <p style="margin:8px 0 0;font-family:${FONT};font-size:10px;font-weight:700;line-height:1.35;letter-spacing:1px;text-transform:uppercase;color:${MUTED}">${tile.label}</p>
              </td></tr>
            </table>
          </td>`,
    )
    .join('');
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px">
        <tr>${cells}
        </tr>
      </table>`;
}

/** A soft framed note (no call received, what is kept). */
function note(title: string, text: string): string {
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 22px;background:${TILE};border:1px solid ${LINE};border-radius:14px">
        <tr><td style="padding:16px 18px">
          <p style="margin:0 0 4px;font-family:${FONT};font-size:14px;font-weight:700;color:${INK}">${title}</p>
          <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.55;color:${MUTED}">${text}</p>
        </td></tr>
      </table>`;
}

/** Dated steps, with a thin rule between them. */
function steps(items: Array<{ when: string; text: string }>): string {
  const rows = items
    .map(
      (item, index) => `
        <tr>
          <td width="14" valign="top" style="padding:5px 0 0">
            <div style="width:8px;height:8px;border-radius:8px;background:${index === 0 ? INK : LINE}"></div>
          </td>
          <td valign="top" style="padding:0 0 ${index < items.length - 1 ? '14px' : '0'} 10px">
            <p style="margin:0;font-family:${FONT};font-size:14px;font-weight:700;color:${INK}">${item.when}</p>
            <p style="margin:2px 0 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED}">${item.text}</p>
          </td>
        </tr>`,
    )
    .join('');
  return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 26px">${rows}
      </table>`;
}

/** Bulletproof pill button (rendered by Outlook too). */
function button(label: string, href: string): string {
  return `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px">
        <tr><td style="background:${INK};border-radius:999px">
          <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${label}&nbsp;&rarr;</a>
        </td></tr>
      </table>`;
}

function layout(args: {
  /** Plain-text document title (the subject): escaped once, never derived from HTML. */
  documentTitle: string;
  preheader: string;
  eyebrow: string;
  title: string;
  body: string;
  restaurantName: string;
  dashboardUrl: string;
}): string {
  const name = escapeHtml(args.restaurantName);
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${escapeHtml(args.documentTitle)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(args.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td style="padding:0 4px 18px">
          <p style="margin:0;font-family:${FONT};font-size:18px;font-weight:800;letter-spacing:-0.3px;color:${INK}">Sokar</p>
        </td></tr>
        <tr><td style="background:${CARD};border:1px solid ${LINE};border-radius:20px;padding:36px 32px">
          ${eyebrow(args.eyebrow)}
          <h1 style="margin:0 0 16px;font-family:${FONT};font-size:26px;font-weight:800;line-height:1.2;letter-spacing:-0.5px;color:${INK}">${args.title}</h1>
          ${args.body}
        </td></tr>
        <tr><td style="padding:20px 8px 0">
          <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">
            Vous recevez cet e-mail parce que vous avez un compte Sokar pour ${name}.<br>
            <a href="${escapeHtml(args.dashboardUrl)}/dashboard/settings#settings-plan" style="color:${MUTED};text-decoration:underline">Gérer mon abonnement</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── E-mails ────────────────────────────────────────────────────────────────

export function buildTrialEndingEmail(args: {
  restaurantName: string;
  trialEndsAt: Date;
  recap: ActivityRecap;
  dashboardUrl: string;
  now?: Date;
}): BillingEmail {
  const base = args.dashboardUrl.replace(/\/+$/, '');
  const name = escapeHtml(args.restaurantName);
  const endsOn = formatDate(args.trialEndsAt);
  const endsOnShort = formatDate(args.trialEndsAt, false);
  const recap = recapSentence(args.recap);
  const subject = `${args.restaurantName} : votre essai Sokar se termine ${endsOn}`;
  // Stripe warns three days ahead, but a retried job can leave later: count from the real end.
  const daysLeft = Math.max(
    0,
    Math.ceil((args.trialEndsAt.getTime() - (args.now ?? new Date()).getTime()) / 86_400_000),
  );
  const title =
    daysLeft <= 0
      ? `${name}, c’est le dernier jour de votre essai`
      : daysLeft === 1
        ? `${name}, plus qu’un jour d’essai`
        : `${name}, plus que ${daysLeft} jours d’essai`;
  const next = steps([
    {
      when: 'Ajoutez votre carte',
      text: `Aucun prélèvement avant le ${endsOnShort}. Sans engagement en mensuel.`,
    },
    {
      when: `Le ${endsOnShort}`,
      text: 'Votre formule démarre et l’assistant continue sans interruption. Sans carte, il cesse de décrocher.',
    },
  ]);
  const cta = button('Ajouter ma carte', `${base}/dashboard/settings#settings-plan`);

  if (!recap) {
    // Aucun appel en 11 jours : le plus probable est un renvoi de ligne pas encore activé.
    return {
      subject,
      html: layout({
        documentTitle: subject,
        preheader: `Votre numéro Sokar n’a encore reçu aucun appel : vérifions ensemble le renvoi de votre ligne.`,
        eyebrow: 'Votre essai gratuit',
        title: `${name}, votre assistant attend son premier appel`,
        body: [
          paragraph(
            `Votre essai se termine ${endsOn}, et votre numéro Sokar n’a reçu aucun appel pour l’instant.`,
          ),
          note(
            'Vérifiez le renvoi de votre ligne',
            'Le plus souvent, le renvoi de votre numéro vers Sokar n’est pas encore activé. Une fois fait, l’assistant décroche à votre place pendant le service.',
          ),
          next,
          cta,
        ].join(''),
        restaurantName: args.restaurantName,
        dashboardUrl: base,
      }),
    };
  }

  return {
    subject,
    html: layout({
      documentTitle: subject,
      preheader: `${recap} Ajoutez une carte pour que l’assistant continue après le ${endsOnShort}.`,
      eyebrow: 'Votre essai gratuit',
      title,
      body: [
        paragraph(`Voici ce que Sokar a fait pour vous depuis le début de votre essai :`),
        recapTiles(args.recap),
        next,
        cta,
      ].join(''),
      restaurantName: args.restaurantName,
      dashboardUrl: base,
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
  const base = args.dashboardUrl.replace(/\/+$/, '');
  const name = escapeHtml(args.restaurantName);
  const recap = recapSentence(args.recap);
  const ended = args.endedFromTrial
    ? 'Votre essai gratuit est terminé'
    : 'Votre abonnement Sokar est terminé';
  const period = args.endedFromTrial ? 'votre essai' : 'votre abonnement';

  const subject = `${args.restaurantName} : votre assistant Sokar ne répond plus`;
  return {
    subject,
    html: layout({
      documentTitle: subject,
      preheader: `${ended}. Vos réglages sont conservés : réactivez l’assistant en deux minutes.`,
      eyebrow: args.endedFromTrial ? 'Fin de votre essai' : 'Fin de votre abonnement',
      title: `${name}, votre assistant ne répond plus aux appels`,
      body: [
        paragraph(
          `${ended} : depuis, l’assistant ne décroche plus et vos clients ne peuvent plus réserver par téléphone avec Sokar.`,
        ),
        ...(recap
          ? [
              paragraph(`Pendant ${period}, voici ce qu’il a fait pour vous :`, { muted: true }),
              recapTiles(args.recap),
            ]
          : []),
        note(
          'Tout est conservé',
          'Vos réglages, votre salle et votre fichier client restent en place. Choisissez une formule et l’assistant reprend immédiatement, sans rien reconfigurer.',
        ),
        button('Réactiver mon assistant', `${base}/pricing`),
      ].join(''),
      restaurantName: args.restaurantName,
      dashboardUrl: base,
    }),
  };
}
