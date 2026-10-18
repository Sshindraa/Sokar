'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Choice = { value: string; label: string };

/** Liste déroulante de l’onboarding, lisible et cohérente avec ses contrôles. */
export function ChoiceSelect({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choisir…',
  triggerClassName,
  contentClassName,
  invalid,
}: {
  label: string;
  value: string;
  options: Choice[];
  onChange: (value: string) => void;
  placeholder?: string;
  triggerClassName?: string;
  contentClassName?: string;
  invalid?: boolean;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-10 rounded-xl border-border bg-background text-base text-foreground transition-all duration-200',
          triggerClassName,
        )}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        align="end"
        className={cn('rounded-xl border-border p-1 shadow-lg', contentClassName)}
      >
        <div className="flex flex-col gap-0.5">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="min-h-9 rounded-md py-2 pl-8 pr-3 text-sm font-medium text-foreground transition-all duration-200 focus:bg-accent focus:text-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
            >
              {option.label}
            </SelectItem>
          ))}
        </div>
      </SelectContent>
    </Select>
  );
}
