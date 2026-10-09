'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Check, Clock3, ImagePlus, MapPin, Monitor, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import {
  ConnectStepAction,
  CUISINES_PRESETS,
  DIETARY_PRESETS,
  FEATURES_PRESETS,
  resizeImage,
} from '../ui';
import { groupWeek } from '../hours';
import type { StepProps } from '../types';
import { IMAGE_RESIZE_MAX_DIMENSION } from '@/constants/ui';

function suggestSlug(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DAY_LABELS: Record<string, string> = {
  mon: 'Lun',
  tue: 'Mar',
  wed: 'Mer',
  thu: 'Jeu',
  fri: 'Ven',
  sat: 'Sam',
  sun: 'Dim',
};

export function ConnectIdentityStep({ onComplete, onNavigate }: StepProps) {
  const { patch, post, get, orgId } = useApi();
  const {
    state,
    updateTask,
    identityDraft,
    setIdentityDraft,
    placeImportDraft,
    setRestaurantDraft,
  } = useOnboarding();
  const restaurant = state!.restaurant;
  const name = restaurant.name || placeImportDraft?.displayName || placeImportDraft?.name || '';
  const draft = identityDraft?.restaurantId === restaurant.id ? identityDraft : null;
  const [slug, setSlug] = useState(draft?.slug ?? restaurant.slug ?? suggestSlug(name));
  const [description, setDescription] = useState(
    draft?.description === 'Découvrez Notre restaurant.' && !restaurant.description
      ? ''
      : (draft?.description ?? restaurant.description ?? ''),
  );
  const [coverImageUrl, setCoverImageUrl] = useState(
    draft?.coverImageUrl ?? restaurant.coverImageUrl ?? '',
  );
  const [location, setLocation] = useState({
    formattedAddress:
      draft?.pageFields?.formattedAddress ??
      placeImportDraft?.formattedAddress ??
      restaurant.formattedAddress ??
      '',
    postalCode:
      draft?.pageFields?.postalCode ?? placeImportDraft?.postalCode ?? restaurant.postalCode ?? '',
    city: draft?.pageFields?.city ?? placeImportDraft?.city ?? restaurant.city ?? '',
    country: draft?.pageFields?.country ?? placeImportDraft?.country ?? restaurant.country ?? 'FR',
    lat:
      draft?.pageFields?.lat ??
      (placeImportDraft ? (placeImportDraft.lat ?? null) : (restaurant.lat ?? null)),
    lng:
      draft?.pageFields?.lng ??
      (placeImportDraft ? (placeImportDraft.lng ?? null) : (restaurant.lng ?? null)),
  });
  const [cuisineType, setCuisineType] = useState(
    draft?.pageFields?.cuisineType ?? restaurant.cuisineType ?? [],
  );
  const [priceRange, setPriceRange] = useState<number | null>(
    draft?.pageFields?.priceRange ?? restaurant.priceRange ?? null,
  );
  const [dietary, setDietary] = useState(draft?.pageFields?.dietary ?? restaurant.dietary ?? []);
  const [ambiance, setAmbiance] = useState(
    draft?.pageFields?.ambiance ?? restaurant.ambiance ?? [],
  );
  const [customCuisine, setCustomCuisine] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [manualCoordinates, setManualCoordinates] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState('');
  const [slugCheck, setSlugCheck] = useState<{ slug: string; available: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const slugInput = useRef<HTMLInputElement>(null);
  const slugEdited = useRef(false);
  const locationEdited = useRef(Boolean(draft?.pageFields));
  const validSlug = /^[a-z0-9-]+$/.test(slug);
  const hours = groupWeek(restaurant.openingHours ?? {}, DAYS);

  // Le brouillon Google est restauré après le premier rendu ; conserver les modifications manuelles.
  useEffect(() => {
    if (!placeImportDraft || locationEdited.current) return;
    setLocation({
      formattedAddress: placeImportDraft.formattedAddress,
      postalCode: placeImportDraft.postalCode,
      city: placeImportDraft.city,
      country: placeImportDraft.country,
      lat: placeImportDraft.lat ?? null,
      lng: placeImportDraft.lng ?? null,
    });
  }, [placeImportDraft]);

  useEffect(() => {
    if (!slugEdited.current && !slug && name) setSlug(suggestSlug(name));
  }, [name, slug]);
  useEffect(() => {
    setIdentityDraft({
      restaurantId: restaurant.id,
      slug,
      description,
      coverImageUrl,
      pageFields: { ...location, cuisineType, priceRange, dietary, ambiance },
    });
  }, [
    restaurant.id,
    slug,
    description,
    coverImageUrl,
    location,
    cuisineType,
    priceRange,
    dietary,
    ambiance,
    setIdentityDraft,
  ]);

  useEffect(() => {
    if (!validSlug) return;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const result = await get<{ available: boolean }>(
          `restaurants/check-slug?slug=${encodeURIComponent(slug)}`,
        );
        if (!cancelled) setSlugCheck({ slug, available: result.available });
      } catch {
        /* La vérification sera retentée lors de l’enregistrement. */
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [slug, validSlug, get]);

  function changeLocation(
    key: 'formattedAddress' | 'postalCode' | 'city' | 'country',
    value: string,
  ) {
    locationEdited.current = true;
    setLocation((current) => ({ ...current, [key]: value, lat: null, lng: null }));
  }

  async function upload(file?: File) {
    if (!file || uploading) return;
    setImageError('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setImageError('Choisissez une image JPG, PNG ou WebP de moins de 10 Mo.');
      return;
    }
    setUploading(true);
    try {
      setCoverImageUrl(
        await resizeImage(file, IMAGE_RESIZE_MAX_DIMENSION, IMAGE_RESIZE_MAX_DIMENSION),
      );
    } catch {
      setImageError('Cette photo ne peut pas être ouverte. Essayez une autre image.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving || uploading) return;
    setError('');
    if (!validSlug) {
      setError('Vérifiez le lien de votre page.');
      slugInput.current?.focus();
      return;
    }
    if (
      ![location.formattedAddress, location.postalCode, location.city, location.country].every(
        (value) => value.trim(),
      )
    ) {
      setEditingLocation(true);
      setError('Complétez l’adresse de votre restaurant.');
      return;
    }
    setSaving(true);
    try {
      const availability =
        slugCheck?.slug === slug
          ? slugCheck
          : await get<{ available: boolean }>(
              `restaurants/check-slug?slug=${encodeURIComponent(slug)}`,
            );
      if (!availability.available) {
        setError('Cette adresse de page est déjà utilisée. Choisissez un autre lien.');
        slugInput.current?.focus();
        return;
      }
      let coordinates = { lat: location.lat, lng: location.lng };
      if (coordinates.lat === null || coordinates.lng === null) {
        const query = `${location.formattedAddress}, ${location.postalCode} ${location.city}, ${location.country}`;
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
          );
          if (!response.ok) throw new Error('geocoding');
          const results: Array<{ lat: string; lon: string }> = await response.json();
          coordinates = {
            lat: results[0] ? Number(results[0].lat) : null,
            lng: results[0] ? Number(results[0].lon) : null,
          };
        } catch {
          setEditingLocation(true);
          setManualCoordinates(true);
          setError('La position ne peut pas être vérifiée. Réessayez ou précisez les coordonnées.');
          return;
        }
      }
      if (
        coordinates.lat === null ||
        coordinates.lng === null ||
        !Number.isFinite(coordinates.lat) ||
        !Number.isFinite(coordinates.lng) ||
        Math.abs(coordinates.lat) > 90 ||
        Math.abs(coordinates.lng) > 180
      ) {
        setEditingLocation(true);
        setManualCoordinates(true);
        setError('Adresse introuvable. Vérifiez-la ou précisez sa position.');
        return;
      }
      setLocation((current) => ({ ...current, ...coordinates }));
      if (coverImageUrl && coverImageUrl !== restaurant.coverImageUrl)
        await post(`restaurants/${orgId}/images`, { url: coverImageUrl, isCover: true });
      const pageFields = {
        slug,
        description: description.trim(),
        coverImageUrl,
        ...location,
        ...coordinates,
        cuisineType,
        priceRange,
        dietary,
        ambiance,
      };
      await patch(`restaurants/${orgId}/connect`, pageFields);
      setRestaurantDraft?.({ ...pageFields, name });
      const updated = await updateTask('complete', 'connect-identity');
      if (!updated) throw new Error('completion failed');
      setIdentityDraft(null);
      onComplete('connect-activation');
    } catch {
      setError('L’enregistrement a échoué. Votre saisie est conservée, réessayez.');
    } finally {
      setSaving(false);
    }
  }

  function tags(
    label: string,
    values: string[],
    selected: string[],
    setSelected: (values: string[]) => void,
  ) {
    return (
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">{label}</legend>
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={selected.includes(value)}
              onClick={() =>
                setSelected(
                  selected.includes(value)
                    ? selected.filter((item) => item !== value)
                    : [...selected, value],
                )
              }
              className={cn(
                'rounded-full px-3 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected.includes(value)
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-foreground hover:bg-muted/70',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </fieldset>
    );
  }

  return (
    <form
      id="connect-identity-form"
      onSubmit={handleSubmit}
      noValidate
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] xl:gap-12"
    >
      <section aria-label="Personnaliser votre page" className="min-w-0 space-y-6">
        <div className="flex items-center gap-4 rounded-3xl bg-card p-4 sm:p-5">
          <button
            type="button"
            disabled={uploading}
            aria-label="Choisir une photo de couverture"
            onClick={() => fileInput.current?.click()}
            className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-brand/10 text-brand transition-all duration-200 hover:bg-brand/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {coverImageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImageUrl}
                  alt="Votre couverture"
                  className="size-full object-cover"
                />
              </>
            ) : (
              <ImagePlus size={26} aria-hidden="true" />
            )}
          </button>
          <div className="min-w-0 space-y-1">
            <p className="text-base font-semibold">Votre photo de couverture</p>
            <p className="text-xs text-muted-foreground">
              Facultative · JPG, PNG, WebP · 10 Mo max.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="link"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
                className="h-auto p-0 text-sm transition-all duration-200"
              >
                {uploading
                  ? 'Préparation…'
                  : coverImageUrl
                    ? 'Changer la photo'
                    : 'Ajouter une photo'}
              </Button>
              {coverImageUrl && (
                <Button
                  type="button"
                  variant="link"
                  onClick={() => setCoverImageUrl('')}
                  className="h-auto p-0 text-sm text-muted-foreground transition-all duration-200"
                >
                  Retirer
                </Button>
              )}
            </div>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
        {imageError && (
          <p role="alert" className="text-sm text-destructive">
            {imageError}
          </p>
        )}

        <div className="space-y-2">
          <label htmlFor="connect-description" className="flex justify-between text-sm font-medium">
            Présentation <span className="font-normal text-muted-foreground">Facultative</span>
          </label>
          <textarea
            id="connect-description"
            value={description}
            maxLength={200}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Une cuisine, une atmosphère, une histoire…"
            className="min-h-24 w-full resize-y rounded-2xl border-0 bg-card p-4 text-base leading-6 transition-all duration-200 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <MapPin
                size={18}
                className="mt-0.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div>
                <p className="text-sm font-medium">Adresse du restaurant</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {location.formattedAddress
                    ? `${location.formattedAddress}, ${location.postalCode} ${location.city}`
                    : 'À compléter'}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="link"
              className="h-auto shrink-0 p-0 text-sm transition-all duration-200"
              aria-expanded={editingLocation}
              onClick={() => setEditingLocation(!editingLocation)}
            >
              {editingLocation ? 'Fermer' : location.formattedAddress ? 'Modifier' : 'Compléter'}
            </Button>
          </div>
          {editingLocation && (
            <div className="space-y-3 rounded-2xl bg-card p-4">
              <label className="block space-y-1 text-sm">
                Rue et numéro
                <Input
                  value={location.formattedAddress}
                  onChange={(event) => changeLocation('formattedAddress', event.target.value)}
                  autoComplete="street-address"
                  className="transition-all duration-200"
                />
              </label>
              <div className="grid grid-cols-[0.4fr_0.6fr] gap-3">
                <label className="block space-y-1 text-sm">
                  Code postal
                  <Input
                    value={location.postalCode}
                    onChange={(event) => changeLocation('postalCode', event.target.value)}
                    autoComplete="postal-code"
                    className="transition-all duration-200"
                  />
                </label>
                <label className="block space-y-1 text-sm">
                  Ville
                  <Input
                    value={location.city}
                    onChange={(event) => changeLocation('city', event.target.value)}
                    autoComplete="address-level2"
                    className="transition-all duration-200"
                  />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                Pays
                <Input
                  value={location.country}
                  onChange={(event) => changeLocation('country', event.target.value.toUpperCase())}
                  autoComplete="country"
                  maxLength={2}
                  className="transition-all duration-200"
                />
              </label>
              {manualCoordinates && (
                <div className="grid grid-cols-2 gap-3">
                  {(['lat', 'lng'] as const).map((key) => (
                    <label key={key} className="block space-y-1 text-sm">
                      {key === 'lat' ? 'Latitude' : 'Longitude'}
                      <Input
                        type="number"
                        step="any"
                        value={location[key] ?? ''}
                        onChange={(event) =>
                          setLocation((current) => ({
                            ...current,
                            [key]: event.target.value === '' ? null : Number(event.target.value),
                          }))
                        }
                        className="transition-all duration-200"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="connect-slug" className="text-sm font-medium">
            Votre lien de réservation
          </label>
          <div className="flex items-center gap-1 rounded-2xl bg-card px-4 focus-within:ring-2 focus-within:ring-ring">
            <span className="shrink-0 text-xs text-muted-foreground">sokar.tech/restaurant/</span>
            <Input
              id="connect-slug"
              ref={slugInput}
              value={slug}
              onChange={(event) => {
                slugEdited.current = true;
                setSlug(event.target.value.toLowerCase().trim());
              }}
              className="min-w-0 border-0 bg-transparent px-0 shadow-none transition-all duration-200 focus-visible:ring-0"
            />
          </div>
          {slugCheck?.slug === slug && !slugCheck.available && (
            <p role="status" className="text-xs text-destructive">
              Ce lien est déjà utilisé.
            </p>
          )}
        </div>

        <details className="group rounded-2xl bg-card p-4 sm:p-5">
          <summary className="cursor-pointer text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Cuisine et ambiance{' '}
            <span className="ml-2 font-normal text-muted-foreground">Facultatif</span>
          </summary>
          <div className="mt-5 space-y-5">
            {tags(
              'Cuisine',
              [...new Set([...CUISINES_PRESETS, ...cuisineType])],
              cuisineType,
              setCuisineType,
            )}
            <div className="flex gap-2">
              <Input
                aria-label="Autre cuisine"
                placeholder="Autre cuisine"
                value={customCuisine}
                onChange={(event) => setCustomCuisine(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    if (customCuisine.trim()) {
                      setCuisineType([...new Set([...cuisineType, customCuisine.trim()])]);
                      setCustomCuisine('');
                    }
                  }
                }}
                className="transition-all duration-200"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={!customCuisine.trim()}
                onClick={() => {
                  setCuisineType([...new Set([...cuisineType, customCuisine.trim()])]);
                  setCustomCuisine('');
                }}
                className="transition-all duration-200"
              >
                Ajouter
              </Button>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Gamme de prix</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-label={`Gamme de prix ${value}`}
                    aria-pressed={priceRange === value}
                    onClick={() => setPriceRange(priceRange === value ? null : value)}
                    className={cn(
                      'rounded-full px-4 py-2 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      priceRange === value
                        ? 'bg-foreground text-background'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    {'€'.repeat(value)}
                  </button>
                ))}
              </div>
            </fieldset>
            {tags(
              'Régimes alimentaires',
              [...new Set([...DIETARY_PRESETS, ...dietary])],
              dietary,
              setDietary,
            )}
            {tags(
              'Ambiance et atouts',
              [...new Set([...FEATURES_PRESETS, ...ambiance])],
              ambiance,
              setAmbiance,
            )}
          </div>
        </details>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      <aside
        aria-label="Aperçu de votre page de réservation"
        className="min-w-0 lg:sticky lg:top-0"
      >
        <div className="mx-auto w-full max-w-xl space-y-3">
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Monitor size={15} aria-hidden="true" /> Aperçu client
            </span>
            <span>
              {restaurant.exposureSettings?.connectPublished ? 'Page publiée' : 'Non publiée'}
            </span>
          </div>
          <div className="overflow-hidden rounded-[2rem] bg-card shadow-lg shadow-foreground/5">
            <div className="relative flex aspect-[2.6/1] items-center justify-center overflow-hidden bg-brand/10">
              {coverImageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={coverImageUrl}
                    alt={`Couverture de ${name}`}
                    className="absolute inset-0 size-full object-cover"
                    onError={() =>
                      setImageError(
                        'La photo ne peut pas être affichée. Choisissez une autre image.',
                      )
                    }
                  />
                </>
              ) : (
                <>
                  <div
                    aria-hidden="true"
                    className="absolute -right-8 -top-20 size-64 rounded-full bg-brand/10"
                  />
                  <div
                    aria-hidden="true"
                    className="absolute -bottom-24 -left-8 size-56 rounded-full bg-background/50"
                  />
                  <span
                    aria-hidden="true"
                    className="relative font-medium text-5xl tracking-tight text-brand/40"
                  >
                    {name
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((word) => word[0])
                      .join('') || 'S'}
                  </span>
                </>
              )}
            </div>
            <div className="space-y-5 p-6 sm:p-7">
              <div className="space-y-2">
                <h2 className="break-words text-2xl font-semibold tracking-tight">
                  {name || 'Nom du restaurant à compléter'}
                </h2>
                {(cuisineType.length > 0 || priceRange) && (
                  <p className="text-sm text-muted-foreground">
                    {[cuisineType.join(' · '), priceRange ? '€'.repeat(priceRange) : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </div>
              {description.trim() && (
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/80">
                  {description}
                </p>
              )}
              {location.formattedAddress && (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <MapPin size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    {location.formattedAddress}
                    <br />
                    {location.postalCode} {location.city}
                  </span>
                </p>
              )}
              {hours.length > 0 && (
                <details className="text-sm">
                  <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground transition-all duration-200">
                    <Clock3 size={16} aria-hidden="true" /> Horaires
                  </summary>
                  <div className="mt-3 space-y-2">
                    {hours.map((group) => (
                      <div
                        key={group.days.join('-')}
                        className="flex flex-wrap justify-between gap-2"
                      >
                        <span>
                          {group.days.length > 1
                            ? `${DAY_LABELS[group.days[0]]} – ${DAY_LABELS[group.days.at(-1)!]}`
                            : DAY_LABELS[group.days[0]]}
                        </span>
                        <span className="text-muted-foreground">
                          {group.slots.map((slot) => `${slot.open}–${slot.close}`).join(' / ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {restaurant.phoneE164 && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Phone size={16} aria-hidden="true" />
                  {restaurant.phoneE164}
                </p>
              )}
              {(ambiance.length > 0 || dietary.length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {[...new Set([...ambiance, ...dietary])].map((value) => (
                    <span key={value} className="rounded-full bg-muted px-3 py-1 text-xs">
                      {value}
                    </span>
                  ))}
                </div>
              )}
              <div className="rounded-full bg-foreground px-5 py-3 text-center text-sm font-medium text-background">
                Réserver une table
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Check size={14} aria-hidden="true" /> Horaires et règles partagés avec vos
              réservations
            </span>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('restaurant')}
                className="underline underline-offset-4 transition-all duration-200"
              >
                Revoir mon restaurant
              </button>
            )}
          </div>
        </div>
      </aside>
      <ConnectStepAction
        formId="connect-identity-form"
        saving={saving || uploading}
        label="Vérifier avant publication"
      />
    </form>
  );
}
