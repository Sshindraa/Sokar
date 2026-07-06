'use client';

/**
 * Sokar Dashboard — Widget / Intégration.
 *
 * Permet au restaurateur de copier le snippet JS d'embed et de visualiser
 * un aperçu live du widget. Paramètres de marque blanche : couleurs
 * primaires et accent.
 */

import { useEffect, useState, useCallback } from 'react';
import { useApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { OnboardingLockBanner } from '@/features/onboarding/onboarding-guard';
import { AlertCircle, CheckCircle2, Code, Copy, ExternalLink, Palette } from 'lucide-react';

const DEFAULT_PRIMARY = '#0f172a';
const DEFAULT_ACCENT = '#f97316';
const WIDGET_HOST = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sokar.tech';

type ConnectSettings = {
  restaurantId: string;
  slug: string;
  name: string;
  connectPublished: boolean;
};

const PROD_WIDGET_HOST = 'https://sokar.tech';

function buildSnippet(slug: string, primary: string, accent: string): string {
  const isProd = WIDGET_HOST === PROD_WIDGET_HOST;
  const hostAttr = isProd ? '' : ` data-host="${WIDGET_HOST}"`;
  return `<script src="${WIDGET_HOST}/embed.js" data-slug="${slug}"${hostAttr} data-primary="${primary}" data-accent="${accent}"></script>`;
}

function buildWidgetUrl(slug: string, primary: string, accent: string): string {
  return (
    `${WIDGET_HOST}/widget/${slug}?embedded=1&primary=` +
    `${encodeURIComponent(primary.replace('#', ''))}&accent=${encodeURIComponent(accent.replace('#', ''))}`
  );
}

export default function WidgetIntegrationPage() {
  const { get, orgId } = useApi();
  const [settings, setSettings] = useState<ConnectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [primary, setPrimary] = useState(DEFAULT_PRIMARY);
  const [accent, setAccent] = useState(DEFAULT_ACCENT);

  const loadData = useCallback(() => {
    if (!orgId) return;
    setLoading(true);
    get<ConnectSettings>(`restaurants/${orgId}/connect`)
      .then((s) => setSettings(s))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orgId, get]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCopy() {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(buildSnippet(settings.slug, primary, accent));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Impossible de copier le snippet. Veuillez le sélectionner manuellement.');
    }
  }

  if (!orgId && !loading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            Sélectionnez un restaurant pour configurer le widget.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <OnboardingLockBanner task="connect-identity" />

      <div>
        <div className="flex items-center gap-2">
          <Code className="h-6 w-6 text-primary" />
          <h2 className="text-2xl font-semibold tracking-tight">Widget / Intégration</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Intégrez le formulaire de réservation Sokar sur votre site web en un clic.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : !settings ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucune donnée disponible pour ce restaurant.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="sokar-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Code size={18} />
                Snippet à intégrer
              </CardTitle>
              <CardDescription>
                Copiez ce code dans le HTML de votre site, à l&apos;endroit où vous souhaitez
                afficher le widget.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="snippet" className="text-sm font-medium">
                  Snippet
                </label>
                <Input
                  id="snippet"
                  readOnly
                  value={buildSnippet(settings.slug, primary, accent)}
                  className="font-mono text-xs"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="primary" className="flex items-center gap-2 text-sm font-medium">
                    <Palette size={16} />
                    Couleur principale
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="primary"
                      type="color"
                      value={primary}
                      onChange={(e) => setPrimary(e.target.value)}
                      className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent"
                    />
                    <Input
                      value={primary}
                      onChange={(e) => setPrimary(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="accent" className="flex items-center gap-2 text-sm font-medium">
                    <Palette size={16} />
                    Couleur d&apos;accent
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="accent"
                      type="color"
                      value={accent}
                      onChange={(e) => setAccent(e.target.value)}
                      className="h-10 w-10 cursor-pointer rounded border border-border bg-transparent"
                    />
                    <Input
                      value={accent}
                      onChange={(e) => setAccent(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              <Button onClick={handleCopy} className="w-full gap-2" variant="default">
                {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
                {copied ? 'Snippet copié' : 'Copier le snippet'}
              </Button>
            </CardContent>
          </Card>

          <Card className="sokar-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ExternalLink size={18} />
                Aperçu
              </CardTitle>
              <CardDescription>
                Cet aperçu correspond exactement à ce que vos clients verront sur votre site.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border border-border bg-background">
                <iframe
                  src={buildWidgetUrl(settings.slug, primary, accent)}
                  title="Aperçu du widget Sokar"
                  className="w-full"
                  style={{ height: 520 }}
                  scrolling="no"
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                La hauteur s&apos;adapte automatiquement sur votre site grâce au script /embed.js.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
