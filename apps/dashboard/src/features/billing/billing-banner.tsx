'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { BillingStatus } from '@/types/api';

/** The trial banner appears in the last days only, to stay out of the way before. */
const TRIAL_REMINDER_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

export function trialDaysLeft(currentPeriodEnd: string | null, now = Date.now()): number | null {
  if (!currentPeriodEnd) return null;
  const end = new Date(currentPeriodEnd).getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
}

/**
 * Dashboard-wide billing banner: the last days of a free trial, then a suspended service once
 * the subscription has ended. Renders nothing while loading, on error, or when all is well.
 */
export function BillingBanner() {
  const { get, isSignedIn } = useApi();
  const [status, setStatus] = useState<BillingStatus | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    void get<BillingStatus>('billing/status')
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        // Billing is informative here: an unavailable status must not block the dashboard.
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [get, isSignedIn]);

  if (!status) return null;

  if (status.suspended) {
    return (
      <BannerFrame tone="danger">
        <span>
          Votre abonnement est terminé : l’assistant téléphonique ne répond plus aux appels.
        </span>
        <BannerLink href="/pricing">Choisir une formule</BannerLink>
      </BannerFrame>
    );
  }

  if (status.subscriptionStatus === 'trialing') {
    const daysLeft = trialDaysLeft(status.currentPeriodEnd);
    if (daysLeft === null || daysLeft > TRIAL_REMINDER_DAYS) return null;
    const when =
      daysLeft === 0 ? 'aujourd’hui' : daysLeft === 1 ? 'demain' : `dans ${daysLeft} jours`;
    return (
      <BannerFrame tone="warning">
        <span>
          Votre essai gratuit se termine {when}. Ajoutez une carte bancaire pour que l’assistant
          continue de répondre.
        </span>
        <BannerLink href="/dashboard/settings#settings-plan">Ajouter une carte</BannerLink>
      </BannerFrame>
    );
  }

  return null;
}

function BannerFrame({
  tone,
  children,
}: {
  tone: 'warning' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'mb-6 flex flex-col gap-3 rounded-2xl border p-4 text-sm transition-all duration-200 sm:flex-row sm:items-center sm:justify-between',
        tone === 'danger'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-warning/30 bg-warning/10 text-warning',
      )}
    >
      {children}
    </div>
  );
}

function BannerLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="shrink-0 rounded-full border border-current px-4 py-2 font-medium transition-all duration-200 hover:bg-background/40"
    >
      {children}
    </Link>
  );
}
