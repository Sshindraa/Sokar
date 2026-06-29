'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/api';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { OnboardingLockBanner } from '@/features/onboarding/onboarding-guard';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Eye,
  Zap,
  Bot,
  Sparkles,
  TrendingUp,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────

type ConnectSettings = {
  restaurantId: string;
  slug: string;
  name: string;
  connectPublished: boolean;
  connectAgentic: boolean;
  connectPublishedAt: string | null;
  pageUrl: string;
};

type ScoreItem = {
  key: string;
  label: string;
  weight: number;
  done: boolean;
  icon?: string;
};

type ConnectScore = {
  score: number;
  level: 'starter' | 'progress' | 'almost' | 'premium';
  message: string;
  items: ScoreItem[];
  missing: ScoreItem[];
  completed: number;
  total: number;
};

// ── Score circle (SVG) ─────────────────────────────────

function ScoreCircle({ score, level }: { score: number; level: ConnectScore['level'] }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const colorClass =
    level === 'premium'
      ? 'text-green-500'
      : level === 'almost'
        ? 'text-orange-400'
        : level === 'progress'
          ? 'text-orange-400'
          : 'text-muted-foreground';

  return (
    <div className="relative flex h-20 w-20 items-center justify-center">
      <svg className="h-20 w-20 -rotate-90" viewBox="0 0 64 64">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="5"
          className="text-muted/30"
          stroke="currentColor"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className={cn('transition-all duration-700 ease-out', colorClass)}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={cn('text-xl font-bold tabular-nums', colorClass)}>{score}%</span>
      </div>
    </div>
  );
}

// ── Stat card ──────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground/60">{sub}</p>
    </div>
  );
}

// ── Page principale ────────────────────────────────────

