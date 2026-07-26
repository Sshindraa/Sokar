/**
 * Sokar Connect — Widget embed snippet.
 *
 * Usage :
 *   <script src="https://sokar.tech/embed.js" data-slug="chez-sokar-demo"
 *           data-primary="#0f172a" data-accent="#f97316"></script>
 *
 * Le script injecte un iframe responsive vers /widget/:slug. L'iframe
 * s'auto-redimensionne via postMessage.
 */
(function () {
  const script = document.currentScript;
  const slug = script.getAttribute('data-slug');
  const primary = script.getAttribute('data-primary') || '#0f172a';
  const accent = script.getAttribute('data-accent') || '#f97316';
  if (!slug) return;

  let rawHost = (script.getAttribute('data-host') || 'https://sokar.tech').replace(/\/$/, '');
  // Validate host to prevent XSS via malicious data-host attribute.
  // Only allow HTTPS URLs or localhost (dev). Reject anything else.
  if (!/^https:\/\/[a-zA-Z0-9.-]+$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(rawHost)) {
    console.error('[sokar-widget] Invalid data-host attribute');
    rawHost = 'https://sokar.tech';
  }
  const host = rawHost;
  const iframe = document.createElement('iframe');
  // Build URL safely via URL API to prevent DOM injection via data-host.
  const widgetUrl = new URL(host);
  widgetUrl.pathname = '/widget/' + encodeURIComponent(slug);
  widgetUrl.searchParams.set('embedded', '1');
  widgetUrl.searchParams.set('primary', primary.replace('#', ''));
  widgetUrl.searchParams.set('accent', accent.replace('#', ''));
  iframe.src = widgetUrl.toString();
  iframe.style.width = '100%';
  iframe.style.border = '0';
  iframe.scrolling = 'no';
  iframe.title = 'Réserver une table avec Sokar';

  // Auto-resize via postMessage
  window.addEventListener('message', (e) => {
    if (e.origin !== host) return;
    if (e.data?.type === 'sokar-widget-resize' && e.data?.height) {
      if (typeof e.data?.height === 'number' && e.data.height > 0 && e.data.height < 10000) {
        iframe.style.height = e.data.height + 'px';
      }
    }
  });

  script.parentNode.insertBefore(iframe, script.nextSibling);
})();
