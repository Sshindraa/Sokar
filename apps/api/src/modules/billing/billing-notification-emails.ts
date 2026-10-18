/**
 * E-mails de fin d'essai et de service suspendu. Ils partent du bilan réel de l'essai (appels
 * décrochés, réservations prises) : le restaurateur voit ce qu'il garde ou ce qu'il perd, pas un
 * simple rappel de paiement.
 *
 * Mise en page pour les messageries : tableaux, styles en ligne, aucune feuille externe, largeur
 * 560 px. Identité du dashboard : en-tête quasi noir avec le logo, compte à rebours et frise des
 * jours d'essai, chiffres en gras, bouton pilule. Le logo est une image PNG publique (les
 * messageries n'affichent pas le SVG).
 */

import { BRAND_SLOGAN, BRAND_TITLE } from '@sokar/shared';

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

const TRIAL_TOTAL_DAYS = 14;
const DAY_MS = 86_400_000;

// Palette du dashboard, en hex : les messageries n'interprètent pas les variables CSS.
const NIGHT = '#0e0e0d';
const NIGHT_LINE = '#2a2826';
const NIGHT_MUTED = '#9a948c';
const CREAM = '#f3efe7';
const INK = '#151413';
const MUTED = '#6f6a64';
const LINE = '#e8e4dd';
const PAGE = '#efece6';
const CARD = '#ffffff';
const SOFT = '#f7f5f1';
const ALERT = '#d4553f';
const FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

// ─── Dark header ────────────────────────────────────────────────────────────

function brandBar(args: { logoUrl: string; badge: string; badgeDot?: string }): string {
  const dot = args.badgeDot
    ? `<span style="display:inline-block;width:7px;height:7px;border-radius:7px;background:${args.badgeDot};margin-right:7px;vertical-align:1px"></span>`
    : '';
  return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="middle">
              <table role="presentation" cellpadding="0" cellspacing="0"><tr>
                <td valign="middle"><img src="${escapeHtml(args.logoUrl)}" width="36" height="36" alt="Sokar" style="display:block;width:36px;height:36px;border:1px solid ${NIGHT_LINE};border-radius:10px"></td>
                <td valign="middle" style="padding-left:12px;font-family:${FONT};font-size:17px;font-weight:800;letter-spacing:-0.2px;color:${CREAM}">Sokar</td>
              </tr></table>
            </td>
            <td align="right" valign="middle">
              <span style="display:inline-block;padding:7px 13px;border:1px solid ${NIGHT_LINE};border-radius:999px;font-family:${FONT};font-size:12px;font-weight:600;color:${CREAM}">${dot}${args.badge}</span>
            </td>
          </tr>
        </table>`;
}

/** One cell per trial day: elapsed, today, still to come. */
function trialTrack(daysLeft: number): string {
  const today = Math.min(TRIAL_TOTAL_DAYS, Math.max(1, TRIAL_TOTAL_DAYS - daysLeft + 1));
  const cells = Array.from({ length: TRIAL_TOTAL_DAYS }, (_, index) => {
    const day = index + 1;
    const color = day < today ? '#5c5852' : day === today ? CREAM : NIGHT_LINE;
    const gap =
      day < TRIAL_TOTAL_DAYS ? `<td width="4" style="font-size:0;line-height:0">&nbsp;</td>` : '';
    return `<td height="6" style="height:6px;background:${color};border-radius:6px;font-size:0;line-height:0">&nbsp;</td>${gap}`;
  }).join('');
  return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px">
          <tr>${cells}</tr>
        </table>`;
}

