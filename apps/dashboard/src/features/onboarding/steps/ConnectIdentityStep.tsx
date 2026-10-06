'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { ImagePlus, MapPin, Pencil, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { ConnectStepAction, resizeImage } from '../ui';
import type { OnboardingRestaurant } from '../types';
import type { StepProps } from '../types';
import { IMAGE_RESIZE_MAX_DIMENSION } from '@/constants/ui';

function suggestDescription(restaurant: OnboardingRestaurant) {
  const location = restaurant.city ? ` à ${restaurant.city}` : '';
  const cuisine = restaurant.cuisineType?.length
    ? ` Découvrez notre cuisine ${restaurant.cuisineType.join(', ').toLowerCase()}.`
    : '';
  const name = restaurant.name || 'Notre restaurant';
  return `Découvrez ${name}${location}.${cuisine}`.slice(0, 200);
}

function suggestSlug(name: string) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function ConnectIdentityStep({ onComplete }: StepProps) {
  const { patch, post, get, orgId } = useApi();
  const { state, updateTask, identityDraft, setIdentityDraft } = useOnboarding();
  const restaurant = state!.restaurant;
  const draft = identityDraft?.restaurantId === restaurant.id ? identityDraft : null;
  const [slug, setSlug] = useState(draft?.slug ?? restaurant.slug ?? suggestSlug(restaurant.name));
  const [description, setDescription] = useState(
    draft?.description ??
      (restaurant.description?.trim() ? restaurant.description : suggestDescription(restaurant)),
  );
  const [coverImageUrl, setCoverImageUrl] = useState(
    draft?.coverImageUrl ?? restaurant.coverImageUrl ?? '',
  );
  const [editingInfo, setEditingInfo] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [imageError, setImageError] = useState('');
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingPhoto, setEditingPhoto] = useState(false);
  const effectiveDescription = description.trim() || suggestDescription(restaurant);
  const [editingSlug, setEditingSlug] = useState(false);
  const slugInput = useRef<HTMLInputElement>(null);
  const [slugCheck, setSlugCheck] = useState<{
    slug: string;
    status: 'available' | 'taken' | 'error';
  } | null>(null);
  const originalFile = useRef<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const validSlug = /^[a-z0-9-]+$/.test(slug);
  const status = slugCheck?.slug === slug ? slugCheck.status : null;

  useEffect(() => {
    setIdentityDraft({ restaurantId: restaurant.id, slug, description, coverImageUrl });
  }, [restaurant.id, slug, description, coverImageUrl, setIdentityDraft]);

  useEffect(() => {
    if (!slug || !validSlug) return;
    let cancelled = false;
    const timeout = setTimeout(async () => {
      try {
        const res = await get<{ available: boolean }>(
          `restaurants/check-slug?slug=${encodeURIComponent(slug)}`,
        );
        if (!cancelled) setSlugCheck({ slug, status: res.available ? 'available' : 'taken' });
      } catch {
        if (!cancelled) setSlugCheck({ slug, status: 'error' });
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [slug, validSlug, get, retry]);

  async function upload(file?: File, cropRatio?: number) {
    if (!file) return;
    setImageError('');
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setImageError('Choisissez une image JPG, PNG ou WebP de moins de 10 Mo.');
      return;
    }
    originalFile.current = file;
    setUploading(true);
    try {
      setCoverImageUrl(
        await resizeImage(file, IMAGE_RESIZE_MAX_DIMENSION, IMAGE_RESIZE_MAX_DIMENSION, cropRatio),
      );
    } catch {
      setImageError('Cette image ne peut pas être ouverte. Essayez une autre photo.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving || uploading) return;
    setSaving(true);
    setError('');
    try {
      if (!validSlug) {
        setEditingInfo(true);
        setEditingSlug(true);
        setError('Vérifiez l’adresse de votre page.');
        return;
      }
      const availability =
        status === 'available'
          ? { available: true }
          : await get<{ available: boolean }>(
              `restaurants/check-slug?slug=${encodeURIComponent(slug)}`,
            );
      if (!availability.available) {
        setEditingInfo(true);
        setEditingSlug(true);
        setError('Cette adresse est déjà utilisée. Choisissez une autre adresse.');
        return;
      }
      if (coverImageUrl && coverImageUrl !== restaurant.coverImageUrl) {
        await post(`restaurants/${orgId}/images`, { url: coverImageUrl, isCover: true });
      }
      await patch(`restaurants/${orgId}/connect`, {
        slug,
        description: effectiveDescription,
        coverImageUrl,
      });
      const updated = await updateTask('complete', 'connect-identity');
      if (!updated) throw new Error('completion failed');
      setIdentityDraft(null);
      onComplete('connect-location');
    } catch {
      setEditingInfo(true);
      setError('La sauvegarde a échoué. Votre saisie est conservée, veuillez réessayer.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      id="connect-identity-form"
      data-review={!editingInfo}
      onSubmit={handleSubmit}
      className={cn(
        'grid items-start gap-6',
        editingInfo ? 'md:grid-cols-[1.1fr_1fr]' : 'mx-auto w-full max-w-lg',
      )}
    >
      <div className={cn('min-w-0 space-y-4', !editingInfo && 'hidden')}>
        <div className="divide-y divide-border">
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Adresse</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                aria-label={editingSlug ? 'Terminer l’édition de l’adresse' : 'Modifier l’adresse'}
                aria-expanded={editingSlug}
                onClick={() => setEditingSlug((value) => !value)}
                className="h-auto p-0 text-xs transition-all duration-200"
              >
                {editingSlug ? 'Terminer' : 'Modifier'}
              </Button>
            </div>
            {editingSlug ? (
              <Input
                ref={slugInput}
                id="connect-slug"
                aria-label="Adresse de votre page"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().trim())}
                className="transition-all duration-200"
              />
            ) : (
              <p className="break-all text-sm text-muted-foreground">
                sokar.tech/restaurant/{slug}
              </p>
            )}
            {(status === 'taken' || status === 'error' || !validSlug) && (
              <div className="space-y-2">
                <p role="status" className="text-xs text-destructive">
                  {!validSlug
                    ? 'Utilisez des lettres minuscules, chiffres et tirets.'
                    : status === 'taken'
                      ? 'Cette adresse est déjà utilisée.'
                      : 'La vérification de l’adresse est indisponible.'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    status === 'taken'
                      ? setSlug(`${slug}-${suggestSlug(restaurant.city || 'restaurant')}`)
                      : (setSlugCheck(null), setRetry((value) => value + 1))
                  }
                  className="transition-all duration-200"
                >
                  {status === 'taken' ? 'Essayer une autre adresse' : 'Réessayer la vérification'}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Présentation</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                aria-label={
                  editingDescription
                    ? 'Terminer l’édition de la présentation'
                    : 'Modifier la présentation'
                }
                aria-expanded={editingDescription}
                onClick={() => {
                  if (editingDescription && !description.trim())
                    setDescription(suggestDescription(restaurant));
                  setEditingDescription((value) => !value);
                }}
                className="h-auto p-0 text-xs transition-all duration-200"
              >
                {editingDescription ? 'Terminer' : 'Modifier'}
              </Button>
            </div>
            {editingDescription ? (
              <div className="space-y-2">
                <textarea
                  aria-label="Comment souhaitez-vous être présenté ?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={200}
                  className="h-24 w-full rounded-lg border border-input bg-background p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <p className="text-right text-xs text-muted-foreground">{description.length}/200</p>
              </div>
            ) : (
              <p className="text-sm leading-6 text-muted-foreground">{effectiveDescription}</p>
            )}
            {effectiveDescription === suggestDescription(restaurant) && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Sparkles size={14} aria-hidden="true" />
                Proposition Sokar
              </p>
            )}
          </div>
          <div className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-14 items-center justify-center overflow-hidden rounded-lg bg-muted">
                  {coverImageUrl ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={coverImageUrl}
                        alt="Votre couverture"
                        className="h-full w-full object-cover"
                      />
                    </>
                  ) : (
                    <span className="text-sm font-semibold">
                      {restaurant.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((word) => word[0])
                        .join('')
                        .toUpperCase() || 'S'}
                    </span>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">Couverture</p>
                  <p className="text-xs text-muted-foreground">
                    {coverImageUrl ? 'Votre couverture est prête' : 'Visuel par défaut Sokar'}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="link"
                size="sm"
                aria-expanded={editingPhoto}
                onClick={() => setEditingPhoto((value) => !value)}
                className="h-auto p-0 text-xs transition-all duration-200"
              >
                {editingPhoto ? 'Terminer' : coverImageUrl ? 'Changer' : 'Ajouter une photo'}
              </Button>
            </div>
          </div>
        </div>
        {editingPhoto && (
          <div className="space-y-3 md:space-y-[clamp(4px,calc((100dvh_-_600px)/30_+_4px),8px)]">
            <p className="text-sm font-medium">
              Photo de couverture{' '}
              <span className="font-normal text-muted-foreground">· Facultative</span>
            </p>
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                void upload(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="sr-only"
              tabIndex={-1}
              aria-label="Choisir une photo de couverture"
            />
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!uploading) void upload(e.dataTransfer.files[0]);
              }}
              className="flex min-h-[150px] md:min-h-[80px] flex-col items-center justify-center gap-3 md:gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-4 md:p-3 text-center transition-all duration-200 hover:border-primary/50"
            >
              <ImagePlus size={24} className="text-muted-foreground md:hidden" />
              <p className="text-sm text-muted-foreground">
                {uploading
                  ? 'Préparation de votre photo…'
                  : coverImageUrl
                    ? 'Votre photo est visible dans l’aperçu.'
                    : 'Glissez-déposez une photo de votre restaurant.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInput.current?.click()}
                  className="transition-all duration-200"
                >
                  {coverImageUrl ? 'Remplacer la photo' : 'Choisir une photo'}
                </Button>
                {coverImageUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCoverImageUrl('');
                    }}
                    className="transition-all duration-200"
                  >
                    Supprimer
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              JPG, PNG ou WebP · 10 Mo maximum · Format paysage conseillé.
            </p>
            {coverImageUrl && originalFile.current && (
              <Button
                type="button"
                variant="link"
                size="sm"
                disabled={uploading}
                onClick={() => void upload(originalFile.current!, 16 / 10)}
                className="h-auto p-0 text-xs transition-all duration-200"
              >
                Recadrer au format paysage
              </Button>
            )}
            {imageError && (
              <p role="alert" className="text-sm text-destructive">
                {imageError}
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <aside
        id="connect-identity-preview"
        className="min-w-0 space-y-3"
        aria-label="Aperçu de votre fiche publique"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Aperçu client
          </p>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
          <div className="flex aspect-[16/10] md:aspect-auto md:h-[clamp(80px,16dvh,140px)] items-center justify-center bg-muted">
            {coverImageUrl ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImageUrl}
                  alt={`Couverture de ${restaurant.name}`}
                  className="h-full w-full object-cover"
                  onError={() =>
                    setImageError(
                      'La photo ne peut pas être affichée. Remplacez-la par une autre image.',
                    )
                  }
                />
              </>
            ) : (
              <div
                className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/10 via-muted to-primary/5"
                aria-label="Couverture par défaut"
              >
                <div className="space-y-1 px-6 text-center">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                    Bienvenue chez
                  </p>
                  <p className="text-xl font-semibold tracking-tight text-foreground">
                    {restaurant.name || 'Votre restaurant'}
                  </p>
                  {restaurant.cuisineType?.length ? (
                    <p className="text-xs text-muted-foreground">
                      {restaurant.cuisineType.join(' · ')}
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-4 p-6 md:space-y-[clamp(8px,calc((100dvh_-_600px)/15_+_8px),16px)] md:p-5">
            <div className="space-y-2 md:space-y-[clamp(4px,calc((100dvh_-_600px)/30_+_4px),8px)]">
              <h2 className="break-words text-xl font-semibold tracking-tight">
                {restaurant.name || 'Votre restaurant'}
              </h2>
              {restaurant.city && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MapPin size={14} />
                  {restaurant.city}
                </p>
              )}
            </div>
            <p className="min-h-[60px] md:min-h-0 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
              {effectiveDescription}
            </p>
            <div className="rounded-lg bg-primary px-4 py-2.5 text-center text-sm font-medium text-primary-foreground">
              Réserver une table
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">Adresse · Présentation · Couverture</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-expanded={editingInfo}
            aria-label={editingInfo ? 'Terminer les modifications' : 'Modifier les informations'}
            onClick={() => setEditingInfo((value) => !value)}
            className="h-9 shrink-0 gap-2 rounded-full border-primary/20 bg-primary/5 px-4 text-sm font-medium text-foreground shadow-sm transition-all duration-200 hover:border-primary/30 hover:bg-primary/10 hover:shadow-md"
          >
            <Pencil size={14} aria-hidden="true" />
            {editingInfo ? 'Terminer les modifications' : 'Modifier les informations'}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">
          Publication à l’étape d’activation.
        </p>
      </aside>
      <ConnectStepAction
        formId="connect-identity-form"
        saving={saving || uploading}
        label="Continuer vers l’adresse"
      />
    </form>
  );
}
