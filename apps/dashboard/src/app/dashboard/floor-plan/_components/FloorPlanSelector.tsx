'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FloorPlanSummary } from '@/types/api';
import { cn } from '@/lib/utils';

interface FloorPlanSelectorProps {
  floorPlans: FloorPlanSummary[];
  selectedId?: string;
  onSelect: (floorPlanId: string) => void;
  onCreate?: () => void;
}

export function FloorPlanSelector({
  floorPlans,
  selectedId,
  onSelect,
  onCreate,
}: FloorPlanSelectorProps) {
  const selected = floorPlans.find((fp) => fp.id === selectedId) ?? floorPlans[0];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selected?.id} onValueChange={onSelect}>
        <SelectTrigger
          className={cn(
            'h-9 min-w-0 bg-card border-border text-sm sm:max-w-[26rem]',
            onCreate ? 'flex-1 sm:w-auto' : 'w-full sm:w-auto',
          )}
          aria-label="Plan de salle sélectionné"
        >
          <SelectValue placeholder="Sélectionnez un plan de salle">
            {selected ? (
              <span className="flex min-w-0 items-center gap-2 truncate">
                <span className="truncate">{selected.name}</span>
                {selected.isDefault && <Badge variant="outline">Par défaut</Badge>}
                <Badge variant={selected.isActive ? 'default' : 'secondary'}>
                  {selected.isActive ? 'Actif' : 'Inactif'}
                </Badge>
              </span>
            ) : (
              'Sélectionnez un plan de salle'
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          {floorPlans.map((fp) => (
            <SelectItem key={fp.id} value={fp.id}>
              <span className="flex items-center gap-2">
                <span className="truncate">{fp.name}</span>
                {fp.isDefault && <Badge variant="outline">Par défaut</Badge>}
                <Badge variant={fp.isActive ? 'default' : 'secondary'}>
                  {fp.isActive ? 'Actif' : 'Inactif'}
                </Badge>
                {fp.tableCount > 0 && (
                  <span className="text-xs text-muted-foreground">({fp.tableCount} tables)</span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {onCreate && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCreate}
          className="h-9 shrink-0 transition-all duration-200"
          title={
            selected
              ? `Créer un plan de salle supplémentaire — vous modifiez actuellement « ${selected.name} »`
              : 'Créer un plan de salle supplémentaire'
          }
        >
          <Plus size={16} className="mr-1" />
          Créer un nouveau plan
        </Button>
      )}
    </div>
  );
}
