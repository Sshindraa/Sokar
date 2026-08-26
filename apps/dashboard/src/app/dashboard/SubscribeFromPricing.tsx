'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useApi } from '@/lib/api';

const PLANS = ['essential', 'pro', 'multi-site'] as const;
const BILLING = ['monthly', 'annual'] as const;

type Plan = (typeof PLANS)[number];
type Billing = (typeof BILLING)[number];

function isPlan(value: string | null): value is Plan {
  return value !== null && (PLANS as readonly string[]).includes(value);
}

function isBilling(value: string | null): value is Billing {
  return value !== null && (BILLING as readonly string[]).includes(value);
}

/** Starts the hosted Stripe Checkout after Clerk has created the restaurant. */
export function SubscribeFromPricing() {
  const searchParams = useSearchParams();
  const { orgId, post } = useApi();
  const attempted = useRef<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const planParam = searchParams.get('subscribe_plan');
  const billingParam = searchParams.get('billing');
  const plan = isPlan(planParam) ? planParam : null;
  const billing = isBilling(billingParam) ? billingParam : null;
  const requestKey = plan && billing && orgId ? `${orgId}:${plan}:${billing}` : null;

  useEffect(() => {
    if (!requestKey || !plan || !billing || attempted.current === requestKey) return;
    attempted.current = requestKey;
    setError(null);

    void (async () => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const session = await post<{ url: string }>('billing/checkout-session', {
            plan,
            billing,
          });
          if (!session.url) throw new Error('La page de paiement est indisponible.');
          window.location.assign(session.url);
          return;
        } catch (reason: unknown) {
          // SyncOrganization creates the restaurant in parallel on first login.
          // A short bounded retry closes that harmless race without retrying
          // Stripe configuration or provider errors.
          const message = reason instanceof Error ? reason.message : '';
          if (message !== 'Restaurant introuvable.' || attempt === 3) {
            setError(message || 'Impossible de préparer la souscription.');
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
    })();
  }, [billing, orgId, plan, post, requestKey, retry]);

  if (!requestKey || !error) {
    return requestKey ? (
      <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
        <div className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-sm text-muted-foreground shadow-xl backdrop-blur-xl">
          <Loader2 className="h-4 w-4 animate-spin" />
          Préparation de votre souscription…
        </div>
      </div>
    ) : null;
  }

  return (
    <div className="fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
      <div
        role="alert"
        className="flex max-w-xl items-center gap-3 rounded-2xl border border-destructive/30 bg-card px-4 py-3 text-sm text-foreground shadow-xl"
      >
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="flex-1">{error}</span>
        <button
          type="button"
          onClick={() => {
            attempted.current = null;
            setRetry((value) => value + 1);
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 font-medium transition-all duration-200 hover:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Réessayer
        </button>
      </div>
    </div>
  );
}
