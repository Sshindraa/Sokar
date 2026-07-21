'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Search, MapPin, Clock, Users, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { useApi } from '@/lib/api';
import {
  getErrorMessage,
  type FloorPlan,
  type SimulationResult,
  type SimulationScenario,
} from '@/types/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ServiceCopilotSimulatorProps {
  orgId: string;
  selectedFloorPlanId?: string;
}

function getDefaultStartsAt(): string {
  const now = new Date();
  const d = new Date(now.getTime() + 30 * 60 * 1000);
  const rounded = Math.ceil(d.getMinutes() / 30) * 30;
  d.setMinutes(rounded, 0, 0);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatIso(iso: string): string {
  return format(parseISO(iso), 'dd MMM HH:mm', { locale: fr });
}

function ScenarioCard({ scenario, isBest }: { scenario: SimulationScenario; isBest: boolean }) {
  const isFeasible = scenario.feasible;
  const Icon = isFeasible ? CheckCircle2 : scenario.type === 'refuse' ? AlertCircle : XCircle;
  const iconColor = isFeasible
    ? 'text-success'
    : scenario.type === 'refuse'
      ? 'text-warning'
      : 'text-muted-foreground';

  return (
    <Card
      className={cn(
        'transition-all duration-200',
        isBest ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <Icon size={20} className={cn('mt-0.5 shrink-0', iconColor)} />
          <div className="flex-1 space-y-1">
            <h3 className="font-semibold leading-tight text-foreground">{scenario.title}</h3>
            <p className="text-sm text-muted-foreground">{scenario.reason}</p>
          </div>
        </div>

        {scenario.table && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
            <MapPin size={14} className="text-muted-foreground" />
            <span className="font-medium">{scenario.table.name}</span>
            <span className="text-muted-foreground">({scenario.table.capacity} couverts)</span>
            {scenario.table.sectionName && (
              <span className="text-muted-foreground">— {scenario.table.sectionName}</span>
            )}
          </div>
        )}

        {scenario.nextAvailableAt && (
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Clock size={14} className="text-muted-foreground" />
            <span>Prochain créneau : {formatIso(scenario.nextAvailableAt)}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {scenario.actions.map((action, idx) =>
            action.type === 'link' && action.href ? (
              <Link
                key={idx}
                href={action.href}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-all duration-200 hover:bg-accent"
              >
                {action.label}
              </Link>
            ) : action.type === 'api' ? (
              <Button
                key={idx}
                type="button"
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  // Les actions API sont volontairement non exécutées ici ;
                  // la simulation reste une prévisualisation read-only.
                }}
              >
                {action.label}
              </Button>
            ) : null,
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ServiceCopilotSimulator({
  orgId,
  selectedFloorPlanId,
}: ServiceCopilotSimulatorProps) {
  const { get, post } = useApi();
  const [partySize, setPartySize] = useState<number>(2);
  const [startsAt, setStartsAt] = useState<string>(getDefaultStartsAt());
  const [endsAt, setEndsAt] = useState<string>('');
  const [preferredSectionId, setPreferredSectionId] = useState<string>('');

  const [sections, setSections] = useState<FloorPlan['sections']>([]);
  const [sectionsLoading, setSectionsLoading] = useState(false);

  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!orgId || !selectedFloorPlanId) {
      setSections([]);
      setPreferredSectionId('');
      return;
    }

    let mounted = true;
    async function loadSections() {
      setSectionsLoading(true);
      try {
        const data = await get<FloorPlan>(
          `restaurants/${orgId}/floor-plans/${selectedFloorPlanId}`,
        );
        if (mounted) {
          setSections(data.sections ?? []);
        }
      } catch {
        if (mounted) setSections([]);
      } finally {
        if (mounted) setSectionsLoading(false);
      }
    }
    void loadSections();
    return () => {
      mounted = false;
    };
  }, [orgId, selectedFloorPlanId, get]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;

    setLoading(true);
    setError('');
    try {
      const body = {
        partySize: Number(partySize),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        preferredSectionId: preferredSectionId || undefined,
      };
      const data = await post<SimulationResult>(
        `restaurants/${orgId}/service-copilot/simulate`,
        body,
      );
      setResult(data);
    } catch (err) {
      setError(getErrorMessage(err, 'Impossible de simuler ce scénario'));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-5 p-5">
        <div className="flex items-center gap-2">
          <Search size={18} className="text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Simulateur de service</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          &ldquo;Puis-je accueillir ce groupe ?&rdquo; — testez les scénarios direct, changement de
          section et prochain créneau.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="sim-party-size" className="flex items-center gap-1.5">
                <Users size={14} />
                Couverts
              </Label>
              <Input
                id="sim-party-size"
                type="number"
                min={1}
                max={99}
                value={partySize}
                onChange={(e) => setPartySize(Number(e.target.value))}
                className="bg-card"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sim-starts-at" className="flex items-center gap-1.5">
                <Clock size={14} />
                Arrivée
              </Label>
              <Input
                id="sim-starts-at"
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="bg-card"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sim-ends-at" className="flex items-center gap-1.5">
                <Clock size={14} />
                Départ (optionnel)
              </Label>
              <Input
                id="sim-ends-at"
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                placeholder="Durée par défaut du restaurant"
                className="bg-card"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sim-section" className="flex items-center gap-1.5">
                <MapPin size={14} />
                Section préférée
              </Label>
              {sectionsLoading ? (
                <Skeleton className="h-10 w-full rounded-md" />
              ) : (
                <Select
                  value={preferredSectionId || '__all__'}
                  onValueChange={(value) => setPreferredSectionId(value === '__all__' ? '' : value)}
                >
                  <SelectTrigger id="sim-section" className="bg-card">
                    <SelectValue placeholder="Toutes les sections" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Toutes les sections</SelectItem>
                    {sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={loading}>
              {loading ? 'Simulation...' : 'Simuler'}
            </Button>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </form>

        {result ? (
          <div className="space-y-4">
            <div
              className={cn(
                'rounded-xl border p-4 transition-all duration-200',
                result.feasible
                  ? 'border-success/20 bg-success/[0.04]'
                  : 'border-warning/20 bg-warning/[0.04]',
              )}
            >
              <div className="flex items-start gap-3">
                {result.feasible ? (
                  <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-success" />
                ) : (
                  <AlertCircle size={20} className="mt-0.5 shrink-0 text-warning" />
                )}
                <p className="text-sm font-medium leading-relaxed text-foreground">
                  {result.explanation}
                </p>
              </div>
            </div>

            {result.scenarios.length > 0 ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {result.scenarios.map((scenario) => (
                  <ScenarioCard
                    key={scenario.id}
                    scenario={scenario}
                    isBest={scenario.id === result.bestScenarioId}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun scénario retourné.</p>
            )}
          </div>
        ) : (
          <div className="sokar-empty">
            <p className="text-sm text-muted-foreground">
              Remplissez les critères et cliquez sur Simuler pour obtenir une recommandation.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
