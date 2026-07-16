'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PencilRuler, Radio } from 'lucide-react';
import { FloorPlanCanvas } from './_components/FloorPlanCanvas';

export default function FloorPlanPage() {
  const { orgId } = useApi();
  const searchParams = useSearchParams();
  const activeView = searchParams.get('view') === 'edit-plan' ? 'edit-plan' : 'service-live';

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
        <div className="flex gap-2 md:hidden">
          <Button asChild variant={activeView === 'service-live' ? 'default' : 'outline'} size="sm">
            <Link href="/dashboard/floor-plan?view=service-live" className="gap-2">
              <Radio size={16} />
              Live service
            </Link>
          </Button>
          <Button asChild variant={activeView === 'edit-plan' ? 'default' : 'outline'} size="sm">
            <Link href="/dashboard/floor-plan?view=edit-plan" className="gap-2">
              <PencilRuler size={16} />
              Salle édition
            </Link>
          </Button>
        </div>
      </div>

      {activeView === 'service-live' && (
        <FloorPlanCanvas key="service-live" orgId={orgId} mode="service" />
      )}
      {activeView === 'edit-plan' && (
        <FloorPlanCanvas key="edit-plan" orgId={orgId} mode="design" />
      )}
    </div>
  );
}