function hero(args: {
  logoUrl: string;
  badge: string;
  badgeDot?: string;
  eyebrow: string;
  /** Large figure (countdown); omitted for the suspended e-mail. */
  bigFigure?: { value: string; unit: string };
  title: string;
  lead: string;
  daysLeft?: number;
}): string {
  const figure = args.bigFigure
    ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 4px"><tr>
          <td valign="bottom" style="font-family:${FONT};font-size:76px;font-weight:800;line-height:0.9;letter-spacing:-3px;color:${CREAM}">${args.bigFigure.value}</td>
          <td valign="bottom" style="padding:0 0 9px 12px;font-family:${FONT};font-size:17px;font-weight:600;line-height:1.25;color:${NIGHT_MUTED}">${args.bigFigure.unit}</td>
        </tr></table>`
    : '';
  return `
    <tr><td style="background:${NIGHT};padding:26px 32px 32px">
        ${brandBar({ logoUrl: args.logoUrl, badge: args.badge, badgeDot: args.badgeDot })}
        <p style="margin:40px 0 12px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${NIGHT_MUTED}">${args.eyebrow}</p>
        ${figure}
        <h1 style="margin:${args.bigFigure ? '18px' : '0'} 0 10px;font-family:${FONT};font-size:27px;font-weight:800;line-height:1.18;letter-spacing:-0.6px;color:${CREAM}">${args.title}</h1>
        <p style="margin:0;font-family:${FONT};font-size:15px;line-height:1.6;color:${NIGHT_MUTED}">${args.lead}</p>
        ${typeof args.daysLeft === 'number' ? trialTrack(args.daysLeft) : ''}
    </td></tr>`;
}

// ─── Light body ─────────────────────────────────────────────────────────────

function sectionLabel(text: string): string {
  return `<p style="margin:0 0 14px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;color:${MUTED}">${text}</p>`;
}

/** The three figures in one card, split by hairlines, like a dashboard summary. */
function recapPanel(recap: ActivityRecap): string {
  const items = [
    { value: recap.calls, label: 'Appels<br>décrochés' },
    { value: recap.reservations, label: 'Réservations<br>prises' },
    { value: recap.covers, label: 'Couverts<br>réservés' },
  ];
  const cells = items
    .map(
      (item, index) => `
          <td width="33%" valign="top" style="padding:20px 18px;${index > 0 ? `border-left:1px solid ${LINE};` : ''}">
            <p style="margin:0;font-family:${FONT};font-size:34px;font-weight:800;line-height:1;letter-spacing:-1px;color:${INK}">${item.value.toLocaleString('fr-FR')}</p>
            <p style="margin:10px 0 0;font-family:${FONT};font-size:10px;font-weight:700;line-height:1.4;letter-spacing:1.1px;text-transform:uppercase;color:${MUTED}">${item.label}</p>
          </td>`,
    )
    .join('');
  return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};border:1px solid ${LINE};border-radius:16px">
          <tr>${cells}
          </tr>
        </table>`;
}

function note(args: { title: string; text: string; accent?: string }): string {
  return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SOFT};border:1px solid ${LINE};border-radius:16px">
          <tr>
            <td width="4" style="background:${args.accent ?? INK};border-radius:16px 0 0 16px;font-size:0;line-height:0">&nbsp;</td>
            <td style="padding:18px 20px">
              <p style="margin:0 0 5px;font-family:${FONT};font-size:15px;font-weight:700;color:${INK}">${args.title}</p>
              <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${MUTED}">${args.text}</p>
            </td>
          </tr>
        </table>`;
}

/** Full-width pill button, rendered by Outlook too, with a reassurance line under it. */
function action(args: { label: string; href: string; reassurance: string }): string {
  return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px">
          <tr><td align="center" style="background:${INK};border-radius:999px">
            <a href="${escapeHtml(args.href)}" style="display:block;padding:17px 24px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px;text-align:center">${args.label}&nbsp;&nbsp;&rarr;</a>
          </td></tr>
        </table>
        <p style="margin:14px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED};text-align:center">${args.reassurance}</p>`;
}

