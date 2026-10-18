const PROD_WIDGET_HOST = 'https://sokar.tech';

export const WIDGET_HOST = process.env.NEXT_PUBLIC_SITE_URL ?? PROD_WIDGET_HOST;
export const WIDGET_DEFAULT_PRIMARY = '#0f172a';
export const WIDGET_DEFAULT_ACCENT = '#f97316';

/** Code à coller dans un site web pour y afficher le bouton de réservation Sokar. */
export function buildWidgetSnippet(
  slug: string,
  primary: string = WIDGET_DEFAULT_PRIMARY,
  accent: string = WIDGET_DEFAULT_ACCENT,
): string {
  const hostAttr = WIDGET_HOST === PROD_WIDGET_HOST ? '' : ` data-host="${WIDGET_HOST}"`;
  return `<script src="${WIDGET_HOST}/embed.js" data-slug="${slug}"${hostAttr} data-primary="${primary}" data-accent="${accent}"></script>`;
}
