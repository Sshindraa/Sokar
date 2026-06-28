'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, CheckCircle2, Globe, Bot, ExternalLink, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

type CanalASettings = {
  restaurantId: string;
  slug: string;
  name: string;
  canalAPublished: boolean;
  canalAAgentic: boolean;
  canalAPublishedAt: string | null;
  pageUrl: string;
};

export default function CanalADashboardPage() {
  const { get, patch, orgId } = useApi();
  const [settings, setSettings] = useState<CanalASettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'canalAPublished' | 'canalAAgentic' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    setLoading(true);
    get<CanalASettings>(`restaurants/${orgId}/canal-a`)
      .then((data: CanalASettings) => setSettings(data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orgId, get]);

  async function toggle(field: 'canalAPublished' | 'canalAAgentic') {
    if (!settings || !orgId) return;
    setSaving(field);
    setError(null);
    setSuccessMsg(null);

    try {
      const newValue = !settings[field];
      await patch(`restaurants/${orgId}/canal-a`, { [field]: newValue });
      setSettings((prev) => (prev ? { ...prev, [field]: newValue } : prev));
      setSuccessMsg(
        field === 'canalAPublished'
          ? newValue
            ? 'Page publique activée'
            : 'Page publique désactivée'
          : newValue
            ? 'Exposition agentic activée'
            : 'Exposition agentic désactivée',
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
    } finally {
      setSaving(null);
    }
  }

  if (!orgId && !loading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">Sélectionne un restaurant pour configurer Canal A.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">Canal A — Pages Agent-Ready</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Rendez votre restaurant visible et réservable depuis Google, ChatGPT et les assistants IA.
        </p>
      </div>

      {/* Messages */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-600">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Main card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="h-5 w-5 text-primary" />
            Page publique
          </CardTitle>
          <CardDescription>
            Activez la page publique pour que votre restaurant soit trouvable et réservable en ligne.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : settings ? (
            <>
              {/* Canal APublished toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-1">
                  <Label htmlFor="canalAPublished" className="text-base font-medium">
                    Page publique activée
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Votre restaurant apparaît sur sokar.tech/r/{settings.slug} et dans le sitemap.
                    Les clients peuvent réserver directement depuis cette page.
                  </p>
                </div>
                <Switch
                  id="canalAPublished"
                  checked={settings.canalAPublished}
                  disabled={saving !== null}
                  onCheckedChange={() => toggle('canalAPublished')}
                />
              </div>

              {/* Canal AAgentic toggle */}
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div className="space-y-1">
                  <Label htmlFor="canalAAgentic" className="text-base font-medium">
                    Exposition agentic avancée
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Active les métadonnées structurées avancées (ReserveAction schema.org) et
                    l&apos;autorisation explicite pour les crawlers d&apos;IA (OAI-SearchBot).
                    Requiert la page publique activée.
                  </p>
                </div>
                <Switch
                  id="canalAAgentic"
                  checked={settings.canalAAgentic}
                  disabled={saving !== null || !settings.canalAPublished}
                  onCheckedChange={() => toggle('canalAAgentic')}
                />
              </div>

              {/* Preview iframe + URL externe */}
              <div className="space-y-3 pt-2">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-muted-foreground">Aperçu de la page</span>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`${settings.pageUrl}?preview=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Ouvrir en plein écran
                    </a>
                  </Button>
                </div>
                {settings.canalAPublished ? (
                  <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
                    <iframe
                      src={`${settings.pageUrl}?preview=1`}
                      title={`Aperçu — ${settings.name}`}
                      className="h-[480px] w-full"
                      loading="lazy"
                      sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                    />
                  </div>
                ) : (
                  <div className="flex h-[480px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-center">
                    <div className="space-y-2">
                      <Eye className="mx-auto h-8 w-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">
                        Activez la page publique pour voir l&apos;aperçu.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Status */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium',
                    settings.canalAPublished
                      ? 'bg-green-500/10 text-green-600'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      settings.canalAPublished ? 'bg-green-500' : 'bg-muted-foreground/50',
                    )}
                  />
                  {settings.canalAPublished ? 'Publié' : 'Non publié'}
                </span>
                {settings.canalAPublished && (
                  <span className="text-muted-foreground/60">
                    depuis{' '}
                    {settings.canalAPublishedAt
                      ? new Date(settings.canalAPublishedAt).toLocaleDateString('fr-FR')
                      : 'aujourd\'hui'}
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Impossible de charger les paramètres Canal A.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Stats card (placeholder — rempli quand la queue analytics tourne en prod) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="h-5 w-5 text-primary" />
            Statistiques
          </CardTitle>
          <CardDescription>
            Vue d&apos;ensemble des performances de votre page publique.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : !settings?.canalAPublished ? (
            <p className="text-sm text-muted-foreground">
              Active la page publique pour voir les statistiques.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="Vues" value="—" sub="cette semaine" />
              <StatCard label="Clics réservation" value="—" sub="cette semaine" />
              <StatCard label="Réservations" value="—" sub="cette semaine" />
              <StatCard label="Taux conversion" value="—" sub="vue → résa" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground/60">{sub}</p>
    </div>
  );
}
