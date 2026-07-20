'use client';

import { useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FloorPlanCanvas } from './_components/FloorPlanCanvas';
import { FloorPlanCrud } from './_components/FloorPlanCrud';

export default function FloorPlanPage() {
  const { orgId } = useApi();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeView = searchParams.get('view') === 'edit-plan' ? 'edit-plan' : 'service-live';
  const [designTab, setDesignTab] = useState<'visual' | 'crud'>('visual');

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

      {activeView === 'edit-plan' && (
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

      {activeView === 'service-live' && (
        <FloorPlanCanvas key="service-live" orgId={orgId} mode="service" />
      )}
      {activeView === 'edit-plan' && designTab === 'visual' && (
        <FloorPlanCanvas key="design-visual" orgId={orgId} mode="design" />
      )}
      {activeView === 'edit-plan' && designTab === 'crud' && <FloorPlanCrud key="design-crud" />}
    </div>
  );
}
