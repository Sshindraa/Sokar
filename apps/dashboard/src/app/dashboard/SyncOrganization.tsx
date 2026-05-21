'use client';

import { useAuth, useOrganization } from '@clerk/nextjs';
import { useEffect, useRef } from 'react';

/**
 * SyncOrganization — appelle POST /api/auth/sync au montage
 * pour s'assurer que l'organisation Clerk existe dans PostgreSQL.
 * Idempotent : ne crée le restaurant qu'une seule fois.
 */
export function SyncOrganization() {
  const { isSignedIn, getToken } = useAuth();
  const { organization } = useOrganization();
  const synced = useRef(false);

  useEffect(() => {
    if (!isSignedIn || !organization || synced.current) return;

    synced.current = true;

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/auth/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (res.ok) {
          const data = await res.json();
          console.log('[sync] Organization synced:', data.restaurant?.name);
        } else {
          const err = await res.json();
          console.warn('[sync] Failed:', err);
        }
      } catch (err) {
        console.warn('[sync] Error:', err);
      }
    })();
  }, [isSignedIn, organization, getToken]);

  return null; // Ce composant ne rend rien
}
