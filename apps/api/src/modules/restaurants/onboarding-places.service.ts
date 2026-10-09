import { normalizePhone } from '@sokar/shared';
import { deriveDisplayName } from './place-display-name';

const PLACES_API = 'https://places.googleapis.com/v1';

type GoogleText = { text?: string };
type GoogleComponent = { longText?: string; shortText?: string; types?: string[] };
type GooglePeriod = {
  open?: { day?: number; hour?: number; minute?: number };
  close?: { day?: number; hour?: number; minute?: number };
};

export type PlaceSuggestion = { placeId: string; mainText: string; secondaryText: string };
export type PlaceImportDetails = {
  placeId: string;
  name: string;
  /** Nom commercial déduit du nom Google (sans ville ni quartier), modifiable par le restaurateur. */
  displayName: string;
  formattedAddress: string;
  postalCode: string;
  city: string;
  country: string;
  lat?: number;
  lng?: number;
  phoneE164: string;
  openingHours: Record<
    string,
    { open: string; close: string; slots?: Array<{ open: string; close: string }> } | null
  >;
  hoursNeedReview: string[];
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const FIELD_MASK =
  'displayName,formattedAddress,addressComponents,internationalPhoneNumber,regularOpeningHours,location';

function apiKey() {
  return process.env.GOOGLE_PLACES_API_KEY?.trim();
}

export function isPlacesConfigured() {
  return Boolean(apiKey());
}

export function isOnboardingPlacesEnabled() {
  return process.env.GOOGLE_PLACES_ONBOARDING_ENABLED === 'true' && isPlacesConfigured();
}

async function placesFetch(url: string, init: RequestInit) {
  const key = apiKey();
  if (!key) throw new Error('GOOGLE_PLACES_NOT_CONFIGURED');
  const response = await fetch(url, {
    ...init,
    headers: {
      'X-Goog-Api-Key': key,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`GOOGLE_PLACES_HTTP_${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

export async function searchOnboardingPlaces(input: string, sessionToken: string) {
  const data = await placesFetch(`${PLACES_API}/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input,
      sessionToken,
      languageCode: 'fr',
      includedRegionCodes: ['fr'],
      includedPrimaryTypes: ['restaurant'],
    }),
  });

  const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
  return suggestions
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const prediction = (item as { placePrediction?: Record<string, unknown> }).placePrediction;
      const placeId = prediction?.placeId;
      if (typeof placeId !== 'string' || !/^[\w-]{5,200}$/.test(placeId)) return [];
      const text = prediction?.text as GoogleText | undefined;
      const structured = prediction?.structuredFormat as
        | { mainText?: GoogleText; secondaryText?: GoogleText }
        | undefined;
      return [
        {
          placeId,
          mainText: structured?.mainText?.text ?? text?.text ?? '',
          secondaryText: structured?.secondaryText?.text ?? '',
        } satisfies PlaceSuggestion,
      ];
    })
    .filter((suggestion) => suggestion.mainText);
}

