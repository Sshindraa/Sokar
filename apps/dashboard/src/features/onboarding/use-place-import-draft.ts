'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import type { PlaceImportDraft } from './onboarding-provider';

const slotSchema = z.object({
  open: z.string(),
  close: z.string(),
  lastBooking: z.string().optional(),
});
const draftSchema = z.object({
  placeId: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  phoneE164: z.string(),
  formattedAddress: z.string(),
  postalCode: z.string(),
  city: z.string(),
  country: z.string(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  openingHours: z.record(
    z.string(),
    slotSchema
      .extend({
        slots: z.array(slotSchema).optional(),
        services: z.array(slotSchema).optional(),
      })
      .nullable(),
  ),
  hoursNeedReview: z.array(z.string()),
});

/** Restore an import on reload in this tab, isolated by restaurant. */
export function usePlaceImportDraft(scope: string | undefined) {
  const storageKey = scope ? `sokar:onboarding:place:v1:${scope}` : null;
  const [cached, setCached] = useState<{
    key: string | null;
    draft: PlaceImportDraft | null;
  } | null>(null);

  useEffect(() => {
    let draft: PlaceImportDraft | null = null;
    if (storageKey) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed = draftSchema.safeParse(JSON.parse(raw));
          if (parsed.success) draft = parsed.data;
          else sessionStorage.removeItem(storageKey);
        }
      } catch {
        // Storage can be unavailable; the in-memory import remains usable.
      }
    }
    setCached({ key: storageKey, draft });
  }, [storageKey]);

  const setDraft = useCallback(
    (draft: PlaceImportDraft | null) => {
      setCached({ key: storageKey, draft });
      if (!storageKey) return;
      try {
        if (draft) sessionStorage.setItem(storageKey, JSON.stringify(draft));
        else sessionStorage.removeItem(storageKey);
      } catch {
        // Keep the import in memory when browser storage is unavailable.
      }
    },
    [storageKey],
  );

  return [cached?.key === storageKey ? cached.draft : null, setDraft] as const;
}
