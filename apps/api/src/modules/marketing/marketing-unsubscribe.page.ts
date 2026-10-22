import type { MarketingChannelCode } from './marketing-permission.service';

const CHANNEL_LABEL: Record<MarketingChannelCode, string> = {
  EMAIL: 'par e-mail',
  SMS: 'par SMS',
  WHATSAPP: 'par WhatsApp',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:48px 16px;background:#f5f7fa;color:#1c2733}
main{max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,.12)}
h1{font-size:20px;margin:0 0 16px}
p{line-height:1.5;margin:0 0 16px}
button{font:inherit;background:#1c2733;color:#fff;border:0;border-radius:8px;padding:12px 20px;cursor:pointer}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;
}

/** Étape de confirmation : un simple affichage du lien ne désinscrit personne. */
export function renderUnsubscribeConfirmPage(token: string): string {
  return page(
    'Désinscription',
    `<h1>Ne plus recevoir ces messages ?</h1>
<p>Confirmez votre désinscription : vous ne recevrez plus de messages promotionnels de ce restaurant sur ce canal.</p>
<form method="post">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit">Me désinscrire</button>
</form>`,
  );
}

export function renderUnsubscribeDonePage(channel: MarketingChannelCode): string {
  return page(
    'Désinscription confirmée',
    `<h1>Vous êtes désinscrit</h1>
<p>Vous ne recevrez plus de messages promotionnels de ce restaurant ${CHANNEL_LABEL[channel]}. Vos confirmations de réservation ne sont pas concernées.</p>`,
  );
}

export function renderUnsubscribeInvalidPage(): string {
  return page(
    'Lien invalide',
    `<h1>Ce lien n’est plus valide</h1>
<p>Il a expiré ou il est incomplet. Répondez au message reçu ou contactez directement le restaurant : votre demande sera traitée.</p>`,
  );
}