function layout(args: {
  /** Plain-text document title (the subject): escaped once, never derived from HTML. */
  documentTitle: string;
  preheader: string;
  hero: string;
  body: string;
  restaurantName: string;
  dashboardUrl: string;
  logoUrl: string;
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
    <tr><td align="center" style="padding:28px 12px 40px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD};border-radius:24px;overflow:hidden;border:1px solid ${LINE}">
        ${args.hero}
        <tr><td style="padding:32px 32px 36px">
          ${args.body}
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
        <tr><td align="center" style="padding:28px 16px 0">
          <img src="${escapeHtml(args.logoUrl)}" width="24" height="24" alt="" style="display:block;width:24px;height:24px;border-radius:7px;margin:0 auto 12px">
          <p style="margin:0 0 2px;font-family:${FONT};font-size:13px;font-weight:600;color:${INK}">Sokar, ${BRAND_TITLE.charAt(0).toLowerCase()}${BRAND_TITLE.slice(1)}</p>
          <p style="margin:0 0 10px;font-family:${FONT};font-size:12px;font-style:italic;color:${MUTED}">${BRAND_SLOGAN}</p>
          <p style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED}">Vous recevez cet e-mail parce que vous avez un compte Sokar pour ${name}.</p>
          <p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED}">
            <a href="${escapeHtml(args.dashboardUrl)}/dashboard" style="color:${MUTED};text-decoration:underline">Mon espace</a>
            &nbsp;·&nbsp;
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
  const logoUrl = `${base}/apple-touch-icon.png`;
  const name = escapeHtml(args.restaurantName);
  const endsOn = formatDate(args.trialEndsAt);
  const endsOnShort = formatDate(args.trialEndsAt, false);
  const recap = recapSentence(args.recap);
  const subject = `${args.restaurantName} : votre essai Sokar se termine ${endsOn}`;
  // Stripe warns three days ahead, but a retried job can leave later: count from the real end.
  const daysLeft = Math.max(
    0,
    Math.ceil((args.trialEndsAt.getTime() - (args.now ?? new Date()).getTime()) / DAY_MS),
  );
  const bigFigure =
    daysLeft <= 0
      ? { value: '0', unit: 'jour restant :<br>c’est aujourd’hui' }
      : {
          value: String(daysLeft),
          unit: `${daysLeft > 1 ? 'jours' : 'jour'}<br>d’essai restant${daysLeft > 1 ? 's' : ''}`,
        };
  const cta = action({
    label: 'Ajouter ma carte',
    href: `${base}/dashboard/settings#settings-plan`,
    reassurance: `Aucun prélèvement avant le ${endsOnShort} &nbsp;·&nbsp; Sans engagement en mensuel`,
  });

  if (!recap) {
    // Aucun appel en 11 jours : le plus probable est un renvoi de ligne pas encore activé.
    return {
      subject,
      html: layout({
        documentTitle: subject,
        preheader:
          'Votre numéro Sokar n’a encore reçu aucun appel : vérifiez le renvoi de votre ligne.',
        logoUrl,
        restaurantName: args.restaurantName,
        dashboardUrl: base,
        hero: hero({
          logoUrl,
          badge: 'Essai gratuit',
          eyebrow: name,
          bigFigure,
          title: 'Votre assistant attend son premier appel',
          lead: `Votre essai se termine ${endsOn}, et votre numéro Sokar n’a encore reçu aucun appel.`,
          daysLeft,
        }),
        body: [
          sectionLabel('À faire maintenant'),
          note({
            title: 'Activez le renvoi de votre ligne',
            text: 'Le plus souvent, le renvoi de votre numéro vers Sokar n’est pas encore activé. Une fois fait, l’assistant décroche à votre place pendant le service, dès le premier appel.',
          }),
          cta,
        ].join(''),
      }),
    };
  }

  return {
    subject,
    html: layout({
      documentTitle: subject,
      preheader: `${recap} Ajoutez une carte pour que l’assistant continue après le ${endsOnShort}.`,
      logoUrl,
      restaurantName: args.restaurantName,
      dashboardUrl: base,
      hero: hero({
        logoUrl,
        badge: 'Essai gratuit',
        eyebrow: name,
        bigFigure,
        title: 'Votre essai touche à sa fin',
        lead: `Ajoutez une carte pour que l’assistant continue de répondre à vos clients après le ${endsOn}.`,
        daysLeft,
      }),
      body: [
        sectionLabel('Ce que Sokar a fait pour vous'),
        recapPanel(args.recap),
        cta,
        `<p style="margin:22px 0 0;padding-top:20px;border-top:1px solid ${LINE};font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};text-align:center">Sans carte, l’assistant cessera de décrocher le ${endsOnShort} : pensez alors à désactiver le renvoi de votre ligne vers Sokar. Vos réglages restent conservés.</p>`,
      ].join(''),
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
  const logoUrl = `${base}/apple-touch-icon.png`;
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
      logoUrl,
      restaurantName: args.restaurantName,
      dashboardUrl: base,
      hero: hero({
        logoUrl,
        badge: 'Assistant en pause',
        badgeDot: ALERT,
        eyebrow: name,
        title: 'Votre assistant ne répond plus aux appels',
        lead: `${ended} : l’assistant ne décroche plus et vos clients ne peuvent plus réserver par téléphone avec Sokar.`,
      }),
      body: [
        ...(recap
          ? [
              sectionLabel(`Pendant ${period}, voici ce qu’il a fait pour vous`),
              recapPanel(args.recap),
              '<div style="height:16px;line-height:16px;font-size:0">&nbsp;</div>',
            ]
          : []),
        note({
          title: 'Votre ligne est-elle encore renvoyée vers Sokar ?',
          text: 'Si oui, vos clients entendent désormais un court message leur demandant de rappeler. Pour qu’ils vous joignent directement, désactivez ce renvoi chez votre opérateur, ou réactivez l’assistant.',
          accent: ALERT,
        }),
        '<div style="height:12px;line-height:12px;font-size:0">&nbsp;</div>',
        note({
          title: 'Tout est conservé',
          text: 'Vos réglages, votre salle et votre fichier client restent en place. Choisissez une formule et l’assistant reprend immédiatement, sans rien reconfigurer.',
        }),
        action({
          label: 'Réactiver mon assistant',
          href: `${base}/pricing`,
          reassurance: 'Reprise immédiate &nbsp;·&nbsp; Sans engagement en mensuel',
        }),
      ].join(''),
    }),
  };
}
