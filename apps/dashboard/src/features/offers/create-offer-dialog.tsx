'use client';

import Link from 'next/link';
import { ArrowRight, CalendarCheck, Gift, Ticket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const offerChoices = [
  {
    key: 'experience',
    href: '/dashboard/experiences?create=1',
    icon: CalendarCheck,
  },
  {
    key: 'event',
    href: '/dashboard/events?create=1',
    icon: Ticket,
  },
  {
    key: 'giftCard',
    href: '/dashboard/gift-cards?create=1',
    icon: Gift,
  },
] as const;

export function CreateOfferDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('offerChooser');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          {offerChoices.map(({ key, href, icon: Icon }) => (
            <Link
              key={key}
              href={href}
              onClick={() => onOpenChange(false)}
              className="group flex min-h-40 flex-col rounded-xl border border-border bg-card p-4 text-left transition-all duration-200 hover:border-foreground/25 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon
                className="mb-4 h-5 w-5 text-muted-foreground transition-colors group-hover:text-foreground"
                aria-hidden="true"
              />
              <span className="font-semibold text-foreground">{t(`${key}.title`)}</span>
              <span className="mt-2 text-sm leading-5 text-muted-foreground">
                {t(`${key}.description`)}
              </span>
              <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-foreground">
                {t(`${key}.action`)}
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
            </Link>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
