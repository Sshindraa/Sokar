'use client';

import { useState } from 'react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { LayoutGrid, CalendarDays, BarChart3, Map } from 'lucide-react';
import { FloorPlanCrud } from './_components/FloorPlanCrud';
import { FloorPlanCanvas } from './_components/FloorPlanCanvas';
import { PlanningTab } from './_components/PlanningTab';
import { StatsTab } from './_components/StatsTab';

type TabKey = 'plan-2d' | 'floor-plan' | 'planning' | 'stats';

const tabs: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'plan-2d', label: 'Plan 2D', icon: <Map size={18} /> },
  { key: 'floor-plan', label: 'Plan de salle', icon: <LayoutGrid size={18} /> },
  { key: 'planning', label: 'Planning du jour', icon: <CalendarDays size={18} /> },
  { key: 'stats', label: 'Stats rapides', icon: <BarChart3 size={18} /> },
];

export default function FloorPlanPage() {
  const { orgId } = useApi();
  const [activeTab, setActiveTab] = useState<TabKey>('plan-2d');

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
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Plan de salle</h1>
          <p className="text-sm text-muted-foreground">
            Gérez votre plan de salle, le planning du jour et les statistiques.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'gap-2 transition-all duration-200',
                activeTab === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'border-border bg-card',
              )}
            >
              {tab.icon}
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {activeTab === 'plan-2d' && <FloorPlanCanvas orgId={orgId} />}
      {activeTab === 'floor-plan' && <FloorPlanCrud />}
      {activeTab === 'planning' && <PlanningTab orgId={orgId} />}
      {activeTab === 'stats' && <StatsTab orgId={orgId} />}
    </div>
  );
}
