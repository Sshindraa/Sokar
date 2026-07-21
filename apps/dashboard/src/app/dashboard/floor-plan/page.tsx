'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useApi } from '@/lib/api';
import { getErrorMessage, type FloorPlan, type FloorPlanSummary } from '@/types/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FloorPlanCanvas } from './_components/FloorPlanCanvas';
import { FloorPlanCrud } from './_components/FloorPlanCrud';
import { FloorPlanSelector } from './_components/FloorPlanSelector';
import { ServiceCopilotSimulator } from './_components/ServiceCopilotSimulator';

function getDefaultFloorPlan(floorPlans: FloorPlanSummary[]): FloorPlanSummary | null {
  return (
    floorPlans.find((fp) => fp.isDefault && fp.isActive) ??
    floorPlans.find((fp) => fp.isActive) ??
    floorPlans[0] ??
    null
  );
}

export default function FloorPlanPage() {
  const { orgId, get, post } = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeView = searchParams.get('view') === 'edit-plan' ? 'edit-plan' : 'service-live';
  const [designTab, setDesignTab] = useState<'visual' | 'crud'>('visual');

  const [floorPlans, setFloorPlans] = useState<FloorPlanSummary[] | null>(null);
  const [selectedFloorPlanId, setSelectedFloorPlanId] = useState<string | null>(null);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(true);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createIsDefault, setCreateIsDefault] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);

  const setView = (view: 'service-live' | 'edit-plan') => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === 'service-live') {
      params.delete('view');
    } else {
      params.set('view', view);
    }
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
  };

  const loadFloorPlans = useCallback(async () => {
    if (!orgId) return;
    setListLoading(true);
    setListError('');
    try {
      const data = await get<FloorPlanSummary[]>(`restaurants/${orgId}/floor-plans`);
      setFloorPlans(data);
      const defaultPlan = getDefaultFloorPlan(data);
      setSelectedFloorPlanId((prev) => prev ?? defaultPlan?.id ?? null);
    } catch (err) {
      setListError(getErrorMessage(err, 'Impossible de charger les plans de salle'));
    } finally {
      setListLoading(false);
    }
  }, [orgId, get]);

  useEffect(() => {
    void loadFloorPlans();
  }, [loadFloorPlans]);

  async function handleCreateFloorPlan(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId || !createName.trim()) return;
    setCreateLoading(true);
    setListError('');
    try {
      const created = await post<FloorPlan>(`restaurants/${orgId}/floor-plans`, {
        name: createName.trim(),
        isDefault: createIsDefault,
      });
      await loadFloorPlans();
      setSelectedFloorPlanId(created.id);
      setCreateDialogOpen(false);
      setCreateName('');
      setCreateIsDefault(false);
    } catch (err) {
      setListError(getErrorMessage(err, 'Impossible de créer le plan de salle'));
    } finally {
      setCreateLoading(false);
    }
  }

  if (!orgId) {
    return (
      <div className="p-6 md:p-8">
        <Card className="sokar-card">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Skeleton className="mx-auto h-8 w-48 rounded-full" />
            <p className="mt-4 text-sm">Chargement de l&apos;organisation...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            {activeView === 'edit-plan' ? 'Salle édition' : 'Live service'}
          </h1>
          <p className="text-sm text-muted-foreground">
            {activeView === 'edit-plan'
              ? 'Concevez et organisez le plan de votre salle.'
              : 'Pilotez le service en temps réel sans modifier le plan.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={activeView === 'service-live' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('service-live')}
            aria-pressed={activeView === 'service-live'}
          >
            Live service
          </Button>
          <Button
            type="button"
            variant={activeView === 'edit-plan' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setView('edit-plan')}
            aria-pressed={activeView === 'edit-plan'}
          >
            Salle édition
          </Button>
        </div>
      </div>

      {listError ? (
        <div className="sokar-error">
          <p className="text-sm">{listError}</p>
        </div>
      ) : null}

      {listLoading || floorPlans === null ? (
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-64 rounded-lg" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
      ) : floorPlans.length === 0 ? (
        <div className="sokar-empty">
          <p className="text-sm">Aucun plan de salle</p>
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            className="mt-4"
          >
            Créer un plan
          </Button>
        </div>
      ) : (
        <FloorPlanSelector
          floorPlans={floorPlans}
          selectedId={selectedFloorPlanId ?? undefined}
          onSelect={setSelectedFloorPlanId}
          onCreate={() => setCreateDialogOpen(true)}
        />
      )}

      {activeView === 'edit-plan' && selectedFloorPlanId && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={designTab === 'visual' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDesignTab('visual')}
            aria-pressed={designTab === 'visual'}
          >
            Plan visuel
          </Button>
          <Button
            type="button"
            variant={designTab === 'crud' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDesignTab('crud')}
            aria-pressed={designTab === 'crud'}
          >
            Sections & tables
          </Button>
        </div>
      )}

      {selectedFloorPlanId && activeView === 'service-live' && (
        <ServiceCopilotSimulator
          key={`simulator-${selectedFloorPlanId}`}
          orgId={orgId}
          selectedFloorPlanId={selectedFloorPlanId}
        />
      )}
      {selectedFloorPlanId && activeView === 'service-live' && (
        <FloorPlanCanvas
          key={`service-live-${selectedFloorPlanId}`}
          orgId={orgId}
          mode="service"
          floorPlanId={selectedFloorPlanId}
        />
      )}
      {selectedFloorPlanId && activeView === 'edit-plan' && designTab === 'visual' && (
        <FloorPlanCanvas
          key={`design-visual-${selectedFloorPlanId}`}
          orgId={orgId}
          mode="design"
          floorPlanId={selectedFloorPlanId}
        />
      )}
      {selectedFloorPlanId && activeView === 'edit-plan' && designTab === 'crud' && (
        <FloorPlanCrud
          key={`design-crud-${selectedFloorPlanId}`}
          floorPlanId={selectedFloorPlanId}
        />
      )}

      {!selectedFloorPlanId && !listLoading && (
        <div className="sokar-empty">
          <p className="text-sm">Aucun plan de salle sélectionné.</p>
        </div>
      )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateFloorPlan}>
            <DialogHeader>
              <DialogTitle>Créer un plan de salle</DialogTitle>
              <DialogDescription>
                Donnez un nom au nouveau plan. Vous pouvez le définir comme plan par défaut.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="floor-plan-name">Nom du plan</Label>
                <Input
                  id="floor-plan-name"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="Ex. : Terrasse"
                  disabled={createLoading}
                  className="bg-card border-border"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Plan par défaut</p>
                  <p className="text-xs text-muted-foreground">
                    Ce plan sera celui utilisé par défaut pour le service.
                  </p>
                </div>
                <Switch
                  checked={createIsDefault}
                  onCheckedChange={setCreateIsDefault}
                  disabled={createLoading}
                  aria-label="Définir comme plan par défaut"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
                disabled={createLoading}
              >
                Annuler
              </Button>
              <Button type="submit" disabled={!createName.trim() || createLoading}>
                Créer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
