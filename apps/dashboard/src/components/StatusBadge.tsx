import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Cinq niveaux de sens, un remplissage fixe par niveau. Le niveau se choisit par sens, jamais par goût.
export type StatusLevel = 'action' | 'progress' | 'done' | 'neutral' | 'error';

const LEVEL_CLASS: Record<StatusLevel, string> = {
  // Action requise : à traiter par l'équipe.
  action: 'border-transparent bg-warning text-warning-foreground',
  // En cours ou actif : contour appuyé, sans aplat.
  progress: 'border-2 border-foreground bg-transparent text-foreground',
  // Terminé ou succès.
  done: 'border-transparent bg-foreground text-background',
  // Neutre ou archivé.
  neutral: 'border-transparent bg-secondary text-secondary-foreground',
  // Erreur ou annulé.
  error: 'border-transparent bg-destructive text-destructive-foreground',
};

export function StatusBadge({
  level,
  className,
  children,
}: {
  level: StatusLevel;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-status-level={level}
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        LEVEL_CLASS[level],
        className,
      )}
    >
      {children}
    </span>
  );
}
