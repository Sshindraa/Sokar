'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Store, Check, Search, Loader2, MapPin, Mail, PhoneCall, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useApi } from '@/lib/api';
import { useOnboarding } from '../onboarding-provider';
import { StepHeader, Field, SubmitButton, OnboardingPreview } from '../ui';
import type { StepProps } from '../types';
import type { PlaceImportDraft } from '../onboarding-provider';

export function RestaurantStep({ onComplete }: StepProps) {
  const { patch, post, orgId } = useApi();
  const { state, updateTask, placeImportDraft, setPlaceImportDraft } = useOnboarding();
  const restaurant = state!.restaurant;
  const [name, setName] = useState(restaurant.name || '');
  const [managerEmail, setManagerEmail] = useState(restaurant.managerEmail || '');
  const [phoneE164, setPhoneE164] = useState(restaurant.phoneE164 || '');
  const [googlePlaceId, setGooglePlaceId] = useState(restaurant.googlePlaceId || null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<
    Array<{ placeId: string; mainText: string; secondaryText: string }>
  >([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [completedSearch, setCompletedSearch] = useState('');
  const [selectingPlace, setSelectingPlace] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [importedFields, setImportedFields] = useState<{
    name: string | null;
    phone: string | null;
  }>({ name: null, phone: null });
  const sessionToken = useRef('');
  const selectedPlaceLabel = useRef('');

  // Provenance Google affichée champ par champ, uniquement tant que la valeur importée n'a pas
  // été remplacée manuellement par le restaurateur.
  const nameImportedFromGoogle = Boolean(importedFields.name) && importedFields.name === name;
  const phoneImportedFromGoogle =
    Boolean(importedFields.phone) && importedFields.phone === phoneE164;

  useEffect(() => {
    if (searchQuery && searchQuery === selectedPlaceLabel.current) {
      selectedPlaceLabel.current = '';
      setSuggestions([]);
      setSearchLoading(false);
      return;
    }
    if (searchQuery.trim().length < 2) {
      setSuggestions([]);
      setCompletedSearch('');
      setSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearchLoading(true);
      setSearchError('');
      const token = sessionToken.current || crypto.randomUUID();
      sessionToken.current = token;
      try {
        const result = await post<{
          suggestions: Array<{ placeId: string; mainText: string; secondaryText: string }>;
        }>(
          'restaurant/onboarding/places/autocomplete',
          { query: searchQuery.trim(), sessionToken: token },
          { signal: controller.signal },
        );
        setSuggestions(result.suggestions);
        setCompletedSearch(searchQuery.trim());
      } catch (error) {
        if (!controller.signal.aborted) {
          setSearchError(error instanceof Error ? error.message : 'Recherche indisponible.');
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchQuery, post]);

  useEffect(() => {
    if (!placeImportDraft) return;
    setName(placeImportDraft.name || restaurant.name || '');
    setPhoneE164(placeImportDraft.phoneE164);
    setImportedFields({ name: placeImportDraft.name || null, phone: placeImportDraft.phoneE164 });
  }, [placeImportDraft, restaurant.name, restaurant.phoneE164]);

  async function selectPlace(suggestion: { placeId: string; mainText: string }) {
    setSelectingPlace(true);
    setSearchError('');
    try {
      const token = sessionToken.current || crypto.randomUUID();
      const place = await post<PlaceImportDraft>('restaurant/onboarding/places/details', {
        placeId: suggestion.placeId,
        sessionToken: token,
      });
      setPlaceImportDraft(place);
      setGooglePlaceId(place.placeId);
      setName(place.name || name);
      setPhoneE164(place.phoneE164);
      setImportedFields({ name: place.name || null, phone: place.phoneE164 });
      const selectedLabel = `${place.name || suggestion.mainText}${place.city ? `, ${place.city}` : ''}`;
      selectedPlaceLabel.current = selectedLabel;
      setSearchQuery(selectedLabel);
      setCompletedSearch('');
      setSuggestions([]);
      sessionToken.current = '';
    } catch (error) {
      setSearchError(
        error instanceof Error ? error.message : 'Impossible de charger cet établissement.',
      );
    } finally {
      setSelectingPlace(false);
    }
  }

  function removePlaceSuggestion() {
    if (!placeImportDraft) return;
    setPlaceImportDraft(null);
    setGooglePlaceId(null);
    setName((current) => (current === placeImportDraft.name ? restaurant.name || '' : current));
    setPhoneE164((current) =>
      current === placeImportDraft.phoneE164 ? restaurant.phoneE164 || '' : current,
    );
    setSearchQuery('');
    setCompletedSearch('');
    selectedPlaceLabel.current = '';
    sessionToken.current = '';
    setSuggestions([]);
    setImportedFields({ name: null, phone: null });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await patch(`restaurants/${orgId}`, {
        name,
        managerEmail,
        phoneE164: phoneE164 || null,
        googlePlaceId,
      });
      await updateTask('complete', 'restaurant');
      onComplete('hours');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form id="onboarding-voice-form" onSubmit={handleSubmit} className="space-y-3">
      <StepHeader
        icon={Store}
        title="Vérifions votre restaurant"
        body="Vérifiez que Sokar a les bonnes informations sur votre restaurant."
      />
      <div className="grid max-w-6xl items-start gap-10 lg:grid-cols-2 lg:gap-12">
        <div className="space-y-5 py-1">
          <Field label="Votre restaurant">
            <div className="relative">
              <Search
                size={17}
                className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={searchQuery}
                maxLength={120}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchError('');
                  setSuggestions([]);
                  setCompletedSearch('');
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  if (suggestions[0] && !selectingPlace) void selectPlace(suggestions[0]);
                }}
                placeholder="Nom du restaurant et ville"
                autoComplete="off"
                className="h-12 rounded-xl pl-11 pr-10"
                aria-label="Rechercher un restaurant sur Google Maps"
                aria-expanded={suggestions.length > 0}
                aria-controls="onboarding-place-suggestions"
              />
              {(searchLoading || selectingPlace) && (
                <Loader2
                  size={17}
                  className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground"
                  aria-label="Recherche en cours"
                />
              )}
              {placeImportDraft && !searchLoading && !selectingPlace && (
                <button
                  type="button"
                  onClick={removePlaceSuggestion}
                  aria-label="Retirer la fiche sélectionnée"
                  className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
            </div>
            {placeImportDraft && suggestions.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-onboarding-complete">
                <Check size={13} aria-hidden="true" />
                <span>Informations trouvées sur Google Maps</span>
              </p>
            ) : searchQuery.trim().length < 2 ? (
              <p className="text-xs text-muted-foreground">
                Facultatif : sélectionnez votre fiche pour préremplir les champs, ou saisissez-les
                manuellement.
              </p>
            ) : null}
            {suggestions.length > 0 && (
              <div
                id="onboarding-place-suggestions"
                role="listbox"
                aria-label="Établissements trouvés"
                className="overflow-hidden rounded-xl border border-border bg-background shadow-lg"
              >
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.placeId}
                    type="button"
                    role="option"
                    aria-selected="false"
                    disabled={selectingPlace}
                    onClick={() => void selectPlace(suggestion)}
                    className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-all duration-200 last:border-0 hover:bg-accent disabled:opacity-50"
                  >
                    <MapPin
                      size={16}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {suggestion.mainText}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {suggestion.secondaryText}
                      </span>
                    </span>
                  </button>
                ))}
                <div className="flex items-center gap-1.5 border-t border-border/70 bg-muted/20 px-4 py-1.5 text-xs leading-4 text-muted-foreground">
                  <span>Source :</span>
                  <span className="font-sans font-medium" translate="no">
                    Google Maps
                  </span>
                </div>
              </div>
            )}
            {completedSearch.length > 0 &&
              completedSearch === searchQuery.trim() &&
              !searchLoading &&
              !selectingPlace &&
              suggestions.length === 0 &&
              !searchError && (
                <p role="status" className="text-sm text-muted-foreground">
                  Aucun résultat trouvé. Essayez avec un nom et une ville.
                </p>
              )}
            {searchError && (
              <p role="alert" className="text-sm text-destructive">
                {searchError}
              </p>
            )}
          </Field>
          <Field
            label="Nom du restaurant"
            hint="Le nom que connaissent vos clients."
            source={nameImportedFromGoogle ? 'Importé depuis Google' : null}
          >
            <Input
              className="h-12 rounded-xl"
              autoComplete="organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>
          <Field
            label="Le numéro que les clients vont appeler"
            hint="Ce numéro servira aussi pour l'appel test."
            source={phoneImportedFromGoogle ? 'Importé depuis Google' : null}
          >
            <Input
              className="h-12 rounded-xl"
              type="tel"
              value={phoneE164}
              onChange={(e) => setPhoneE164(e.target.value)}
              placeholder="Prérempli depuis Google Maps, modifiable"
              required
            />
          </Field>
          <Field
            label="Email de gestion"
            hint="Utilisé pour les alertes et le suivi de votre restaurant."
          >
            <Input
              className="h-12 rounded-xl"
              autoComplete="email"
              type="email"
              value={managerEmail}
              onChange={(e) => setManagerEmail(e.target.value)}
              required
            />
          </Field>
          <SubmitButton saving={saving}>Continuer vers les horaires</SubmitButton>
        </div>
        <OnboardingPreview
          eyebrow="Votre identité"
          title={name.trim() || 'Votre restaurant'}
          icon={Store}
        >
          <p className="text-sm leading-6 text-background/60">
            Sokar accueillera vos clients sous ce nom et utilisera ces coordonnées pour joindre
            votre restaurant.
          </p>
          <div className="space-y-3 border-t border-background/15 pt-4">
            <div className="flex items-start gap-3 text-sm">
              <PhoneCall
                size={17}
                className="mt-0.5 shrink-0 text-background/60"
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-background/60">
                  Le numéro que les clients vont appeler
                </span>
                <span className="block break-words">{phoneE164 || 'À renseigner'}</span>
              </span>
            </div>
            <div className="flex items-start gap-3 text-sm">
              <Mail size={17} className="mt-0.5 shrink-0 text-background/60" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-background/60">Email de gestion</span>
                <span className="block break-words">{managerEmail || 'À renseigner'}</span>
              </span>
            </div>
          </div>
        </OnboardingPreview>
      </div>
    </form>
  );
}
