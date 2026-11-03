'use client';

// Code d'intégration du widget et aperçu. Les couleurs ne sont pas réglables : le widget n'en tient pas compte.

import { useEffect, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle2, Copy, Info } from 'lucide-react';
import { toast } from 'sonner';
import { useApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DataFetchError } from '@/components/DataFetchError';
import { OnboardingLockBanner } from '@/features/onboarding/onboarding-guard';
import { CLIPBOARD_RESET_DELAY_MS } from '@/constants/ui';
import { getErrorMessage } from '@/types/api';
import { buildWidgetPreviewUrl } from '@/lib/widget-preview-url';
import {
  buildWidgetSnippet,
  WIDGET_DEFAULT_ACCENT,
  WIDGET_DEFAULT_PRIMARY,
} from '@/lib/widget-snippet';

type ConnectSettings = {
  restaurantId: string;
  slug: string;
  name: string;
  connectPublished: boolean;
};

function buildWidgetUrl(slug: string): string {
  return buildWidgetPreviewUrl(slug, WIDGET_DEFAULT_PRIMARY, WIDGET_DEFAULT_ACCENT);
}

function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex text-muted-foreground transition-all duration-200 hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function WidgetIntegrationPage() {
  const { get, orgId } = useApi();
  const [settings, setSettings] = useState<ConnectSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadData = useCallback(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    get<ConnectSettings>(`restaurants/${orgId}/connect`)
      .then((s) => setSettings(s))
      .catch((err: unknown) => {
        setSettings(null);
        setError(getErrorMessage(err, 'Impossible de charger la configuration du widget.'));
      })
      .finally(() => setLoading(false));
  }, [orgId, get]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCopy() {
    if (!settings) return;
    try {
      await navigator.clipboard.writeText(buildWidgetSnippet(settings.slug));
      setCopied(true);
      setTimeout(() => setCopied(false), CLIPBOARD_RESET_DELAY_MS);
    } catch {
      toast.error('Impossible de copier le code. Sélectionnez-le manuellement.');
    }
  }

  // Le snippet entier, sans défilement : rows couvre les navigateurs sans field-sizing.
  const snippet = settings ? buildWidgetSnippet(settings.slug) : '';

  if (!orgId && !loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Sélectionnez un restaurant pour configurer le widget.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <OnboardingLockBanner task="connect-identity" />
      <h1 className="text-xl font-semibold tracking-tight md:text-2xl">Widget</h1>

      {loading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      ) : error ? (
        <DataFetchError message={error} onRetry={loadData} retrying={loading} />
      ) : !settings ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Aucune donnée disponible pour ce restaurant.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Code à intégrer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="snippet" className="text-sm font-medium">
                  Code du widget
                </label>
                <textarea
                  id="snippet"
                  readOnly
                  rows={Math.ceil(snippet.length / 30)}
                  value={snippet}
                  className="block w-full resize-none break-all rounded-md border border-input bg-background px-3 py-2 font-mono text-xs [field-sizing:content] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <Button onClick={handleCopy} className="w-full gap-2 transition-all duration-200">
                {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                {copied ? 'Code copié' : 'Copier le code'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Collez ce code dans le HTML de votre site, à l’endroit où le formulaire doit
                apparaître.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-base">
                Aperçu
                <InfoTip label="Précision sur la hauteur">
                  La hauteur s’adapte automatiquement sur votre site grâce au script /embed.js.
                </InfoTip>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border border-border bg-background">
                <iframe
                  src={buildWidgetUrl(settings.slug)}
                  title="Aperçu du widget Sokar"
                  className="w-full"
                  style={{ height: 520 }}
                  scrolling="no"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