function formatTime(hour: number | undefined, minute: number | undefined) {
  if (hour == null || minute == null || hour < 0 || hour > 23 || minute < 0 || minute > 59)
    return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function mapHours(periods: GooglePeriod[] | undefined) {
  const hours: PlaceImportDetails['openingHours'] = Object.fromEntries(
    DAY_KEYS.map((day) => [day, null]),
  );
  const review = new Set<string>();
  const grouped = new Map<number, Array<{ open: string; close: string }>>();
  const sourcePeriods = periods ?? [];

  for (const period of sourcePeriods) {
    const openDay = period.open?.day;
    const open = formatTime(period.open?.hour, period.open?.minute);
    if (openDay == null || openDay < 0 || openDay > 6) {
      for (const day of DAY_KEYS) review.add(day);
      continue;
    }
    const key = DAY_KEYS[openDay];
    if (!open || !period.close) {
      // Open-ended and malformed periods require a deliberate restaurant-side choice.
      review.add(key);
      continue;
    }
    const close = formatTime(period.close.hour, period.close.minute);
    const closeDay = period.close.day;
    if (!close || closeDay == null || closeDay < 0 || closeDay > 6) {
      review.add(key);
      continue;
    }
    const dayOffset = (closeDay - openDay + 7) % 7;
    const openMinutes = period.open!.hour! * 60 + period.open!.minute!;
    const closeMinutes = period.close.hour! * 60 + period.close.minute!;
    const overnight = dayOffset === 1;
    if (
      dayOffset > 1 ||
      (overnight && (closeMinutes > 6 * 60 || closeMinutes >= openMinutes)) ||
      (!overnight && closeMinutes <= openMinutes)
    ) {
      review.add(key);
      continue;
    }
    const daySlots = grouped.get(openDay) ?? [];
    daySlots.push({ open, close });
    grouped.set(openDay, daySlots);
  }

  if (sourcePeriods.length === 0) {
    for (const day of DAY_KEYS) review.add(day);
  }

  for (const [dayIndex, slots] of grouped) {
    const key = DAY_KEYS[dayIndex];
    if (review.has(key)) continue;
    slots.sort((a, b) => a.open.localeCompare(b.open));
    if (slots.length > 2) {
      // The onboarding editor supports at most two services. Never merge
      // distinct periods into a wider window that could offer closed-time slots.
      hours[key] = null;
      review.add(key);
      continue;
    }
    const first = slots[0];
    const last = slots[slots.length - 1];
    hours[key] =
      slots.length === 1
        ? { open: first.open, close: first.close }
        : { open: first.open, close: last.close, slots };
  }

  return { hours, hoursNeedReview: [...review] };
}

export async function getOnboardingPlaceDetails(placeId: string, sessionToken: string) {
  if (!/^[\w-]{5,200}$/.test(placeId)) throw new Error('INVALID_PLACE_ID');
  const params = new URLSearchParams({ languageCode: 'fr', sessionToken });
  const data = await placesFetch(`${PLACES_API}/places/${encodeURIComponent(placeId)}?${params}`, {
    method: 'GET',
    headers: { 'X-Goog-FieldMask': FIELD_MASK },
  });
  const components = Array.isArray(data.addressComponents)
    ? (data.addressComponents as GoogleComponent[])
    : [];
  const component = (type: string) => components.find((item) => item.types?.includes(type));
  const streetAddress = [
    component('street_number')?.longText,
    component('route')?.longText,
    component('subpremise')?.longText,
  ]
    .filter(Boolean)
    .join(' ');
  const mapped = mapHours(
    (data.regularOpeningHours as { periods?: GooglePeriod[] } | undefined)?.periods,
  );
  const googleName = (data.displayName as GoogleText | undefined)?.text ?? '';
  const city =
    component('locality')?.longText ??
    component('postal_town')?.longText ??
    component('administrative_area_level_3')?.longText ??
    component('administrative_area_level_2')?.longText ??
    '';
  const postalCode = component('postal_code')?.longText ?? '';

  const location = data.location as { latitude?: number; longitude?: number } | undefined;
  const coordinates =
    typeof location?.latitude === 'number' &&
    Number.isFinite(location.latitude) &&
    Math.abs(location.latitude) <= 90 &&
    typeof location.longitude === 'number' &&
    Number.isFinite(location.longitude) &&
    Math.abs(location.longitude) <= 180
      ? { lat: location.latitude, lng: location.longitude }
      : {};

  return {
    ...coordinates,
    placeId,
    name: googleName,
    displayName: await deriveDisplayName({ name: googleName, city, postalCode }),
    formattedAddress:
      streetAddress ||
      component('premise')?.longText ||
      (typeof data.formattedAddress === 'string' ? data.formattedAddress : ''),
    postalCode,
    city,
    country: component('country')?.shortText ?? 'FR',
    phoneE164:
      typeof data.internationalPhoneNumber === 'string'
        ? normalizePhone(data.internationalPhoneNumber)
        : '',
    openingHours: mapped.hours,
    hoursNeedReview: mapped.hoursNeedReview,
  } satisfies PlaceImportDetails;
}