export default function ConnectDashboardPage() {
  const { get, patch, orgId } = useApi();
  const [settings, setSettings] = useState<ConnectSettings | null>(null);
  const [score, setScore] = useState<ConnectScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<'connectPublished' | 'connectAgentic' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Charge settings + score en parallèle
  const loadData = useCallback(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      get<ConnectSettings>(`restaurants/${orgId}/connect`),
      get<ConnectScore>(`restaurants/${orgId}/connect/score`),
    ])
      .then(([s, sc]) => {
        setSettings(s);
        setScore(sc);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orgId, get]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function toggle(field: 'connectPublished' | 'connectAgentic') {
    if (!settings || !orgId) return;
    setSaving(field);
    setError(null);
    setSuccessMsg(null);

    try {
      const newValue = !settings[field];
      await patch(`restaurants/${orgId}/connect`, { [field]: newValue });
      setSettings((prev) => (prev ? { ...prev, [field]: newValue } : prev));
      setSuccessMsg(
        field === 'connectPublished'
          ? newValue
            ? 'Connect activé — votre page est en ligne'
            : 'Connect désactivé'
          : newValue
            ? 'Découverte IA activée — visible sur ChatGPT, Perplexity & Google AI'
            : 'Découverte IA désactivée',
      );
      // Recharge le score après un toggle (l'activation peut changer le contexte)
      setTimeout(() => loadData(), 500);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour');
    } finally {
      setSaving(null);
    }
  }

  // ── États early ──────────────────────────────────────

  if (!orgId && !loading) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">
            Sélectionnez un restaurant pour configurer Connect.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <OnboardingLockBanner task="connect-identity" />
      {/* ── Header ────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            <h2 className="text-2xl font-semibold tracking-tight">Sokar Connect</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Votre présence en ligne + IA. Soyez trouvable et réservable sur Google, ChatGPT et les
            assistants IA.
          </p>
        </div>
        {/* Score circle */}
        {score && !loading && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 p-3">
            <ScoreCircle score={score.score} level={score.level} />
            <div className="max-w-[200px]">
              <p className="text-sm font-medium">
                {score.completed}/{score.total} étapes complétées
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{score.message}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Messages ──────────────────────────────────── */}
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

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : settings ? (
        <>
          {/* ── Layout 2 colonnes : État + Preview ─────── */}
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            {/* Colonne gauche : État + Découverte IA */}
            <div className="space-y-4">
              {/* Connect activé */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          'flex h-2.5 w-2.5 rounded-full',
                          settings.connectPublished
                            ? 'bg-green-500 shadow-[0_0_8px] shadow-green-500/50'
                            : 'bg-muted-foreground/40',
                        )}
                      />
                      Connect {settings.connectPublished ? 'activé' : 'inactif'}
                    </span>
                    <Switch
                      checked={settings.connectPublished}
                      disabled={saving !== null}
                      onCheckedChange={() => toggle('connectPublished')}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  {settings.connectPublished ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        Votre page est en ligne sur{' '}
                        <a
                          href={settings.pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-foreground underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                        >
                          {settings.pageUrl.replace('https://', '')}
                        </a>
                      </p>
                      {settings.connectPublishedAt && (
                        <p className="text-xs text-muted-foreground/60">
                          Actif depuis le{' '}
                          {new Date(settings.connectPublishedAt).toLocaleDateString('fr-FR', {
                            day: 'numeric',
                            month: 'long',
                            year: 'numeric',
                          })}
                        </p>
                      )}
                      {/* Stats preview */}
                      <div className="grid grid-cols-3 gap-2 pt-2">
                        <StatCard label="Vues" value="—" sub="7j" />
                        <StatCard label="Résa" value="—" sub="7j" />
                        <StatCard label="Conversion" value="—" sub="vue→résa" />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Lancez votre présence en ligne. Activez Connect pour que votre restaurant
                        soit trouvable et réservable sur Google, ChatGPT et les assistants IA.
                      </p>
                      {score && score.score < 60 && (
                        <div className="flex items-start gap-2 rounded-lg bg-orange-500/10 px-3 py-2 text-xs text-orange-600">
                          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span>
                            Votre profil est à {score.score}%. Complétez-le pour maximiser votre
                            visibilité avant d&apos;activer.
                          </span>
                        </div>
                      )}
                      <Button
                        size="sm"
                        onClick={() => toggle('connectPublished')}
                        disabled={saving !== null}
                        className="w-full transition-all duration-200"
                      >
                        <Zap className="mr-2 h-4 w-4" />
                        Activer Connect
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Découverte IA */}
              <Card
                className={cn(
                  'transition-all duration-200',
                  !settings.connectPublished && 'opacity-60',
                )}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-primary" />
                      Découverte IA
                    </span>
                    <Switch
                      checked={settings.connectAgentic}
                      disabled={saving !== null || !settings.connectPublished}
                      onCheckedChange={() => toggle('connectAgentic')}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {settings.connectAgentic ? (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Votre restaurant est visible par les assistants IA (ChatGPT, Perplexity,
                        Google AI). Les métadonnées structurées ReserveAction sont actives.
                      </p>
                      <div className="flex items-center gap-2 text-xs text-green-600">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Réservation directe depuis les IA</span>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Soyez trouvable sur ChatGPT, Perplexity et Google AI. Activez cette option
                        pour autoriser les crawlers d&apos;IA et exposer les métadonnées de
                        réservation.
                      </p>
                      {settings.connectPublished && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggle('connectAgentic')}
                          disabled={saving !== null}
                          className="w-full transition-all duration-200"
                        >
                          <Bot className="mr-2 h-4 w-4" />
                          Activer la découverte IA
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Colonne droite : Aperçu live */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Aperçu en direct</CardTitle>
                  {settings.connectPublished && (
                    <Button variant="ghost" size="sm" asChild>
                      <a
                        href={`${settings.pageUrl}?preview=1`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Plein écran
                      </a>
                    </Button>
                  )}
                </div>
                <CardDescription className="text-xs">
                  Voici ce que voient vos clients et Google.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {settings.connectPublished ? (
                  <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
                    <iframe
                      src={`${settings.pageUrl}?preview=1`}
                      title={`Aperçu — ${settings.name}`}
                      className="h-[420px] w-full"
                      loading="lazy"
                      sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                    />
                  </div>
                ) : (
                  <div className="flex h-[420px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 text-center">
                    <div className="space-y-3">
                      <Eye className="mx-auto h-10 w-10 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        Activez Connect pour voir votre page publique.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Complétude du profil ───────────────────── */}
          {score && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Complétude du profil
                </CardTitle>
                <CardDescription>
                  {score.completed}/{score.total} éléments complétés — {score.message}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {/* Barre de progression */}
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all duration-700 ease-out',
                      score.level === 'premium'
                        ? 'bg-green-500'
                        : score.level === 'almost'
                          ? 'bg-orange-400'
                          : 'bg-primary',
                    )}
                    style={{ width: `${score.score}%` }}
                  />
                </div>

                {/* Items en grille */}
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {score.items.map((item) => (
                    <div
                      key={item.key}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all duration-200',
                        item.done
                          ? 'border-green-500/20 bg-green-500/5 text-foreground'
                          : 'border-border bg-muted/20 text-muted-foreground',
                      )}
                    >
                      {item.done ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                      ) : (
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/30" />
                      )}
                      <span className="flex-1 truncate">{item.label}</span>
                      <span className="text-xs text-muted-foreground/50">+{item.weight}%</span>
                    </div>
                  ))}
                </div>

                {/* Actions rapides : top 3 manquants */}
                {score.missing.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Actions rapides
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {score.missing.slice(0, 3).map((item) => (
                        <Link
                          key={item.key}
                          href="/dashboard/settings"
                          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-xs font-medium text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-primary/5"
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                          {item.label}
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Impossible de charger les paramètres Connect.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
