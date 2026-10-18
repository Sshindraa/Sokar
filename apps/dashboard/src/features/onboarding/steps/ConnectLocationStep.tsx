'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Loader2, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { ConnectReviewLayout, ConnectStepAction, Field } from '../ui';
import type { StepProps } from '../types';
import { GEOCODING_DEBOUNCE_MS } from '@/constants/ui';

function isLocationReady(location: {
  formattedAddress: string;
  postalCode: string;
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
}) {
  const validCoordinates = Boolean(
    location.lat !== null &&
    location.lng !== null &&
    Number.isFinite(location.lat) &&
    Number.isFinite(location.lng) &&
    location.lat >= -90 &&
    location.lat <= 90 &&
    location.lng >= -180 &&
    location.lng <= 180,
  );

  return Boolean(
    location.formattedAddress.trim() &&
    location.postalCode.trim() &&
    location.city.trim() &&
    location.country.trim() &&
    validCoordinates,
  );
}

export function ConnectLocationStep({ onComplete }: StepProps) {
  const { patch, orgId } = useApi();
  const { state, updateTask, placeImportDraft, setPlaceImportDraft } = useOnboarding();
  const restaurant = state!.restaurant;

  const [formattedAddress, setFormattedAddress] = useState(
    placeImportDraft?.formattedAddress || restaurant.formattedAddress || '',
  );
  const [postalCode, setPostalCode] = useState(
    placeImportDraft?.postalCode || restaurant.postalCode || '',
  );
  const [city, setCity] = useState(placeImportDraft?.city || restaurant.city || '');
  const [country, setCountry] = useState(placeImportDraft?.country || restaurant.country || 'FR');
  const [lat, setLat] = useState<number | null>(placeImportDraft ? null : (restaurant.lat ?? null));
  const [lng, setLng] = useState<number | null>(placeImportDraft ? null : (restaurant.lng ?? null));
  const [cityQuery, setCityQuery] = useState(city);
  const [citySuggestions, setCitySuggestions] = useState<
    Array<{ nom: string; codesPostaux: string[] }>
  >([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState('');
  const [validationAttempted, setValidationAttempted] = useState(false);
  const addressInputRef = useRef<HTMLInputElement>(null);

  const locationReady = isLocationReady({ formattedAddress, postalCode, city, country, lat, lng });
  const invalidLatitude =
    validationAttempted && (lat === null || !Number.isFinite(lat) || lat < -90 || lat > 90);
  const invalidLongitude =
    validationAttempted && (lng === null || !Number.isFinite(lng) || lng < -180 || lng > 180);

  useEffect(() => {
    if (editing) addressInputRef.current?.focus({ preventScroll: true });
  }, [editing]);

  useEffect(() => {
    if (cityQuery.length < 2) {
      setCitySuggestions([]);
      return;
    }
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(cityQuery)}&fields=nom,codesPostaux&limit=5`,
        );
        if (res.ok) setCitySuggestions(await res.json());
      } catch {
        // L’autocomplétion est facultative : la saisie libre reste disponible.
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [cityQuery]);

  useEffect(() => {
    if (!formattedAddress || !postalCode || !city) return;
    const timeout = setTimeout(async () => {
      setGeocoding(true);
      try {
        const query = `${formattedAddress}, ${postalCode} ${city}, France`;
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
          { headers: { 'User-Agent': 'Sokar-Dashboard/1.0' } },
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.[0]) {
            setLat(Number(data[0].lat));
            setLng(Number(data[0].lon));
          }
        }
      } catch {
        // Les coordonnées peuvent toujours être saisies manuellement.
      } finally {
        setGeocoding(false);
      }
    }, GEOCODING_DEBOUNCE_MS);
    return () => clearTimeout(timeout);
  }, [formattedAddress, postalCode, city]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setError('');
    if (geocoding) return;
    if (!locationReady) {
      setValidationAttempted(true);
      return;
    }

    setSaving(true);
    try {
      await patch(`restaurants/${orgId}/connect`, {
        formattedAddress,
        postalCode,
        city,
        country,
        lat,
        lng,
      });
      const updated = await updateTask('complete', 'connect-location');
      if (!updated) throw new Error('completion failed');
      setPlaceImportDraft(null);
      onComplete('connect-cuisine');
    } catch {
      setEditing(true);
      setError('La sauvegarde a échoué. Vos informations sont conservées, réessayez.');
    } finally {
      setSaving(false);
    }
  }

  function handleSelectCity(item: { nom: string; codesPostaux: string[] }) {
    setCity(item.nom);
    setCityQuery(item.nom);
    if (item.codesPostaux?.[0]) setPostalCode(item.codesPostaux[0]);
    setLat(null);
    setLng(null);
    setCitySuggestions([]);
  }

  const invalidLocation = validationAttempted && !locationReady;
  const summary = (
    <div className="space-y-5">
      <button
        type="button"
        aria-describedby={invalidLocation ? 'connect-location-error' : undefined}
        aria-invalid={invalidLocation}
        aria-expanded={editing}
        aria-controls="connect-location-editor"
        onClick={() => {
          setEditing((current) => !current);
          setError('');
        }}
        className={cn(
          'group flex w-full cursor-pointer items-start gap-4 rounded-2xl p-2 text-left transition-all duration-200 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          invalidLocation && 'border border-destructive bg-destructive/5 p-3',
        )}
      >
        <span
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground',
            invalidLocation && 'bg-destructive/10 text-destructive',
          )}
        >
          <MapPin size={22} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block font-semibold text-foreground',
              invalidLocation && 'text-destructive',
            )}
          >
            {formattedAddress || 'Adresse à compléter'}
          </span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {[postalCode, city, country].filter(Boolean).join(' · ') ||
              'Ville et code postal à renseigner'}
          </span>
        </span>
        <span
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground',
            invalidLocation && 'bg-destructive/10 text-destructive',
          )}
        >
          {locationReady ? <Check size={14} /> : <MapPin size={14} />}
          {locationReady ? 'Prête' : 'À compléter'}
        </span>
        <ChevronRight
          size={18}
          aria-hidden="true"
          className={cn(
            'mt-0.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5',
            editing && 'rotate-90',
          )}
        />
      </button>
      {!editing && (
        <div className="space-y-1 rounded-xl bg-muted/50 px-4 py-3 text-sm leading-6 text-muted-foreground">
          <p>
            Cette adresse aidera vos clients à trouver votre restaurant dans les recherches de
            proximité. Vérifiez-la avant de continuer.
          </p>
          {(placeImportDraft || restaurant.googlePlaceId) && (
            <p className="text-xs font-normal" translate="no">
              Google Maps
            </p>
          )}
        </div>
      )}
    </div>
  );

  return (
    <form
      id="connect-location-form"
      noValidate
      onSubmit={handleSubmit}
      className="mx-auto w-full max-w-2xl space-y-4"
    >
      <ConnectReviewLayout
        editing={editing}
        onEditingChange={(next) => {
          setEditing(next);
          setError('');
        }}
        icon={MapPin}
        title="Adresse du restaurant"
        summary={summary}
        summaryStaysVisible
        editorId="connect-location-editor"
        hideHeader
      >
        <div className="space-y-4">
          {(placeImportDraft || restaurant.googlePlaceId) && (
            <p
              className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-normal text-muted-foreground"
              translate="no"
            >
              Google Maps
            </p>
          )}
          <Field label="Adresse (ligne 1)">
            <Input
              ref={addressInputRef}
              aria-invalid={validationAttempted && !formattedAddress.trim()}
              className={
                validationAttempted && !formattedAddress.trim()
                  ? 'border-destructive focus-visible:ring-destructive'
                  : undefined
              }
              value={formattedAddress}
              onChange={(e) => {
                setFormattedAddress(e.target.value);
                setLat(null);
                setLng(null);
                setError('');
              }}
              placeholder="12 rue de la République"
              autoComplete="street-address"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <div className="relative">
              <Field label="Ville">
                <Input
                  aria-invalid={validationAttempted && !city.trim()}
                  className={
                    validationAttempted && !city.trim()
                      ? 'border-destructive focus-visible:ring-destructive'
                      : undefined
                  }
                  value={cityQuery}
                  onChange={(e) => {
                    setCityQuery(e.target.value);
                    setCity(e.target.value);
                    setLat(null);
                    setLng(null);
                    setError('');
                  }}
                  placeholder="Lyon"
                  autoComplete="address-level2"
                  required
                />
              </Field>
              {citySuggestions.length > 0 && (
                <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                  {citySuggestions.map((item) => (
                    <button
                      key={item.nom}
                      type="button"
                      onClick={() => handleSelectCity(item)}
                      className="w-full border-b border-border px-3 py-2 text-left text-sm transition-all duration-200 last:border-0 hover:bg-accent"
                    >
                      {item.nom} ({item.codesPostaux?.[0] || ''})
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Field label="Code postal">
              <Input
                aria-invalid={validationAttempted && !postalCode.trim()}
                className={
                  validationAttempted && !postalCode.trim()
                    ? 'border-destructive focus-visible:ring-destructive'
                    : undefined
                }
                value={postalCode}
                onChange={(e) => {
                  setPostalCode(e.target.value);
                  setLat(null);
                  setLng(null);
                  setError('');
                }}
                placeholder="69002"
                autoComplete="postal-code"
                required
              />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Pays">
              <Input
                aria-invalid={validationAttempted && !country.trim()}
                className={
                  validationAttempted && !country.trim()
                    ? 'border-destructive focus-visible:ring-destructive'
                    : undefined
                }
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setError('');
                }}
                required
              />
            </Field>
            <Field label="Latitude">
              <Input
                type="number"
                step="0.000001"
                value={lat ?? ''}
                aria-invalid={invalidLatitude}
                className={
                  invalidLatitude ? 'border-destructive focus-visible:ring-destructive' : undefined
                }
                onChange={(e) => {
                  setLat(e.target.value ? Number(e.target.value) : null);
                  setError('');
                }}
                required
              />
            </Field>
            <Field label="Longitude">
              <Input
                type="number"
                step="0.000001"
                value={lng ?? ''}
                aria-invalid={invalidLongitude}
                className={
                  invalidLongitude ? 'border-destructive focus-visible:ring-destructive' : undefined
                }
                onChange={(e) => {
                  setLng(e.target.value ? Number(e.target.value) : null);
                  setError('');
                }}
                required
              />
            </Field>
          </div>

          {geocoding && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
              <Loader2 className="animate-spin" size={14} />
              Recherche de la position en cours…
            </div>
          )}

          {lat !== null && lng !== null && (
            <div className="relative h-40 w-full overflow-hidden rounded-xl border border-border bg-muted">
              <iframe
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.003}%2C${lat - 0.002}%2C${lng + 0.003}%2C${lat + 0.002}&layer=mapnik&marker=${lat}%2C${lng}`}
                className="h-full w-full border-0"
                title="Aperçu de la localisation"
              />
            </div>
          )}
        </div>
      </ConnectReviewLayout>
      {(error || (validationAttempted && !locationReady)) && (
        <p
          id="connect-location-error"
          role="alert"
          className="mx-auto w-full max-w-2xl text-sm text-destructive"
        >
          {error || 'Complétez l’adresse et vérifiez la position avant de continuer.'}
        </p>
      )}
      <ConnectStepAction
        formId="connect-location-form"
        saving={saving}
        label={
          locationReady ? 'Continuer vers la cuisine et l’ambiance' : 'Compléter votre adresse'
        }
      />
    </form>
  );
}
