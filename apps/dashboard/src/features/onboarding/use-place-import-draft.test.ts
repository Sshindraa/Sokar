import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { usePlaceImportDraft } from './use-place-import-draft';
import type { PlaceImportDraft } from './onboarding-provider';

const draft: PlaceImportDraft = {
  placeId: 'place-1',
  name: 'Le Bistrot',
  phoneE164: '+33123456789',
  formattedAddress: '12 rue de la République',
  postalCode: '69002',
  city: 'Lyon',
  country: 'FR',
  openingHours: { mon: { open: '11:30', close: '14:00' } },
  hoursNeedReview: ['tue'],
};

beforeEach(() => sessionStorage.clear());

it('restores the imported address, hours and review markers after a remount', () => {
  const first = renderHook(() => usePlaceImportDraft('restaurant-a'));
  act(() => first.result.current[1](draft));
  first.unmount();
  const restored = renderHook(() => usePlaceImportDraft('restaurant-a'));
  expect(restored.result.current[0]).toEqual(draft);
  act(() => restored.result.current[1](null));
  restored.unmount();
  expect(renderHook(() => usePlaceImportDraft('restaurant-a')).result.current[0]).toBeNull();
});

it('does not reuse one restaurant’s import when the active site changes', () => {
  const hook = renderHook(({ scope }) => usePlaceImportDraft(scope), {
    initialProps: { scope: 'restaurant-a' },
  });
  act(() => hook.result.current[1](draft));
  hook.rerender({ scope: 'restaurant-b' });
  expect(hook.result.current[0]).toBeNull();
  act(() => hook.result.current[1]({ ...draft, placeId: 'place-2' }));
  hook.rerender({ scope: 'restaurant-a' });
  expect(hook.result.current[0]?.placeId).toBe('place-1');
});

it('ignores corrupt stored imports and permits a new selection', () => {
  sessionStorage.setItem(
    'sokar:onboarding:place:v1:restaurant-a',
    JSON.stringify({ ...draft, openingHours: { mon: { open: 12 } } }),
  );
  const hook = renderHook(() => usePlaceImportDraft('restaurant-a'));
  expect(hook.result.current[0]).toBeNull();
  act(() => hook.result.current[1](draft));
  expect(hook.result.current[0]).toEqual(draft);
});
